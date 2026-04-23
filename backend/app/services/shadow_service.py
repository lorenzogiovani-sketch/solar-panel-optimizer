import trimesh
import numpy as np
import pandas as pd
import pvlib
import hashlib
import logging
import time as _time
import calendar
from app.models.shadow import ShadowRequest, ShadowResponse
from app.core.config import settings
from app.services.vegetation import (
    resolve_monthly_transmissivity,
    resolve_tree_category,
)
from datetime import datetime, timedelta
from shapely.geometry import Polygon as ShapelyPolygon, Point as ShapelyPoint
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

def generate_parametric_mesh(building_geom):
    """
    Genera una mesh trimesh da parametri edificio (width, depth, height).
    Supporta roofType 'flat' (box), 'gable' (box + prisma triangolare) e 'hip' (box + padiglione).
    Coordinate Y-up: X=larghezza, Y=altezza, Z=profondità.
    """
    w = building_geom.get('width', 12)
    d = building_geom.get('depth', 10)
    h = building_geom.get('height', 6)
    roof_type = building_geom.get('roofType', 'flat')
    roof_angle = building_geom.get('roofAngle', 0)

    # Corpo dell'edificio (box con base a y=0)
    box = trimesh.creation.box(extents=[w, h, d])
    box.apply_translation([0, h / 2, 0])

    if roof_type == 'gable' and roof_angle > 0:
        # Tetto a due falde (gable): prisma con colmo lungo X (Est-Ovest).
        # Coordinate system: -Z = North, +Z = South, +X = East, -X = West
        # Le falde guardano ±Z: falda nord (-Z) e falda sud (+Z).
        # Lo span del tetto è lungo Z (depth), il colmo corre lungo X (width).
        rh = (d / 2) * np.tan(np.radians(roof_angle))

        #   v4 ---- v5       (colmo a z=0, y = h + rh)
        #  / |      / |
        # v0 ---- v1  |      (gronda sud, z = -d/2, y = h)
        #    v2 ---- v3      (gronda nord, z = +d/2, y = h)
        vertices = np.array([
            [-w/2, h,      -d/2],  # 0: south-left
            [ w/2, h,      -d/2],  # 1: south-right
            [-w/2, h,       d/2],  # 2: north-left
            [ w/2, h,       d/2],  # 3: north-right
            [-w/2, h + rh,  0  ],  # 4: left-peak (ridge)
            [ w/2, h + rh,  0  ],  # 5: right-peak (ridge)
        ])

        faces = np.array([
            [0, 2, 4],  # left gable triangle
            [1, 5, 3],  # right gable triangle
            [0, 5, 1],  # south slope tri 1
            [0, 4, 5],  # south slope tri 2
            [2, 3, 5],  # north slope tri 1
            [2, 5, 4],  # north slope tri 2
            [0, 1, 3],  # bottom tri 1
            [0, 3, 2],  # bottom tri 2
        ])

        roof_prism = trimesh.Trimesh(vertices=vertices, faces=faces)
        roof_prism.fix_normals()
        return trimesh.util.concatenate([box, roof_prism])

    elif roof_type == 'hip':
        # Tetto a padiglione (hip)
        rh = building_geom.get('ridgeHeight', 3)
        rl = building_geom.get('ridgeLength', 8)
        # Clamp per evitare compenetrazioni strane
        rl = min(rl, w)
        
        hw = w / 2
        hd = d / 2
        hrl = rl / 2
        
        # Le stesse coordinate della ThreeJS geometry implementata nel frontend
        vertices = np.array([
            [-hw, h,  hd],  # 0: south-west base
            [ hw, h,  hd],  # 1: south-east base
            [ hw, h, -hd],  # 2: north-east base
            [-hw, h, -hd],  # 3: north-west base
            [-hrl, h + rh, 0], # 4: west ridge
            [ hrl, h + rh, 0], # 5: east ridge
        ])
        
        # CCW per far punatare le normali verso l'esterno
        faces = np.array([
            [0, 1, 5], [0, 5, 4], # south face
            [1, 2, 5],            # east face
            [2, 3, 4], [2, 4, 5], # north face
            [3, 0, 4],            # west face
            [0, 3, 2], [0, 2, 1]  # bottom face (verso il basso)
        ])
        
        roof_prism = trimesh.Trimesh(vertices=vertices, faces=faces)
        roof_prism.fix_normals()
        return trimesh.util.concatenate([box, roof_prism])

    return box

# Default storici (pre-Tab. 6.2). Mantenuti per retrocompatibilità: il frontend
# legacy può ancora inviare il campo `transmissivity` con questi valori e
# resolve_monthly_transmissivity lo rispetta come override.
DEFAULT_TRANSMISSIVITY_DECIDUOUS = [0.80, 0.80, 0.65, 0.40, 0.15, 0.10, 0.10, 0.10, 0.15, 0.40, 0.70, 0.80]
DEFAULT_TRANSMISSIVITY_EVERGREEN = [0.18, 0.18, 0.18, 0.18, 0.15, 0.15, 0.15, 0.15, 0.18, 0.18, 0.18, 0.18]

# Matrice di rotazione -90° attorno a X: converte asse Z-up (default trimesh) → Y-up (nostra scena)
# Rx(-90°): (x,y,z) → (x, z, -y)  ⟹  Z+ → Y+, Y+ → Z-
_ROT_Z_TO_Y = np.array([
    [1,  0, 0, 0],
    [0,  0, 1, 0],
    [0, -1, 0, 0],
    [0,  0, 0, 1],
], dtype=float)

DECIMATION_THRESHOLD = 3000  # facce oltre cui decimare per il ray-casting
DECIMATION_TARGET = 1500     # target aggressivo per performance ray-casting


