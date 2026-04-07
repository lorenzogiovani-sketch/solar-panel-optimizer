"""
Servizio di ottimizzazione layout pannelli solari.

Strategia: Seed-and-Grow greedy che parte dal punto con massima irradianza
e si espande via BFS, garantendo layout compatti e side-adjacent.
"""

import logging
import math
import heapq
import numpy as np
from typing import Optional, List
from app.services.thermal import calc_temp_derating
from app.models.optimization import (
    OptimizationRequest,
    OptimizationResult,
    PanelPosition,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: tilt/azimuth effettivo per falda del tetto
# ---------------------------------------------------------------------------

def _compute_effective_tilt_azimuth(cx, cy, bg, building_azimuth: float):
    """Calcola tilt e azimuth effettivi per un pannello in posizione (cx, cy).

    Nel frame locale dell'edificio:
    - cy < 0 = local -Z → world direction = buildingAzimuth
    - cy >= 0 = local +Z → world direction = (buildingAzimuth + 180) % 360
    - cx >= 0 = local +X, cx < 0 = local -X

    Args:
        cx: coordinata X locale (est-ovest)
        cy: coordinata Y locale (nord-sud, corrisponde a Z in Three.js)
        bg: BuildingGeometry
        building_azimuth: azimuth edificio in gradi (conv. pvlib)

    Returns:
        (tilt_deg, azimuth_deg)
    """
    if bg.roof_type == 'flat':
        return 0.0, building_azimuth

    if bg.roof_type == 'gable' and bg.roof_angle == 0:
        return 0.0, building_azimuth

    if bg.roof_type == 'gable':
        tilt = bg.roof_angle
        if cy < 0:
            return tilt, building_azimuth
        return tilt, (building_azimuth + 180) % 360

    if bg.roof_type == 'hip':
        half_w = bg.width / 2
        half_d = bg.depth / 2
        rh = bg.ridge_height
        rl = min(bg.ridge_length, bg.width)
        hrl = rl / 2
        slope_run_ew = half_w - hrl

        abs_x = abs(cx)
        abs_y = abs(cy)
        is_ns = (abs_x <= hrl or slope_run_ew <= 0 or
                 abs_y * slope_run_ew >= (abs_x - hrl) * half_d)

        if is_ns:
            tilt = math.degrees(math.atan2(rh, half_d))
            if cy >= 0:
                return tilt, (building_azimuth + 180) % 360
            return tilt, building_azimuth
        else:
            tilt = math.degrees(math.atan2(rh, slope_run_ew))
            if cx >= 0:
                return tilt, ((90 - building_azimuth) % 360 + 360) % 360
            return tilt, ((270 - building_azimuth) % 360 + 360) % 360

    return 0.0, building_azimuth


# ---------------------------------------------------------------------------
# Helper: contiguità pannelli (Union-Find)
# ---------------------------------------------------------------------------

def _are_side_adjacent(cx1, cy1, pw1, ph1, cx2, cy2, pw2, ph2, tol=0.15):
    """
    Verifica se due pannelli sono adiacenti lato-su-lato (Von Neumann).
    Due pannelli sono adiacenti se:
    - Orizzontalmente: |dx - (pw1+pw2)/2| < tol  AND  |dy| < min(ph1,ph2)/2 + tol
    - Verticalmente:   |dy - (ph1+ph2)/2| < tol  AND  |dx| < min(pw1,pw2)/2 + tol
    """
    dx = abs(cx1 - cx2)
    dy = abs(cy1 - cy2)
    horiz_dist = (pw1 + pw2) / 2.0
    vert_dist = (ph1 + ph2) / 2.0
    if abs(dx - horiz_dist) < tol and dy < min(ph1, ph2) / 2.0 + tol:
        return True
    if abs(dy - vert_dist) < tol and dx < min(pw1, pw2) / 2.0 + tol:
        return True
    return False


def _build_adjacency(panel_positions, tol=0.15):
    """
    Costruisce la lista di adiacenza e restituisce (adj, parent) dove:
    - adj[i] = set di indici adiacenti a i
    - parent = Union-Find per componenti connesse

    panel_positions: list of (cx, cy, eff_pw, eff_ph)
    """
    n = len(panel_positions)
    adj = [set() for _ in range(n)]
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[a] = b

    for i in range(n):
        cx1, cy1, pw1, ph1 = panel_positions[i]
        for j in range(i + 1, n):
            cx2, cy2, pw2, ph2 = panel_positions[j]
            if _are_side_adjacent(cx1, cy1, pw1, ph1, cx2, cy2, pw2, ph2, tol):
                adj[i].add(j)
                adj[j].add(i)
                union(i, j)

    return adj, parent, find


def _count_isolated(panel_positions):
    """
    Conta quanti pannelli sono completamente isolati (nessun vicino lato-su-lato).
    Ritorna il numero di pannelli isolati.
    """
    n = len(panel_positions)
    if n <= 1:
        return 0
    adj, _, _ = _build_adjacency(panel_positions)
    return sum(1 for i in range(n) if len(adj[i]) == 0)


# ---------------------------------------------------------------------------
# Helper: interpolazione shadow_grid
# ---------------------------------------------------------------------------

def _build_grid_info(shadow_grid: Optional[list], bw: float, bd: float, grid_bounds: Optional[dict] = None):
    """
    Costruisce info della griglia discreta per snap dei pannelli ai centri cella.

    Se grid_bounds è fornito (min_x, max_x, min_z, max_z), i centri cella vengono
    calcolati sui bounds effettivi della griglia (che può essere ristretta alle zone
    di installazione). Altrimenti si assume che la griglia copra [-bw/2, bw/2] × [-bd/2, bd/2].

    Restituisce un dict con:
    - grid: np.array della shadow_grid
    - rows, cols: dimensioni griglia
    - cell_w, cell_h: dimensioni di ogni cella in metri
    - cell_centers_x, cell_centers_y: array con le coordinate dei centri cella
    - half_w, half_d: metà larghezza/profondità griglia

    Se shadow_grid è None, ritorna None.
    """
    if shadow_grid is None:
        return None

    grid = np.array(shadow_grid, dtype=np.float64)
    rows, cols = grid.shape

    if grid_bounds and 'min_x' in grid_bounds:
        gmin_x = grid_bounds['min_x']
        gmax_x = grid_bounds['max_x']
        gmin_z = grid_bounds['min_z']
        gmax_z = grid_bounds['max_z']
        gw = gmax_x - gmin_x
        gd = gmax_z - gmin_z
    else:
        gw = bw
        gd = bd
        gmin_x = -bw / 2.0
        gmin_z = -bd / 2.0

    cell_w = gw / cols
    cell_h = gd / rows

    cell_centers_x = np.array([gmin_x + (c + 0.5) * cell_w for c in range(cols)])
    cell_centers_y = np.array([gmin_z + (r + 0.5) * cell_h for r in range(rows)])

    return {
        'grid': grid,
        'rows': rows,
        'cols': cols,
        'cell_w': cell_w,
        'cell_h': cell_h,
        'cell_centers_x': cell_centers_x,
        'cell_centers_y': cell_centers_y,
        'half_w': gw / 2.0,
        'half_d': gd / 2.0,
    }


def _snap_to_grid(x: float, y: float, grid_info: dict):
    """Snappa una posizione (x,y) al centro della cella più vicina."""
    cx = grid_info['cell_centers_x']
    cy = grid_info['cell_centers_y']
    col = int(np.argmin(np.abs(cx - x)))
    row = int(np.argmin(np.abs(cy - y)))
    return cx[col], cy[row], col, row


def _panel_cells_irradiance(x: float, y: float, pw: float, ph: float, grid_info: dict):
    """
    Calcola il fattore di irradianza medio per un pannello centrato in (x,y)
    come media dei valori (1 - ombra) delle celle della griglia che il pannello occupa.
    """
    if grid_info is None:
        return 1.0

    grid = grid_info['grid']
    cx = grid_info['cell_centers_x']
    cy = grid_info['cell_centers_y']
    half_pw = pw / 2.0
    half_ph = ph / 2.0

    # Trova le celle il cui centro cade dentro il rettangolo del pannello
    col_mask = (cx >= x - half_pw) & (cx <= x + half_pw)
    row_mask = (cy >= y - half_ph) & (cy <= y + half_ph)

    cols_in = np.where(col_mask)[0]
    rows_in = np.where(row_mask)[0]

    if len(cols_in) == 0 or len(rows_in) == 0:
        # Fallback: cella singola più vicina
        _, _, col, row = _snap_to_grid(x, y, grid_info)
        val = grid[row, col]
        if val < 0:
            return 0.0  # sentinel: fuori dal poligono → nessuna irradianza
        return max(0.0, 1.0 - val)

    # Media dei valori di irradianza sulle celle coperte
    shadow_vals = grid[np.ix_(rows_in, cols_in)].ravel()
    # Escludi celle sentinella (-1 = fuori dal poligono)
    valid = shadow_vals[shadow_vals >= 0]
    if len(valid) == 0:
        return 0.0  # tutte le celle fuori dal poligono
    return max(0.0, 1.0 - float(np.mean(valid)))


# ---------------------------------------------------------------------------
# Helper: vincoli geometrici
# ---------------------------------------------------------------------------

def _panel_rect(x, y, pw, ph):
    """Ritorna (min_x, min_y, max_x, max_y) del pannello centrato in (x,y)."""
    return (x - pw / 2, y - ph / 2, x + pw / 2, y + ph / 2)


def _rects_overlap(r1, r2):
    """True se due rettangoli (min_x, min_y, max_x, max_y) si sovrappongono."""
    return not (r1[2] <= r2[0] or r2[2] <= r1[0] or r1[3] <= r2[1] or r2[3] <= r1[1])


def _point_in_polygon(px: float, py: float, polygon: list) -> bool:
    """
    Ray casting algorithm per verificare se il punto (px, py) è dentro il poligono.
    polygon è una lista di dict {"x": float, "z": float}.
    """
    inside = False
    n = len(polygon)
    p1 = polygon[0]
    for i in range(1, n + 1):
        p2 = polygon[i % n]
        if min(p1["z"], p2["z"]) < py <= max(p1["z"], p2["z"]):
            if px <= max(p1["x"], p2["x"]):
                if p1["z"] != p2["z"]:
                    xinters = (py - p1["z"]) * (p2["x"] - p1["x"]) / (p2["z"] - p1["z"]) + p1["x"]
                if p1["x"] == p2["x"] or px <= xinters:
                    inside = not inside
        p1 = p2
    return inside


def _panel_in_polygon(cx: float, cy: float, pw: float, ph: float, polygon: list) -> bool:
    """
    Verifica che tutti e 4 gli angoli del pannello centrato in (cx, cy)
    siano dentro il poligono. Così l'intero pannello resta nell'area.
    """
    half_w = pw / 2.0
    half_h = ph / 2.0
    corners = [
        (cx - half_w, cy - half_h),
        (cx + half_w, cy - half_h),
        (cx + half_w, cy + half_h),
        (cx - half_w, cy + half_h),
    ]
    return all(_point_in_polygon(x, y, polygon) for x, y in corners)


def _point_in_any_polygon(px: float, py: float, polygons: list) -> bool:
    """Verifica se il punto è dentro almeno uno dei poligoni."""
    return any(_point_in_polygon(px, py, p) for p in polygons)


def _panel_in_any_polygon(cx: float, cy: float, pw: float, ph: float, polygons: list) -> bool:
    """Verifica se il pannello è interamente contenuto in almeno uno dei poligoni."""
    return any(_panel_in_polygon(cx, cy, pw, ph, p) for p in polygons)


def _compute_uniform_baseline(bw, bd, pw, ph, margin, min_dist, panel_power_kw, annual_irr, grid_info,
                               temp_derating=1.0, system_loss_factor=0.86):
    """
    Calcola l'energia di un layout a griglia regolare (baseline)
    per confronto con il layout ottimizzato.
    Formula power-based: E = irr_factor × annual_irr × panel_power_kw × temp_derating × system_loss_factor
    """
    spacing_x = pw + min_dist
    spacing_y = ph + min_dist

    x_start = -bw / 2 + margin + pw / 2
    y_start = -bd / 2 + margin + ph / 2
    x_end = bw / 2 - margin - pw / 2
    y_end = bd / 2 - margin - ph / 2

    total = 0.0
    x = x_start
    while x <= x_end:
        y = y_start
        while y <= y_end:
            irr = _panel_cells_irradiance(x, y, pw, ph, grid_info)
            total += irr * annual_irr * panel_power_kw * temp_derating * system_loss_factor
            y += spacing_y
        x += spacing_x

    return total


# ---------------------------------------------------------------------------
# Strategia Seed-and-Grow (greedy compatto)
# ---------------------------------------------------------------------------

def _build_obstacle_rects(obstacles, building_height):
    """
    Costruisce una lista di AABB 2D (min_x, min_y, max_x, max_y) dagli ostacoli
    sul tetto, proiettati nel piano locale del tetto (x = width, y = depth/z).
    Solo ostacoli con placement='roof' o posizione Y >= building_height vengono inclusi.
    """
    rects = []
    if not obstacles:
        return rects
    for obs in obstacles:
        pos = obs.get("position", [0, 0, 0])
        dims = obs.get("dimensions", [1, 1, 1])
        obs_type = obs.get("type", "box")

        # pos = [x, y, z] in Three.js local space (y = up, z = depth)
        ox, oy, oz = float(pos[0]), float(pos[1]), float(pos[2])
        ow, oh, od = float(dims[0]), float(dims[1]), float(dims[2])

        # Solo ostacoli sul tetto (y vicino a building_height o superiore)
        placement = obs.get("placement", "roof")
        if placement == "ground" and oy < building_height * 0.5:
            continue

        if obs_type in ("cylinder", "tree"):
            # Per cilindri/alberi, il footprint è un cerchio → usiamo AABB del cerchio
            radius = ow / 2.0
            canopy_r = obs.get("canopyRadius", 0)
            r = max(radius, canopy_r)
            rects.append((ox - r, oz - r, ox + r, oz + r))
        else:
            # Box / chimney / antenna / building → AABB
            rects.append((ox - ow / 2.0, oz - od / 2.0, ox + ow / 2.0, oz + od / 2.0))

    return rects


def _panel_overlaps_obstacle(panel_rect, obstacle_rects):
    """Verifica se un pannello si sovrappone a qualsiasi ostacolo."""
    for obs_r in obstacle_rects:
        if _rects_overlap(panel_rect, obs_r):
            return True
    return False


# Soglia irradianza minima: celle con irradianza sotto questa frazione
# rispetto al seed vengono scartate durante il BFS.
_IRR_MIN_RATIO = 0.3


def _seed_and_grow_single(
    request: OptimizationRequest,
    forced_orientation: int,
    progress_callback=None,
) -> OptimizationResult:
    """
    Core Seed-and-Grow per un singolo orientamento forzato.

    Args:
        forced_orientation: 0 = portrait (pw × ph), 1 = landscape (ph × pw)
    """

    bg = request.building_geometry
    ps = request.panel_specs
    cs = request.constraints

    bw = bg.width
    bd = bg.depth
    pw = ps.width
    ph = ps.height
    panel_power_kw = ps.power / 1000.0  # kW @ STC
    annual_irr = request.annual_irradiance
    face_irr_map = getattr(request, 'face_irradiances', None) or {}
    system_loss_factor = 1.0 - getattr(request, 'system_losses', 0.14)

    margin = cs.roof_margin
    min_dist = cs.min_distance

    # Calcola max_panels da max_peak_power se fornito
    if cs.max_peak_power is not None and cs.max_peak_power > 0:
        panel_power_kw_unit = ps.power / 1000.0
        if panel_power_kw_unit > 0:
            max_panels = int(cs.max_peak_power / panel_power_kw_unit)
            if cs.max_panels is not None:
                max_panels = min(max_panels, cs.max_panels)
        else:
            max_panels = cs.max_panels or 50
    elif cs.max_panels is not None:
        max_panels = cs.max_panels
    else:
        max_panels = 50

    # Derating termico
    temp_derating = calc_temp_derating(ps.temp_coefficient, ps.noct_temperature)

    # Area utile
    usable_half_w = bw / 2.0 - margin
    usable_half_d = bd / 2.0 - margin
    x_min = -usable_half_w
    x_max = usable_half_w
    y_min = -usable_half_d
    y_max = usable_half_d

    empty_result = OptimizationResult(
        panels=[], total_panels=0, total_power_kw=0,
        total_energy_kwh=0, improvement_pct=0,
        convergence_history=[], best_fitness_per_generation=[],
    )

    if x_max <= x_min or y_max <= y_min:
        return empty_result

    grid_info = _build_grid_info(request.shadow_grid, bw, bd, request.grid_bounds)

    polys = [p for p in (request.installation_polygons or []) if len(p) >= 3]
    use_polygon = len(polys) > 0

    # Ostacoli → AABB 2D sul piano del tetto
    obstacle_rects = _build_obstacle_rects(request.obstacles, bg.height)

    # -----------------------------------------------------------------------
    # Fase 1: Costruisci griglia candidati (orientamento forzato)
    # -----------------------------------------------------------------------
    if forced_orientation == 1:
        epw, eph, ori = ph, pw, 1  # landscape
    else:
        epw, eph, ori = pw, ph, 0  # portrait

    # Proiezione orizzontale dell'altezza pannello sulla falda (per tetti a falda)
    if bg.roof_type in ('gable', 'hip') and bg.roof_angle > 0:
        eph_proj = eph * math.cos(math.radians(bg.roof_angle))
    else:
        eph_proj = eph

    orientation_str = "landscape" if forced_orientation == 1 else "portrait"

    # Vincolo colmo: per tetti gable, i pannelli non possono scavalcare la
    # linea di colmo (y = 0). Un pannello è valido solo se sta interamente
    # su una delle due falde.
    is_gable = bg.roof_type == 'gable' and bg.roof_angle > 0

    def _crosses_ridge(cy, half_h):
        """True se il pannello centrato in cy scavalca il colmo (y=0)."""
        if not is_gable:
            return False
        return (cy - half_h) < 0 < (cy + half_h)

    candidates = []
    cx = x_min + epw / 2.0
    while cx <= x_max - epw / 2.0:
        cy = y_min + eph_proj / 2.0
        while cy <= y_max - eph_proj / 2.0:
            if _crosses_ridge(cy, eph_proj / 2.0):
                cy += eph_proj
                continue
            r = _panel_rect(cx, cy, epw, eph_proj)
            if r[0] >= -usable_half_w and r[2] <= usable_half_w and \
               r[1] >= -usable_half_d and r[3] <= usable_half_d:
                if not _panel_overlaps_obstacle(r, obstacle_rects):
                    if not use_polygon or _panel_in_any_polygon(cx, cy, epw, eph_proj, polys):
                        irr = _panel_cells_irradiance(cx, cy, epw, eph_proj, grid_info)
                        if irr > 0.0:
                            candidates.append((irr, cx, cy))
            cy += eph_proj
        cx += epw

    candidates.sort(key=lambda t: t[0], reverse=True)

    if not candidates:
        return empty_result

    # -----------------------------------------------------------------------
    # Fase 2-4: Seed + Priority-BFS Grow + Multi-seed
    # -----------------------------------------------------------------------
    placed_set = set()      # (cx_round, cy_round) per lookup O(1)
    placed_list = []        # (cx, cy, irr)
    occupied_rects = []     # (min_x, min_y, max_x, max_y)

    def _round_key(cx, cy):
        return (round(cx, 4), round(cy, 4))

    def _can_place(cx, cy):
        if _round_key(cx, cy) in placed_set:
            return False
        if _crosses_ridge(cy, eph_proj / 2.0):
            return False
        r = _panel_rect(cx, cy, epw, eph_proj)
        for existing_r in occupied_rects:
            if _rects_overlap(r, existing_r):
                return False
        return True

    def _place(cx, cy, irr):
        placed_set.add(_round_key(cx, cy))
        placed_list.append((cx, cy, irr))
        occupied_rects.append(_panel_rect(cx, cy, epw, eph_proj))

    def _grow_from_seed(seed_cx, seed_cy, seed_irr):
        """Espansione dal seed tramite max-heap (priorità per irradianza)."""
        if not _can_place(seed_cx, seed_cy):
            return
        _place(seed_cx, seed_cy, seed_irr)

        irr_threshold = seed_irr * _IRR_MIN_RATIO

        heap = []
        _push_neighbors(heap, seed_cx, seed_cy, irr_threshold)

        while heap and len(placed_list) < max_panels:
            neg_irr, ncx, ncy = heapq.heappop(heap)

            if not _can_place(ncx, ncy):
                continue

            irr = -neg_irr
            _place(ncx, ncy, irr)
            _push_neighbors(heap, ncx, ncy, irr_threshold)

            if progress_callback:
                progress_callback(
                    len(placed_list), max_panels,
                    len(placed_list) * ps.power / 1000.0,
                )

    def _push_neighbors(heap, cx, cy, irr_threshold):
        """Aggiunge i 4 vicini Von Neumann all'heap se validi."""
        neighbors = [
            (cx + epw, cy),       # destra
            (cx - epw, cy),       # sinistra
            (cx, cy + eph_proj),  # su
            (cx, cy - eph_proj),  # giù
        ]

        for ncx, ncy in neighbors:
            if _round_key(ncx, ncy) in placed_set:
                continue

            if _crosses_ridge(ncy, eph_proj / 2.0):
                continue

            r = _panel_rect(ncx, ncy, epw, eph_proj)
            if r[0] < -usable_half_w or r[2] > usable_half_w or \
               r[1] < -usable_half_d or r[3] > usable_half_d:
                continue

            if _panel_overlaps_obstacle(r, obstacle_rects):
                continue

            if use_polygon and not _panel_in_any_polygon(ncx, ncy, epw, eph_proj, polys):
                continue

            irr = _panel_cells_irradiance(ncx, ncy, epw, eph_proj, grid_info)
            if irr < irr_threshold:
                continue

            heapq.heappush(heap, (-irr, ncx, ncy))

    # Itera sui candidati come potenziali seed (multi-seed sempre abilitato)
    for irr, cx, cy in candidates:
        if len(placed_list) >= max_panels:
            break
        if _can_place(cx, cy):
            _grow_from_seed(cx, cy, irr)

    # -----------------------------------------------------------------------
    # Fase 5: Output
    # -----------------------------------------------------------------------
    panels_out = []
    total_energy = 0.0
    panel_power_kw = ps.power / 1000.0

    b_az = getattr(request, 'building_azimuth', 180.0)

    # Fallback di ultima istanza: se il tetto ha falde inclinate ma face_irradiances
    # non è stato fornito (né dal frontend né dal calcolo pvlib nel router),
    # applica una correzione geometrica approssimata basata su sin(tilt).
    # Normalmente questo non dovrebbe accadere: il router /optimize/run calcola
    # le irradianze per-falda via pvlib se lat/lon è disponibile.
    # Determina se il tetto ha effettivamente falde inclinate
    _has_slope = False
    if bg.roof_type == 'gable' and bg.roof_angle > 0:
        _has_slope = True
    elif bg.roof_type == 'hip' and bg.ridge_height > 0:
        _has_slope = True

    if not face_irr_map and _has_slope:
        # Calcola il tilt effettivo delle falde NS
        if bg.roof_type == 'gable':
            tilt_ns = bg.roof_angle
        else:
            tilt_ns = math.degrees(math.atan2(bg.ridge_height, bg.depth / 2))

        logger.warning(
            "face_irradiances non fornito per tetto %s (tilt_ns=%.1f°): "
            "uso correzione geometrica approssimata",
            bg.roof_type, tilt_ns,
        )
        tilt_rad = math.radians(tilt_ns)
        sin_t = math.sin(tilt_rad)
        # NB: la label 'north' = local -Z = guarda verso SUD → alta irradianza
        #     la label 'south' = local +Z = guarda verso NORD → bassa irradianza
        # Approssimazione valida per latitudini medie europee (35-50°N)
        facing_south_factor = 1.0 + 0.15 * sin_t  # face 'north' (faces south)
        facing_north_factor = 1.0 - 0.40 * sin_t  # face 'south' (faces north)
        face_irr_map = {
            'north': annual_irr * facing_south_factor,
            'south': annual_irr * facing_north_factor,
        }
        if bg.roof_type == 'hip':
            # Falde est/ovest: fattore intermedio (meno favorevoli di sud, meglio di nord)
            half_w = bg.width / 2
            hrl = min(bg.ridge_length, bg.width) / 2
            slope_run_ew = half_w - hrl
            if slope_run_ew > 0:
                tilt_ew = math.degrees(math.atan2(bg.ridge_height, slope_run_ew))
                sin_ew = math.sin(math.radians(tilt_ew))
            else:
                sin_ew = sin_t
            ew_factor = 1.0 - 0.10 * sin_ew
            face_irr_map['east'] = annual_irr * ew_factor
            face_irr_map['west'] = annual_irr * ew_factor

    # Mappa face label → irradianza annua, con fallback al valore globale
    def _face_label(cy_val, cx_val):
        """Determina il label della falda per lookup irradianza."""
        if bg.roof_type == 'gable':
            return 'north' if cy_val < 0 else 'south'
        if bg.roof_type == 'hip':
            half_w = bg.width / 2
            half_d = bg.depth / 2
            hrl_v = min(bg.ridge_length, bg.width) / 2
            srew = half_w - hrl_v
            ax, az_ = abs(cx_val), abs(cy_val)
            is_ns = (ax <= hrl_v or srew <= 0 or az_ * srew >= (ax - hrl_v) * half_d)
            if is_ns:
                return 'south' if cy_val >= 0 else 'north'
            return 'east' if cx_val >= 0 else 'west'
        return 'flat'

    for cx, cy, irr in placed_list:
        eff_tilt, eff_az = _compute_effective_tilt_azimuth(cx, cy, bg, b_az)
        panels_out.append(PanelPosition(
            x=round(cx, 3),
            y=round(cy, 3),
            irradiance_factor=round(irr, 3),
            orientation=orientation_str,
            effective_tilt=round(eff_tilt, 1),
            effective_azimuth=round(eff_az, 1),
        ))
        # Usa irradianza per-falda se disponibile, altrimenti valore globale
        fl = _face_label(cy, cx)
        panel_annual_irr = face_irr_map.get(fl, annual_irr)
        total_energy += irr * panel_annual_irr * panel_power_kw * temp_derating * system_loss_factor

    total_panels = len(panels_out)
    total_power_kw = total_panels * panel_power_kw

    baseline = _compute_uniform_baseline(
        bw, bd, pw, ph, margin, min_dist, panel_power_kw, annual_irr, grid_info,
        temp_derating, system_loss_factor
    )
    improvement = 0.0
    if baseline > 0:
        improvement = ((total_energy - baseline) / baseline) * 100.0

    if progress_callback:
        progress_callback(max_panels, max_panels, total_power_kw)

    return OptimizationResult(
        panels=panels_out,
        total_panels=total_panels,
        total_power_kw=round(total_power_kw, 2),
        total_energy_kwh=round(total_energy, 1),
        improvement_pct=round(improvement, 1),
        convergence_history=[],
        best_fitness_per_generation=[],
    )


def run_seed_and_grow(
    request: OptimizationRequest,
    progress_callback=None,
) -> OptimizationResult:
    """
    Seed-and-Grow con auto-selezione intelligente dell'orientamento.

    Esegue l'algoritmo due volte (Portrait e Landscape), confronta il
    rendimento specifico (kWh/kWp) e restituisce il layout migliore.
    """

    # --- Validazione input ---
    bg = request.building_geometry
    ps = request.panel_specs
    polys = [p for p in (request.installation_polygons or []) if len(p) >= 3]

    logger.info(
        f"Seed-and-Grow input: building={bg.width}x{bg.depth}x{bg.height}m, "
        f"roof={bg.roof_type}, panel={ps.width}x{ps.height}m ({ps.power}W), "
        f"shadow_grid={'None' if request.shadow_grid is None else (f'{len(request.shadow_grid)}x{len(request.shadow_grid[0])}' if request.shadow_grid else '0x0')}, "
        f"zones={len(polys)}, obstacles={len(request.obstacles or [])}, "
        f"annual_irr={request.annual_irradiance}, system_losses={request.system_losses}"
    )

    if not polys:
        logger.warning("Nessuna zona di installazione definita — l'algoritmo userà l'intero tetto")

    if request.shadow_grid is None:
        logger.warning("shadow_grid è None — l'irradianza verrà assunta uniforme (1.0)")

    if ps.power <= 0:
        raise ValueError(f"Potenza pannello non valida: {ps.power}W")

    result_portrait = _seed_and_grow_single(request, forced_orientation=0)
    result_landscape = _seed_and_grow_single(request, forced_orientation=1)

    def _kwh_per_kwp(r: OptimizationResult) -> float:
        if r.total_power_kw > 0:
            return r.total_energy_kwh / r.total_power_kw
        return 0.0

    sp = _kwh_per_kwp(result_portrait)
    sl = _kwh_per_kwp(result_landscape)
    best = result_landscape if sl > sp else result_portrait
    chosen = "landscape" if sl > sp else "portrait"

    logger.info(
        f"Smart orientation: portrait={result_portrait.total_energy_kwh:.0f} kWh "
        f"({result_portrait.total_panels} pan, {sp:.1f} kWh/kWp), "
        f"landscape={result_landscape.total_energy_kwh:.0f} kWh "
        f"({result_landscape.total_panels} pan, {sl:.1f} kWh/kWp) "
        f"→ {chosen} selezionato"
    )

    if progress_callback:
        progress_callback(best.total_panels, best.total_panels, best.total_power_kw)

    return best
