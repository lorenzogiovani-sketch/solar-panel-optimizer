import trimesh
import io
import numpy as np

def process_3d_file(file_content: bytes, filename: str, axis_correction: str = "auto"):
    """
    Carica un file 3D (OBJ, STL, etc.) e restituisce i dati della mesh
    in un formato consumabile dal frontend (vertices, faces).
    """
    file_type = filename.split('.')[-1].lower()
    
    # Carica la mesh
    mesh = trimesh.load(
        io.BytesIO(file_content), 
        file_type=file_type, 
        force='mesh'
    )
    
    # Se è una Scene (es. GLTF con più oggetti), prendiamo la geometria unita o la prima mesh
    if isinstance(mesh, trimesh.Scene):
        if len(mesh.geometry) == 0:
            raise ValueError("Il file non contiene geometrie valide.")
        # Concateniamo tutte le geometrie in un'unica mesh
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))

    # Conversione assi Z-up → Y-up (rotazione -90° attorno a X).
    # OBJ e STL usano quasi sempre Z-up; Three.js usa Y-up.
    if axis_correction == "auto":
        z_up_to_y_up = np.array([
            [1,  0,  0, 0],
            [0,  0,  1, 0],
            [0, -1,  0, 0],
            [0,  0,  0, 1],
        ], dtype=np.float64)
        mesh.apply_transform(z_up_to_y_up)

    # Centra per bounding box midpoint XZ e appoggia a terra (min_y = 0)
    # Usiamo BB midpoint (non centroide) per coerenza col frontend Three.js
    bb_center = (mesh.bounds[0] + mesh.bounds[1]) / 2
    mesh.apply_translation([-bb_center[0], -mesh.bounds[0][1], -bb_center[2]])

    # Normalizzazione dimensioni?
    # Per ora lasciamo scale originale, ma calcoliamo il bounding box
    bounds = mesh.bounds.tolist() # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
    
    # Estraiamo dati
    vertices = mesh.vertices.tolist()
    faces = mesh.faces.tolist()
    
    # Calcoliamo le normali se non ci sono (trimesh lo fa in automatico di solito)
    if mesh.visual.kind == 'face':
         mesh.fix_normals()
         
    return {
        "filename": filename,
        "vertices": vertices,
        "faces": faces,
        "bounds": bounds,
        "vertex_count": len(vertices),
        "face_count": len(faces)
    }