def create_scene(building_geom, obstacles, model_offset_y=0.0):
    """
    Crea una scena trimesh combinando edificio e ostacoli.
    Restituisce (scene, building_mesh, shadow_mesh, canopy_meshes, obstacle_meshes) dove:
    - building_mesh: mesh originale (per generate_roof_grid)
    - shadow_mesh: mesh decimata per il ray-casting (= building_mesh se poche facce)
    - canopy_meshes: lista di dict { 'mesh', 'transmissivity' } per le chiome
    - obstacle_meshes: lista di mesh ostacoli opachi (per filtro spaziale)
    """
    # Supporta sia mesh importate (vertices/faces) che edifici parametrici (width/depth/height)
    if 'vertices' in building_geom and 'faces' in building_geom:
        vertices = np.array(building_geom['vertices'])
        faces = np.array(building_geom['faces'])
        # Rimuovi le facce eliminate dall'utente
        deleted_faces = building_geom.get('deleted_faces')
        if deleted_faces and len(deleted_faces) > 0:
            deleted_set = set(deleted_faces)
            mask = [i not in deleted_set for i in range(len(faces))]
            faces = faces[mask]
        building_mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        # Applica offset verticale per modelli importati
        if abs(model_offset_y) > 1e-6:
            building_mesh.apply_translation([0, model_offset_y, 0])

        # Decimazione per ray-casting: riduce facce mesh importati complessi
        if len(building_mesh.faces) > DECIMATION_THRESHOLD:
            t_dec = _time.perf_counter()
            original_count = len(building_mesh.faces)
            try:
                shadow_mesh = building_mesh.simplify_quadric_decimation(DECIMATION_TARGET)
                logger.info(
                    f"[shadow] Mesh decimation: {original_count} → {len(shadow_mesh.faces)} faces "
                    f"({100 * len(shadow_mesh.faces) / original_count:.0f}%) "
                    f"in {_time.perf_counter() - t_dec:.3f}s"
                )
            except Exception as e:
                logger.warning(f"[shadow] Decimation failed ({e}), using original mesh")
                shadow_mesh = building_mesh
        else:
            shadow_mesh = building_mesh
    else:
        building_mesh = generate_parametric_mesh(building_geom)
        shadow_mesh = building_mesh

    scene = trimesh.Scene()
    scene.add_geometry(building_mesh)
    canopy_meshes = []
    obstacle_meshes = []  # mesh ostacoli opachi (per filtro spaziale)

    # Ostacoli
    for obs in obstacles:
        if 'vertices' in obs and 'faces' in obs:
            obs_mesh = trimesh.Trimesh(vertices=obs['vertices'], faces=obs['faces'])
            scene.add_geometry(obs_mesh)
            obstacle_meshes.append(obs_mesh)
        else:
            dims = obs.get('dimensions', [1, 1, 1])
            pos = obs.get('position', [0, 0, 0])
            obs_type = obs.get('type', 'box')

            if obs_type == 'tree':
                # Albero: tronco (opaco) e chioma (trasmissività variabile) aggiunti separatamente
                trunk_height = obs.get('trunkHeight', 2.0)
                canopy_radius = obs.get('canopyRadius', 2.0)
                tree_shape = obs.get('treeShape', 'cone')

                # Step 1: costruisci trunk in coordinate locali (base a Y=0)
                trunk = trimesh.creation.cylinder(radius=0.15, height=trunk_height)
                trunk.apply_transform(_ROT_Z_TO_Y)  # Z-up → Y-up
                trunk.apply_translation([0, trunk_height / 2, 0])

                # Step 2: costruisci canopy in coordinate locali (sopra il tronco)
                if tree_shape == 'sphere':
                    canopy = trimesh.creation.icosphere(radius=canopy_radius, subdivisions=2)
                    canopy.apply_translation([0, trunk_height + canopy_radius, 0])
                elif tree_shape == 'umbrella':
                    canopy = trimesh.creation.icosphere(radius=canopy_radius, subdivisions=2)
                    canopy.apply_scale([1.3, 0.5, 1.3])
                    canopy.apply_translation([0, trunk_height + canopy_radius * 0.5, 0])
                elif tree_shape == 'columnar':
                    col_radius = canopy_radius * 0.4
                    col_height = canopy_radius * 2.5
                    canopy = trimesh.creation.cylinder(radius=col_radius, height=col_height)
                    canopy.apply_transform(_ROT_Z_TO_Y)  # Z-up → Y-up
                    canopy.apply_translation([0, trunk_height + col_height / 2, 0])
                else:
                    # cone (default)
                    canopy_height = canopy_radius * 1.5
                    canopy = trimesh.creation.cone(radius=canopy_radius, height=canopy_height)
                    canopy.apply_transform(_ROT_Z_TO_Y)  # Z-up → Y-up
                    canopy.apply_translation([0, trunk_height, 0])

                # Step 3: applica tilt attorno all'asse X (inclinazione albero)
                tilt_deg = obs.get('tiltAngle', 0) or 0
                tilt_rad = float(tilt_deg) * np.pi / 180.0
                if abs(tilt_rad) > 1e-6:
                    ct, st = np.cos(tilt_rad), np.sin(tilt_rad)
                    tilt_matrix = np.array([
                        [1,  0,   0,  0],
                        [0,  ct, -st, 0],
                        [0,  st,  ct, 0],
                        [0,  0,   0,  1],
                    ], dtype=float)
                    trunk.apply_transform(tilt_matrix)
                    canopy.apply_transform(tilt_matrix)

                # Step 4: applica rotazione Euler utente (se presente)
                obs_rotation = obs.get('rotation', [0, 0, 0])
                rx = float(obs_rotation[0]) if len(obs_rotation) > 0 else 0.0
                ry = float(obs_rotation[1]) if len(obs_rotation) > 1 else 0.0
                rz = float(obs_rotation[2]) if len(obs_rotation) > 2 else 0.0
                if abs(rx) > 1e-6 or abs(ry) > 1e-6 or abs(rz) > 1e-6:
                    crx, srx = np.cos(rx), np.sin(rx)
                    cry, sry = np.cos(ry), np.sin(ry)
                    crz, srz = np.cos(rz), np.sin(rz)
                    mat_rx = np.array([
                        [1,   0,    0,   0],
                        [0,  crx, -srx,  0],
                        [0,  srx,  crx,  0],
                        [0,   0,    0,   1],
                    ], dtype=float)
                    mat_ry = np.array([
                        [ cry, 0, sry, 0],
                        [   0, 1,   0, 0],
                        [-sry, 0, cry, 0],
                        [   0, 0,   0, 1],
                    ], dtype=float)
                    mat_rz = np.array([
                        [crz, -srz, 0, 0],
                        [srz,  crz, 0, 0],
                        [  0,    0, 1, 0],
                        [  0,    0, 0, 1],
                    ], dtype=float)
                    euler_matrix = mat_rx @ mat_ry @ mat_rz
                    trunk.apply_transform(euler_matrix)
                    canopy.apply_transform(euler_matrix)

                # Step 5: trasla alla posizione finale
                trunk.apply_translation([pos[0], pos[1], pos[2]])
                canopy.apply_translation([pos[0], pos[1], pos[2]])
                scene.add_geometry(trunk)

                # Foliage: accetta sia camelCase (legacy frontend) sia snake_case (nuovo schema)
                foliage_type = obs.get('foliage_type', obs.get('foliageType', 'deciduous'))
                if foliage_type not in ('deciduous', 'evergreen'):
                    foliage_type = 'deciduous'

                # Override esplicito (precedenza): monthly_transmissivity_override > transmissivity legacy > Tab. 6.2
                override = obs.get('monthly_transmissivity_override')
                if override is None:
                    legacy = obs.get('transmissivity')
                    if isinstance(legacy, (list, tuple)) and len(legacy) == 12:
                        override = legacy

                # Famiglia canonica (attualmente non altera la geometria: mantenuta la
                # mesh scelta in base alla forma UI, come richiesto).
                tree_category = resolve_tree_category(tree_shape, obs.get('tree_category'))

                transmissivity = resolve_monthly_transmissivity(
                    shape=tree_shape,
                    foliage_type=foliage_type,
                    override=override,
                )

                canopy_meshes.append({
                    'mesh': canopy,
                    'transmissivity': transmissivity,
                    'tree_category': tree_category,
                })
            elif obs_type in ('cylinder', 'antenna'):
                radius = dims[0] / 2 if obs_type == 'cylinder' else 0.05
                obs_mesh = trimesh.creation.cylinder(radius=radius, height=dims[1])
                obs_mesh.apply_transform(_ROT_Z_TO_Y)  # Z-up → Y-up
                obs_mesh.apply_translation([pos[0], pos[1] + dims[1] / 2, pos[2]])
                scene.add_geometry(obs_mesh)
                obstacle_meshes.append(obs_mesh)
            else:
                # box, building, chimney e altri usano la stessa geometria (box)
                obs_mesh = trimesh.creation.box(extents=[dims[0], dims[1], dims[2]])

                obs_rotation = obs.get('rotation', [0, 0, 0])
                rx = float(obs_rotation[0]) if len(obs_rotation) > 0 else 0.0
                ry = float(obs_rotation[1]) if len(obs_rotation) > 1 else 0.0
                rz = float(obs_rotation[2]) if len(obs_rotation) > 2 else 0.0
                tilt_deg = obs.get('tiltAngle', 0) or 0
                tilt_rad = float(tilt_deg) * np.pi / 180.0

                # Step 1: alza la geometria di h/2 (portare la base a y=0 nel frame locale)
                obs_mesh.apply_translation([0, dims[1] / 2, 0])

                # Step 2: applica tilt attorno all'asse X locale (inclinazione rispetto alla falda)
                if abs(tilt_rad) > 1e-6:
                    ct, st = np.cos(tilt_rad), np.sin(tilt_rad)
                    obs_mesh.apply_transform(np.array([
                        [1,  0,   0,  0],
                        [0,  ct, -st, 0],
                        [0,  st,  ct, 0],
                        [0,  0,   0,  1],
                    ], dtype=float))

                # Step 3: applica rotazione superficiale completa (Euler XYZ: Rx * Ry * Rz)
                if abs(rx) > 1e-6 or abs(ry) > 1e-6 or abs(rz) > 1e-6:
                    crx, srx = np.cos(rx), np.sin(rx)
                    cry, sry = np.cos(ry), np.sin(ry)
                    crz, srz = np.cos(rz), np.sin(rz)
                    mat_rx = np.array([
                        [1,   0,    0,   0],
                        [0,  crx, -srx,  0],
                        [0,  srx,  crx,  0],
                        [0,   0,    0,   1],
                    ], dtype=float)
                    mat_ry = np.array([
                        [ cry, 0, sry, 0],
                        [   0, 1,   0, 0],
                        [-sry, 0, cry, 0],
                        [   0, 0,   0, 1],
                    ], dtype=float)
                    mat_rz = np.array([
                        [crz, -srz, 0, 0],
                        [srz,  crz, 0, 0],
                        [  0,    0, 1, 0],
                        [  0,    0, 0, 1],
                    ], dtype=float)
                    obs_mesh.apply_transform(mat_rx @ mat_ry @ mat_rz)

                # Step 4: trasla alla posizione dell'ostacolo
                obs_mesh.apply_translation([pos[0], pos[1], pos[2]])
                scene.add_geometry(obs_mesh)
                obstacle_meshes.append(obs_mesh)

    return scene, building_mesh, shadow_mesh, canopy_meshes, obstacle_meshes


def filter_faces_above(mesh, plane_y, margin=0.5):
    """
    Ritorna un mesh contenente solo le facce con almeno un vertice
    a quota Y >= plane_y - margin, e con normali non rivolte verso il basso.
    Per edifici parametrici (< 100 facce) il filtro viene saltato.
    """
    if len(mesh.faces) < 100:
        return mesh

    vertices = mesh.vertices
    faces = mesh.faces

    # Filtro 1: almeno un vertice sopra la soglia
    max_y_per_face = np.max(vertices[faces, 1], axis=1)  # (N_faces,)
    above_mask = max_y_per_face >= (plane_y - margin)

    # Filtro 2: escludi facce con normali che puntano verso il basso
    face_normals = mesh.face_normals
    not_downward = face_normals[:, 1] > -0.1

    mask = above_mask & not_downward
    filtered_faces = faces[mask]

    return trimesh.Trimesh(vertices=vertices, faces=filtered_faces)


def generate_roof_grid(building_mesh, resolution=50, installation_polygons=None, installation_plane_y=None):
    """
    Genera una griglia di punti sulla bounding box del tetto.
    Se installation_polygons è presente e non vuoto, la griglia viene ristretta
    al bounding box dell'unione dei poligoni di installazione (+ margine 0.5m),
    altrimenti usa la bounding box completa dell'edificio.
    Se installation_plane_y è fornito, usa quella quota come altezza di partenza
    per i raggi verso il basso (override manuale per modelli importati).
    """
    bounds = building_mesh.bounds
    min_x, min_y, min_z = bounds[0]
    max_x, max_y, max_z = bounds[1]

    # Clip dominio ai poligoni di installazione se disponibili
    valid_polys = [p for p in (installation_polygons or []) if len(p) >= 3]
    if valid_polys:
        all_x = [v['x'] for poly in valid_polys for v in poly]
        all_z = [v['z'] for poly in valid_polys for v in poly]
        poly_margin = 0.5  # margine per ombre ai bordi
        min_x = max(min_x, min(all_x) - poly_margin)
        max_x = min(max_x, max(all_x) + poly_margin)
        min_z = max(min_z, min(all_z) - poly_margin)
        max_z = min(max_z, max(all_z) + poly_margin)

    # Griglia 2D sul piano XZ (Y-up: X=width, Z=depth, Y=height)
    # Cell-center sampling: i punti campione cadono al centro di ogni cella,
    # evitando gli spigoli esatti della mesh dove il raycast può fallire
    # (artefatti di bordo su tetti gable/hip con shadow_pct=0 erroneo).
    step_x = (max_x - min_x) / resolution
    step_z = (max_z - min_z) / resolution
    x_coords = np.linspace(min_x + step_x / 2, max_x - step_x / 2, resolution)
    z_coords = np.linspace(min_z + step_z / 2, max_z - step_z / 2, resolution)
    
    grid_x, grid_z = np.meshgrid(x_coords, z_coords)
    
    # Punti di partenza per raycast (dall'alto verso il basso)
    # Se installation_plane_y è fornito, parti da quella quota + margine
    ray_start_y = (installation_plane_y + 2.0) if installation_plane_y is not None else (max_y + 10.0)
    ray_origins = np.column_stack([
        grid_x.ravel(),
        np.full(grid_x.size, ray_start_y),
        grid_z.ravel()
    ])
    
    ray_directions = np.tile([0, -1, 0], (ray_origins.shape[0], 1))
    
    # Raycast per trovare intersezione con il tetto
    # Usa ray_intersects_location che ritorna locations, index_ray, index_tri
    locations, index_ray, index_tri = building_mesh.ray.intersects_location(
        ray_origins=ray_origins,
        ray_directions=ray_directions
    )

    domain_bounds = (min_x, max_x, min_z, max_z)

    if len(locations) == 0:
        return np.empty((0, 3)), np.array([], dtype=int), np.array([], dtype=int), grid_x, grid_z, domain_bounds

    # Per ogni raggio, prendi la prima intersezione su una faccia rivolta verso l'alto
    # (normale Y > 0). Questo esclude facce laterali e facce inferiori del prisma
    # che causerebbero artefatti viola sui bordi.
    all_normals = building_mesh.face_normals
    unique_rays = np.unique(index_ray)
    best_loc = []
    best_ray = []
    best_tri = []
    for ray_idx in unique_rays:
        mask = index_ray == ray_idx
        global_indices = np.where(mask)[0]

        # Filtra: solo facce con normale rivolta verso l'alto (Y > 0.1)
        upward_mask = all_normals[index_tri[global_indices], 1] > 0.1
        upward_indices = global_indices[upward_mask]

        if len(upward_indices) == 0:
            continue

        hits_y = locations[upward_indices, 1]
        if installation_plane_y is not None:
            # Seleziona il hit più vicino alla quota del piano di installazione
            dist_to_plane = np.abs(hits_y - installation_plane_y)
            closest_local = np.argmin(dist_to_plane)
            # Accetta solo hit entro 1m dalla quota target
            if dist_to_plane[closest_local] > 1.0:
                continue
            best = upward_indices[closest_local]
        else:
            top_local = np.argmax(hits_y)
            best = upward_indices[top_local]
        best_loc.append(locations[best])
        best_ray.append(ray_idx)
        best_tri.append(index_tri[best])

    if len(best_loc) == 0:
        return np.empty((0, 3)), np.array([], dtype=int), np.array([], dtype=int), grid_x, grid_z, domain_bounds

    valid_points = np.array(best_loc)
    valid_indices = np.array(best_ray)
    valid_tri = np.array(best_tri)

    return valid_points, valid_indices, valid_tri, grid_x, grid_z, domain_bounds

def compute_sky_view_factor(roof_points, face_normals, ray_mesh, n_points_hint=None):
    """
    Calcola lo Sky View Factor (SVF) per ogni punto del tetto.
    SVF = frazione dell'emisfero sopra la superficie non ostruita dalla geometria.
    Campionamento adattivo: meno campioni per griglie grandi, batched per velocità.
    """
    n_points = len(roof_points)
    svf = np.ones(n_points)

    if n_points == 0:
        return svf

    # Campionamento adattivo basato su numero di punti
    # Senza Embree il raycasting è lento → pochi campioni per griglie grandi
    if n_points > 5000:
        n_phi = 6      # 6 × 2 = 12 direzioni — minimo per gradiente realistico
        el_degrees = [25, 60]
    elif n_points > 2000:
        n_phi = 8      # 8 × 3 = 24 direzioni
        el_degrees = [20, 45, 70]
    else:
        n_phi = 12     # 12 × 3 = 36 direzioni
        el_degrees = [20, 45, 70]

    phi_samples = np.linspace(0, 2 * np.pi, n_phi, endpoint=False)
    el_samples = np.radians(el_degrees)
    el_weights = np.cos(el_samples) * np.sin(el_samples)
    el_weights /= el_weights.sum()

    # Pre-calcola tutte le direzioni e i pesi
    directions = []
    weights = []
    for i_el, el in enumerate(el_samples):
        cos_el = np.cos(el)
        sin_el = np.sin(el)
        for phi in phi_samples:
            dx = cos_el * np.cos(phi)
            dy = sin_el
            dz = cos_el * np.sin(phi)
            directions.append([dx, dy, dz])
            weights.append(el_weights[i_el])
    directions = np.array(directions)  # (N_dirs, 3)
    weights = np.array(weights)        # (N_dirs,)

    normal_offset = 0.05
    start_points = roof_points + face_normals * normal_offset

    total_weight = 0.0
    unblocked_weight = np.zeros(n_points)

    # Per ogni direzione: test batch su tutti i punti above-surface
    for d_idx in range(len(directions)):
        direction = directions[d_idx]
        w = weights[d_idx]

        cos_angle = face_normals @ direction  # (n_points,)
        above_surface = cos_angle > 0.01

        if not np.any(above_surface):
            continue

        total_weight += w
        above_indices = np.where(above_surface)[0]
        ray_origins = start_points[above_indices]
        ray_dirs = np.broadcast_to(direction, (len(above_indices), 3)).copy()

        hit = _batch_intersects(ray_mesh, ray_origins, ray_dirs)
        unblocked_weight[above_indices] += np.where(~hit, w, 0.0)

    if total_weight > 0:
        svf = unblocked_weight / total_weight
        svf = np.clip(svf, 0.0, 1.0)

    return svf


def _solpos_to_vectors(solpos):
    """
    Converte posizioni solari pvlib in vettori direttore (Y-up, verso il sole).
    Coordinate system: -Z = North (azimuth 0°), +X = East (azimuth 90°), +Y = Up.
    Applica la correzione di rifrazione Bennett (Eq. 1.13–1.14) sull'elevazione geometrica.
    """
    daylight = solpos[solpos['apparent_elevation'] > 5]
    if daylight.empty:
        return np.empty((0, 3))

    azimuth_rad = np.radians(daylight['azimuth'].values)
    beta_deg = daylight['elevation'].values  # elevazione geometrica (senza rifrazione pvlib)

    # Correzione rifrazione atmosferica Bennett vettorizzata, Δβ in arcminuti
    # Filtro garantisce beta > ~4.95°, quindi beta+4.4 > 9.4 — nessun rischio di divisione per zero
    delta_arcmin = 1.0 / np.tan(np.radians(beta_deg + 7.31 / (beta_deg + 4.4)))
    beta_corr_rad = np.radians(beta_deg + delta_arcmin / 60.0)

    x = np.cos(beta_corr_rad) * np.sin(azimuth_rad)
    y = np.sin(beta_corr_rad)
    z = -np.cos(beta_corr_rad) * np.cos(azimuth_rad)  # Negated for -Z = North

    return np.column_stack([x, y, z])


def calculate_sun_vectors(request: ShadowRequest):
    """
    Calcola i vettori solari in base alla modalità di analisi.
    Restituisce (sun_vectors: ndarray, month_indices: ndarray) dove month_indices[i] è il mese (1-12)
    del vettore solare i-esimo.
    - 'annual': 12 giorni rappresentativi (15 di ogni mese), ore 8-18 → ~132 vettori
    - 'monthly': un singolo mese, tutti i giorni, ore 8-18
    - 'instant': singolo timestamp → 1 vettore solare
    """
    import calendar

    location = pvlib.location.Location(request.latitude, request.longitude, tz=request.timezone)
    mode = getattr(request, 'analysis_mode', 'annual') or 'annual'
    year = getattr(request, 'year', datetime.now().year)

    if mode == 'instant':
        month = request.analysis_month or 6
        day = request.analysis_day or 15
        hour = request.analysis_hour if request.analysis_hour is not None else 12.0
        max_day = calendar.monthrange(year, month)[1]
        day = min(day, max_day)
        hour_int = int(hour)
        minute = int((hour - hour_int) * 60)
        dt = datetime(year, month, day, hour_int, minute)
        times = pd.DatetimeIndex([dt], tz=request.timezone)
        solpos = location.get_solarposition(times)
        vecs = _solpos_to_vectors(solpos)
        return vecs, np.full(len(vecs), month, dtype=int)

    if mode == 'monthly':
        month = request.analysis_month or 6
        max_day = calendar.monthrange(year, month)[1]
        sun_vectors = []
        month_indices = []
        for day in range(1, max_day + 1):
            date = datetime(year, month, day)
            times = pd.date_range(
                start=date + timedelta(hours=8),
                end=date + timedelta(hours=18),
                freq='1h',
                tz=request.timezone,
            )
            solpos = location.get_solarposition(times)
            vecs = _solpos_to_vectors(solpos)
            if len(vecs) > 0:
                sun_vectors.append(vecs)
                month_indices.extend([month] * len(vecs))
        if not sun_vectors:
            return np.empty((0, 3)), np.array([], dtype=int)
        return np.vstack(sun_vectors), np.array(month_indices, dtype=int)

    # mode == 'annual' (default)
    # 12 mesi × 3 giorni rappresentativi (5, 15, 25 di ogni mese)
    # Intervallo 2h, ore 8-18 → ~216 vettori per copertura uniforme annuale
    sun_vectors = []
    month_indices = []

    for month in range(1, 13):
        for day in [5, 15, 25]:
            last_day = calendar.monthrange(year, month)[1]
            actual_day = min(day, last_day)
            date = datetime(year, month, actual_day)

            times = pd.date_range(
                start=date + timedelta(hours=8),
                end=date + timedelta(hours=18),
                freq='2h',
                tz=request.timezone,
            )
            solpos = location.get_solarposition(times)
            vecs = _solpos_to_vectors(solpos)
            if len(vecs) > 0:
                sun_vectors.append(vecs)
                month_indices.extend([month] * len(vecs))

    if not sun_vectors:
        return np.empty((0, 3)), np.array([], dtype=int)

    return np.vstack(sun_vectors), np.array(month_indices, dtype=int)

def _mesh_hash(mesh):
    """Calcola hash SHA256 dei vertici della mesh per chiave di cache."""
    return hashlib.sha256(mesh.vertices.tobytes()).hexdigest()


# Cache BVH intersector: evita di ricostruire il BVH se la geometria non cambia
_bvh_cache = {}


def _get_cached_intersector(mesh, label="mesh", plane_y=None, decimation_target=None):
    """
    Restituisce la mesh con BVH pre-inizializzato.
    Il BVH viene costruito al primo accesso a mesh.ray e cachato da trimesh internamente.
    Qui cachiamo l'intera mesh per evitare ricostruzioni tra richieste successive
    con la stessa geometria.
    La chiave include plane_y e decimation_target per distinguere mesh diverse.
    """
    h = _mesh_hash(mesh)
    plane_key = round(plane_y, 1) if plane_y is not None else None
    cache_key = (h, plane_key, decimation_target)
    if cache_key in _bvh_cache:
        logger.debug(f"[shadow] BVH cache HIT per {label}")
        return _bvh_cache[cache_key]
    # Pre-warm: forza la costruzione del BVH
    _ = mesh.ray
    _bvh_cache[cache_key] = mesh
    # Limita cache a 8 entry per non consumare troppa RAM
    if len(_bvh_cache) > 8:
        oldest_key = next(iter(_bvh_cache))
        del _bvh_cache[oldest_key]
    logger.debug(f"[shadow] BVH cache MISS per {label}, costruito e cachato")
    return mesh


def _batch_intersects(mesh, origins, directions, chunk_size=None):
    """
    Esegue intersects_any a batch vettorizzati con chunking per sicurezza memoria.
    Restituisce array booleano (N,).
    """
    if chunk_size is None:
        chunk_size = settings.RAYCASTING_CHUNK_SIZE
    n = len(origins)
    if n == 0:
        return np.zeros(0, dtype=bool)
    if n <= chunk_size:
        return mesh.ray.intersects_any(ray_origins=origins, ray_directions=directions)
    # Chunked
    result = np.empty(n, dtype=bool)
    for i in range(0, n, chunk_size):
        end = min(i + chunk_size, n)
        result[i:end] = mesh.ray.intersects_any(
            ray_origins=origins[i:end],
            ray_directions=directions[i:end]
        )
    return result


def _aggregate_cell_shading(pt_idx, sun_idx, all_cos, contribution,
                             month_indices, n_points,
                             diffuse_factor,
                             direct_fraction=0.65, diffuse_fraction=0.35):
    """
    Calcola F_s,m per-cella in due forme: energy-weighted e time-avg (Step 10, Eq. 4.46).

    - F_s,b(r) = 1 - att(r) con att(r) = contribution[r]/all_cos[r] ∈ [0,1]
    - F_s,d(p) = 1 - diffuse_factor[p] (time-invariant)
    - F_s,m_energy[p] = direct·(Σ_r∈p F_s,b·I_b / Σ_r∈p I_b) + diffuse·F_s,d[p]
      con I_b(r) ∝ all_cos[r] (proxy clear-sky a DNI costante)
    - F_s,m_time[p]   = direct·(1/|R_p|)·Σ_r∈p F_s,b(r)       + diffuse·F_s,d[p]

    Restituisce dict con chiavi:
      per_cell_energy (n_points,), per_cell_time (n_points,),
      monthly_energy dict[int]->scalar, monthly_time dict[int]->scalar,
      annual_energy scalar, annual_time scalar.
    """
    out = {
        'per_cell_energy': np.zeros(n_points),
        'per_cell_time': np.zeros(n_points),
        'monthly_energy': {},
        'monthly_time': {},
        'annual_energy': 0.0,
        'annual_time': 0.0,
    }

    f_s_d = 1.0 - np.clip(diffuse_factor, 0.0, 1.0)

    if len(pt_idx) == 0 or np.sum(all_cos) < 1e-12:
        # Nessun raggio front-facing: solo diffuso.
        out['per_cell_energy'] = diffuse_fraction * f_s_d
        out['per_cell_time'] = diffuse_fraction * f_s_d
        val = float(np.mean(out['per_cell_energy'])) if n_points > 0 else 0.0
        out['annual_energy'] = val
        out['annual_time'] = val
        return out

    safe_cos = np.where(all_cos > 1e-12, all_cos, 1e-12)
    att_ray = np.clip(contribution / safe_cos, 0.0, 1.0)
    f_s_b_ray = 1.0 - att_ray  # shading beam per-ray ∈ [0,1]

    def _aggregate(mask_rays):
        """Aggrega per-cella energy/time su una maschera di raggi."""
        if mask_rays is None:
            r_pt = pt_idx
            r_cos = all_cos
            r_fs = f_s_b_ray
        else:
            if not np.any(mask_rays):
                return None, None
            r_pt = pt_idx[mask_rays]
            r_cos = all_cos[mask_rays]
            r_fs = f_s_b_ray[mask_rays]

        # Energy-weighted per-cella: Σ(F_s·cos) / Σ(cos)
        num_e = np.bincount(r_pt, weights=r_fs * r_cos, minlength=n_points)
        den_e = np.bincount(r_pt, weights=r_cos, minlength=n_points)
        fs_b_energy = np.where(den_e > 1e-12, num_e / np.maximum(den_e, 1e-12), 0.0)

        # Time-average per-cella: media aritmetica su raggi front-facing
        num_t = np.bincount(r_pt, weights=r_fs, minlength=n_points)
        cnt_t = np.bincount(r_pt, minlength=n_points).astype(float)
        fs_b_time = np.where(cnt_t > 0, num_t / np.maximum(cnt_t, 1.0), 0.0)

        cell_energy = direct_fraction * fs_b_energy + diffuse_fraction * f_s_d
        cell_time   = direct_fraction * fs_b_time   + diffuse_fraction * f_s_d
        return cell_energy, cell_time

    cell_e, cell_t = _aggregate(None)
    if cell_e is None:
        cell_e = diffuse_fraction * f_s_d
        cell_t = diffuse_fraction * f_s_d
    out['per_cell_energy'] = np.clip(cell_e, 0.0, 1.0)
    out['per_cell_time'] = np.clip(cell_t, 0.0, 1.0)
    out['annual_energy'] = float(np.mean(out['per_cell_energy'])) if n_points > 0 else 0.0
    out['annual_time'] = float(np.mean(out['per_cell_time'])) if n_points > 0 else 0.0

    # Mensile: per ogni mese presente nei raggi
    ray_months = month_indices[sun_idx]
    for m in range(1, 13):
        mask = ray_months == m
        cell_e_m, cell_t_m = _aggregate(mask)
        if cell_e_m is None:
            continue
        out['monthly_energy'][m] = float(np.mean(np.clip(cell_e_m, 0.0, 1.0)))
        out['monthly_time'][m] = float(np.mean(np.clip(cell_t_m, 0.0, 1.0)))

    return out


def filter_obstacles_by_sun(obstacle_meshes, grid_center, sun_direction, max_distance=50.0):
    """
    Filtra ostacoli opachi in base alla direzione solare e alla distanza.
    Un ostacolo può proiettare ombra sulla griglia solo se:
    1. Si trova nella direzione del sole rispetto alla griglia (dot > -1.0)
    2. È entro max_distance dalla griglia
    Restituisce lista di mesh che possono effettivamente ombreggiare la griglia.
    """
    if not obstacle_meshes:
        return []
    filtered = []
    for obs_mesh in obstacle_meshes:
        obs_center = obs_mesh.centroid
        to_obstacle = obs_center - grid_center
        # Raggi vanno dalla griglia verso il sole: se l'ostacolo è in quella
        # direzione (dot > 0), può bloccare il raggio. Margine generoso -1.0
        dot = np.dot(to_obstacle, sun_direction)
        if dot > -1.0:
            dist = np.linalg.norm(to_obstacle)
            if dist < max_distance:
                filtered.append(obs_mesh)
    return filtered


def calculate_shadow_map(request: ShadowRequest) -> ShadowResponse:
    _t0 = _time.perf_counter()

    # 1. Setup Scena
    scene, building_mesh, shadow_mesh, canopy_meshes, obstacle_meshes = create_scene(
        request.building, request.obstacles, model_offset_y=request.model_offset_y
    )
    _t_scene = _time.perf_counter()

    # 2. Genera punti sul tetto (dominio ristretto ai poligoni se disponibili)
    resolution = request.grid_resolution
    valid_polys = [p for p in (request.installation_polygons or []) if len(p) >= 3]
    install_plane_y = getattr(request, 'installation_plane_y', None)
    roof_points, point_indices, tri_indices, grid_x, grid_z, domain_bounds = generate_roof_grid(
        building_mesh, resolution,
        installation_polygons=valid_polys if valid_polys else None,
        installation_plane_y=install_plane_y,
    )
    domain_min_x, domain_max_x, domain_min_z, domain_max_z = domain_bounds

    # Altezza massima tetto per allineamento heatmap (utile per modelli importati)
    # Se installation_plane_y è fornito, usalo come max_roof_y per il frontend
    if install_plane_y is not None:
        max_roof_y = float(install_plane_y)
    else:
        max_roof_y = float(roof_points[:, 1].max()) if len(roof_points) > 0 else 0.0

    if len(roof_points) == 0:
        return ShadowResponse(
            shadow_grid=np.zeros((resolution, resolution)).tolist(),
            grid_bounds={'min_x': 0, 'min_z': 0, 'max_x': 0, 'max_z': 0, 'max_roof_y': 0.0},
            monthly_shadows={},
            statistics={'free_area': 0},
            computation_time_s=round(_time.perf_counter() - _t0, 2),
        )

    # 2b. Filtra punti per poligoni di installazione (multi-zona)
    polygon_mask = None
    if valid_polys:
        shapely_polys = [ShapelyPolygon([(v['x'], v['z']) for v in p]) for p in valid_polys]
        shapely_poly = unary_union(shapely_polys)
        inside = np.array([
            shapely_poly.contains(ShapelyPoint(pt[0], pt[2]))
            for pt in roof_points
        ])
        polygon_mask = inside
        roof_points = roof_points[inside]
        tri_indices = tri_indices[inside]
        inside_grid_indices = point_indices[inside]
        outside_grid_indices = point_indices[~inside]
        point_indices = inside_grid_indices

        if len(roof_points) == 0:
            sentinel_grid = np.full(resolution * resolution, -1.0)
            return ShadowResponse(
                shadow_grid=sentinel_grid.reshape((resolution, resolution)).tolist(),
                grid_bounds={
                    'min_x': float(domain_min_x),
                    'max_x': float(domain_max_x),
                    'min_z': float(domain_min_z),
                    'max_z': float(domain_max_z),
                    'max_roof_y': max_roof_y
                },
                monthly_shadows={},
                statistics={'free_area_pct': 0.0},
                computation_time_s=round(_time.perf_counter() - _t0, 2),
            )

    _t_grid = _time.perf_counter()

    # 2c. Filtra mesh edificio per il ray-casting ombre (solo facce sopra il piano di installazione)
    min_roof_y = float(roof_points[:, 1].min()) if len(roof_points) > 0 else None
    shadow_plane_y = install_plane_y if install_plane_y is not None else min_roof_y
    if shadow_plane_y is None:
        shadow_plane_y = float(building_mesh.bounds[1][1]) * 0.5  # fallback conservativo

    # Decimazione → filtro facce sopra piano: ordine corretto per massima riduzione
    shadow_building_mesh = filter_faces_above(shadow_mesh, shadow_plane_y)
    logger.info(
        f"[shadow] Mesh optimization: {len(building_mesh.faces)} original → "
        f"{len(shadow_mesh.faces)} decimated → "
        f"{len(shadow_building_mesh.faces)} above plane y={shadow_plane_y:.2f} "
        f"({100 * len(shadow_building_mesh.faces) / max(len(building_mesh.faces), 1):.0f}%)"
    )

    # 3. Calcola vettori solari e ruotali nel sistema locale dell'edificio
    sun_vectors, month_indices = calculate_sun_vectors(request)
    model_rotation = getattr(request, 'model_rotation', 0) or 0
    building_rot = np.radians(-request.azimuth - model_rotation)
    if abs(building_rot) > 1e-6:
        cos_r = np.cos(building_rot)
        sin_r = np.sin(building_rot)
        rotated = np.empty_like(sun_vectors)
        rotated[:, 0] = sun_vectors[:, 0] * cos_r - sun_vectors[:, 2] * sin_r
        rotated[:, 1] = sun_vectors[:, 1]
        rotated[:, 2] = sun_vectors[:, 0] * sin_r + sun_vectors[:, 2] * cos_r
        sun_vectors = rotated

    # Filtro raggi inutili: scarta vettori con componente Y negativa (sole sotto orizzonte)
    valid_sun_mask = sun_vectors[:, 1] > 0
    sun_vectors = sun_vectors[valid_sun_mask]
    month_indices = month_indices[valid_sun_mask]

    N_suns = len(sun_vectors)
    N_points = len(roof_points)

    if N_suns == 0:
        return ShadowResponse(
            shadow_grid=np.zeros((resolution, resolution)).tolist(),
            grid_bounds={
                'min_x': float(domain_min_x),
                'max_x': float(domain_max_x),
                'min_z': float(domain_min_z),
                'max_z': float(domain_max_z),
                'max_roof_y': max_roof_y
            },
            monthly_shadows={},
            statistics={'free_area_pct': 100.0},
            computation_time_s=round(_time.perf_counter() - _t0, 2),
        )

    _t_solar = _time.perf_counter()

    # 4. Ray Tracing VETTORIZZATO con legge del coseno di Lambert
    # Costruisci mesh opaca unica (edificio decimato+filtrato + ostacoli vicini) per un singolo batch
    all_geoms = list(scene.geometry.values())
    canopy_geom_ids = set(id(cm['mesh']) for cm in canopy_meshes)
    building_geom_id = id(building_mesh)
    grid_center = roof_points.mean(axis=0) if N_points > 0 else np.zeros(3)

    # Filtra ostacoli per distanza (pre-calcolo, una sola volta)
    nearby_obstacles = [
        om for om in obstacle_meshes
        if np.linalg.norm(om.centroid - grid_center) < 50.0
    ]
    nearby_obs_ids = set(id(om) for om in nearby_obstacles)

    # Mesh opaca = edificio decimato + tronchi + ostacoli vicini (tutto in un unico BVH)
    opaque_geoms = []
    for g in all_geoms:
        if id(g) in canopy_geom_ids:
            continue  # chiome testate separatamente
        if id(g) == building_geom_id:
            opaque_geoms.append(shadow_building_mesh)
        elif id(g) in nearby_obs_ids:
            opaque_geoms.append(g)  # ostacolo vicino
        elif id(g) not in set(id(om) for om in obstacle_meshes):
            opaque_geoms.append(g)  # tronchi e altro
        # else: ostacolo lontano → skip
    opaque_mesh = trimesh.util.concatenate(opaque_geoms) if opaque_geoms else None

    # ray_mesh per SVF: usa solo edificio decimato (molto più leggero)
    svf_mesh = shadow_building_mesh

    # Cache BVH per riutilizzo
    dec_target = DECIMATION_TARGET if len(building_mesh.faces) > DECIMATION_THRESHOLD else None
    if opaque_mesh is not None:
        opaque_mesh = _get_cached_intersector(
            opaque_mesh, "opaque", plane_y=shadow_plane_y, decimation_target=dec_target
        )

    logger.info(
        f"[shadow] opaque mesh: {len(opaque_mesh.faces) if opaque_mesh else 0} faces "
        f"(nearby obstacles: {len(nearby_obstacles)}/{len(obstacle_meshes)})"
    )

    face_normals = building_mesh.face_normals[tri_indices]  # (N_points, 3)
    normal_offset = 0.02
    start_points = roof_points + face_normals * normal_offset

    # ── Calcolo vettorizzato cos_theta per tutte le coppie (punto, sole) ──
    cos_theta_all = face_normals @ sun_vectors.T  # (N_points, N_suns)

    # Maschera front-facing: solo dove il sole è davanti alla superficie
    front_mask = cos_theta_all > 0

    # Indici (punto, sole) di tutte le coppie front-facing
    pt_idx, sun_idx = np.where(front_mask)
    total_rays = len(pt_idx)

    logger.info(
        f"[shadow] grid={resolution}x{resolution} points={N_points} "
        f"vectors={N_suns} front_facing_rays={total_rays} "
        f"setup={_t_solar - _t0:.2f}s"
    )

    # Irradianza accumulata per punto
    irradiance_accum = np.zeros(N_points)
    # Contribution per-ray (cos_θ·att) — sempre definito anche senza raggi o canopy,
    # serve al calcolo degli aggregati F_s,m energy-weighted/time-avg (Step 10).
    contribution = np.zeros(total_rays)
    all_cos = np.zeros(0)

    if total_rays > 0:
        all_origins = start_points[pt_idx]
        all_directions = sun_vectors[sun_idx]
        all_cos = cos_theta_all[pt_idx, sun_idx]

        _t_rays_start = _time.perf_counter()

        # Pass 1: SINGOLO batch contro mesh opaca completa (edificio + ostacoli)
        if opaque_mesh is not None:
            opaque_hit = _batch_intersects(opaque_mesh, all_origins, all_directions)
        else:
            opaque_hit = np.zeros(total_rays, dtype=bool)

        _t_opaque = _time.perf_counter()
        logger.info(f"[shadow] opaque raycasting: {total_rays} rays in {_t_opaque - _t_rays_start:.2f}s")

        if canopy_meshes and len(canopy_meshes) > 0:
            # Pass 2: per raggi non bloccati, test chiome con filtro distanza
            not_opaque_mask = ~opaque_hit
            canopy_check = np.where(not_opaque_mask)[0]

            if len(canopy_check) > 0:
                attenuation = np.ones(len(canopy_check))
                check_origins = all_origins[canopy_check]
                check_dirs = all_directions[canopy_check]
                check_months = month_indices[sun_idx[canopy_check]]

                for cm in canopy_meshes:
                    cm_center = cm['mesh'].centroid
                    dist = np.linalg.norm(cm_center - grid_center)
                    if dist > 50.0:
                        continue

                    hit = _batch_intersects(cm['mesh'], check_origins, check_dirs)
                    if np.any(hit):
                        trans_arr = np.array(cm['transmissivity'])
                        ray_trans = trans_arr[check_months - 1]
                        attenuation[hit] *= ray_trans[hit]

                contribution[canopy_check] = all_cos[canopy_check] * attenuation
                np.add.at(irradiance_accum, pt_idx, contribution)
        else:
            not_hit = ~opaque_hit
            contribution = np.where(not_hit, all_cos, 0.0)
            np.add.at(irradiance_accum, pt_idx, contribution)

        _t_canopy = _time.perf_counter()
        logger.info(f"[shadow] canopy raycasting: {_t_canopy - _t_opaque:.2f}s")

    _t_rays_done = _time.perf_counter()

    # 4b. Fattore diffuso F_s,d: isotropo (SVF) o anisotropo Brunger-Hooper
    sky_model = getattr(request, 'sky_model', 'isotropic') or 'isotropic'
    if sky_model == 'brunger_hooper':
        from app.services.sky_diffuse import (
            compute_diffuse_shading_factor, compute_surface_obstruction_factors,
        )
        k_d = getattr(request, 'diffuse_fraction_kd', 0.35)
        logger.info(
            f"[shadow] Sky model = 'brunger_hooper' (K_d={k_d:.2f}): "
            f"calcolo F_s,d anisotropo — può richiedere più tempo del modello isotropo"
        )
        diffuse_factor = compute_diffuse_shading_factor(
            cell_points=roof_points,
            cell_normals=face_normals,
            ray_mesh=svf_mesh,
            sun_vectors=sun_vectors,
            K_d=k_d,
        )
        # By-product Step 8: F_s,th (cielo oscurato) e F_s,rh (terreno oscurato)
        # per-cella, alimentano il modello riflesso di Eq. 4.2 in solar_service.
        f_s_th, f_s_rh = compute_surface_obstruction_factors(
            cell_points=roof_points,
            cell_normals=face_normals,
            ray_mesh=svf_mesh,
        )
        logger.info(
            f"[shadow] Eq. 4.2 factors: F_s,th mean={f_s_th.mean():.3f} "
            f"F_s,rh mean={f_s_rh.mean():.3f}"
        )
    else:
        diffuse_factor = compute_sky_view_factor(roof_points, face_normals, svf_mesh)
    _t_svf = _time.perf_counter()
    logger.info(
        f"[shadow] diffuse ({sky_model}): {_t_svf - _t_rays_done:.2f}s "
        f"(mesh faces: {len(svf_mesh.faces)})"
    )

    # 5. Normalizzazione con riferimento ASSOLUTO e composizione diretta + diffusa
    horizontal_ref = np.sum(np.maximum(sun_vectors[:, 1], 0.0))
    if horizontal_ref < 1e-9:
        horizontal_ref = 1.0

    direct_normalized = irradiance_accum / horizontal_ref

    DIRECT_FRACTION = 0.65
    DIFFUSE_FRACTION = 0.35
    irradiance_normalized = DIRECT_FRACTION * direct_normalized + DIFFUSE_FRACTION * diffuse_factor
    irradiance_normalized = np.clip(irradiance_normalized, 0.0, 1.0)

    shadow_fraction = 1.0 - irradiance_normalized

    # 5b. Aggregati F_s,m energy-weighted vs time-avg (Step 10, Eq. 4.46 / UNI/TS 11300-1)
    agg = _aggregate_cell_shading(
        pt_idx, sun_idx, all_cos, contribution,
        month_indices, N_points,
        diffuse_factor,
        direct_fraction=DIRECT_FRACTION, diffuse_fraction=DIFFUSE_FRACTION,
    )
    delta_annual = agg['annual_energy'] - agg['annual_time']
    logger.info(
        f"[shadow] Step 10 F_s,m annual: energy-weighted={agg['annual_energy']*100:.2f}% "
        f"time-avg={agg['annual_time']*100:.2f}% δ={delta_annual*100:+.2f}pp"
    )

    # Mappa back to grid
    if polygon_mask is not None:
        final_grid = np.zeros(resolution * resolution)
        final_grid[outside_grid_indices] = -1.0
        final_grid[point_indices] = shadow_fraction
    else:
        final_grid = np.zeros(resolution * resolution)
        final_grid[point_indices] = shadow_fraction

    final_grid_reshaped = final_grid.reshape((resolution, resolution))

    # Statistiche
    avg_shadow = np.mean(shadow_fraction)
    free_area_pct = np.mean(shadow_fraction < 0.1) * 100

    elapsed = _time.perf_counter() - _t0
    logger.info(
        f"[shadow] DONE grid={resolution}x{resolution} vectors={N_suns} "
        f"rays={total_rays} elapsed={elapsed:.2f}s"
    )

    # Conversione aggregati Step 10 in percentuali per il contratto REST
    annual_energy_pct = float(agg['annual_energy'] * 100.0)
    annual_time_pct = float(agg['annual_time'] * 100.0)
    monthly_energy_pct = {str(m): float(v * 100.0) for m, v in agg['monthly_energy'].items()}
    monthly_time_pct = {str(m): float(v * 100.0) for m, v in agg['monthly_time'].items()}

    return ShadowResponse(
        shadow_grid=final_grid_reshaped.tolist(),
        grid_bounds={
            'min_x': float(domain_min_x),
            'max_x': float(domain_max_x),
            'min_z': float(domain_min_z),
            'max_z': float(domain_max_z),
            'max_roof_y': max_roof_y
        },
        monthly_shadows={"Year": float(avg_shadow)},
        statistics={"free_area_pct": float(free_area_pct)},
        computation_time_s=round(elapsed, 2),
        annual_shading_pct=annual_energy_pct,
        annual_shading_pct_energy_weighted=annual_energy_pct,
        annual_shading_pct_time_avg=annual_time_pct,
        monthly_shading_pct=monthly_energy_pct,
        monthly_shading_pct_energy_weighted=monthly_energy_pct,
        monthly_shading_pct_time_avg=monthly_time_pct,
    )
