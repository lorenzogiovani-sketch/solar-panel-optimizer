"""
Test per il modulo sky_diffuse e l'integrazione Brunger-Hooper in shadow_service.

Copre:
  - struttura della griglia 5°×10° (648 patch, Σ dΩ ≈ 2π).
  - scena aperta: F_s,d ≈ 1.0 per tutte le celle (tolleranza 1%).
  - scena con muro alto a Sud: F_s,d < 1 e monotono nella distanza dal muro.
  - regressione: sky_model='isotropic' produce output identico al comportamento storico.
"""
import numpy as np
import pytest
import trimesh

from app.services.sky_diffuse import (
    brunger_hooper_radiance,
    compute_diffuse_shading_factor,
    sky_patch_grid,
)
from app.services.shadow_service import _aggregate_cell_shading
from app.services.vegetation import (
    TREE_TRANSMISSIVITY_TABLE,
    resolve_tree_category,
    resolve_tree_transmissivity,
)


# ─── Griglia patch ────────────────────────────────────────────


def test_sky_patch_grid_default_size():
    grid = sky_patch_grid()
    assert len(grid) == 18 * 36, f"attesi 648 patch, ottenuti {len(grid)}"


def test_sky_patch_grid_solid_angle_sums_to_2pi():
    grid = sky_patch_grid()
    total = grid.solid_angle.sum()
    # Integrale esatto ∫₀^{π/2} sin θ dθ · ∫₀^{2π} dψ = 2π
    assert abs(total - 2 * np.pi) / (2 * np.pi) < 0.02, (
        f"Σ dΩ = {total:.4f}, atteso ≈ {2*np.pi:.4f}"
    )


def test_sky_patch_grid_directions_unit():
    grid = sky_patch_grid()
    norms = np.linalg.norm(grid.directions, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-9)
    # Tutti i vettori hanno y > 0 (emisfero superiore)
    assert np.all(grid.directions[:, 1] > 0)


# ─── Radianza Brunger-Hooper ──────────────────────────────────


def test_brunger_hooper_isotropic_when_kd_is_one():
    """K_d=1 (cielo coperto) → radianza costante (isotropa)."""
    grid = sky_patch_grid()
    sun = np.array([0.0, 1.0, 0.0])  # sole allo zenit
    R = brunger_hooper_radiance(grid.zenith, grid.directions, sun, K_d=1.0)
    assert np.allclose(R, R[0], rtol=1e-9), (
        f"Con K_d=1 la radianza deve essere costante; range = "
        f"[{R.min():.6f}, {R.max():.6f}]"
    )


def test_brunger_hooper_circumsolar_peak_on_clear_sky():
    """K_d=0.2 (cielo sereno) → picco di radianza in direzione del sole."""
    grid = sky_patch_grid()
    sun = np.array([0.0, np.cos(np.radians(60)), -np.sin(np.radians(60))])
    sun /= np.linalg.norm(sun)
    R = brunger_hooper_radiance(grid.zenith, grid.directions, sun, K_d=0.2)
    # La patch più vicina al sole deve avere radianza massima
    cos_Theta = grid.directions @ sun
    i_nearest = int(np.argmax(cos_Theta))
    assert int(np.argmax(R)) == i_nearest


# ─── F_s,d in scena aperta ────────────────────────────────────


def test_f_sd_open_scene_is_one():
    """Scena aperta (nessun ostacolo oltre al tetto stesso): F_s,d ≈ 1 sul tetto."""
    # Mesh remota lontana dalle celle: di fatto nessun blocco.
    far = trimesh.creation.box(extents=[0.1, 0.1, 0.1])
    far.apply_translation([500.0, -500.0, 500.0])
    # Una griglia 5×5 di celle sul piano z=0 con normali verso l'alto
    xs = np.linspace(-2, 2, 5)
    zs = np.linspace(-2, 2, 5)
    X, Z = np.meshgrid(xs, zs)
    cell_points = np.column_stack([X.ravel(), np.zeros(25), Z.ravel()])
    cell_normals = np.tile([0.0, 1.0, 0.0], (25, 1))

    sun = np.array([[0.0, 1.0, 0.0]])  # sole allo zenit
    f_sd = compute_diffuse_shading_factor(
        cell_points, cell_normals, far, sun, K_d=0.35
    )
    # Senza alcuna geometria bloccante, il rapporto numeratore/denominatore è 1.
    assert np.all(f_sd > 0.99), f"f_sd min={f_sd.min():.4f}, atteso ≈ 1.0"


# ─── F_s,d con muro a Sud ──────────────────────────────────────


def test_f_sd_wall_decreases_with_proximity():
    """Un muro alto a Sud riduce F_s,d vicino al muro, non lontano."""
    # Muro verticale 10 m di larghezza, 8 m alto, spesso 0.2 m, centrato a z=+2 (Sud)
    wall = trimesh.creation.box(extents=[10.0, 8.0, 0.2])
    wall.apply_translation([0.0, 4.0, 2.0])

    # Celle lungo la direzione -Z (Nord), dalla base del muro a 4 m di distanza
    z_positions = np.array([1.5, 0.5, -0.5, -1.5, -2.5])  # Nord → lontano dal muro
    cell_points = np.column_stack([
        np.zeros_like(z_positions),
        np.full_like(z_positions, 0.0),
        z_positions,
    ])
    cell_normals = np.tile([0.0, 1.0, 0.0], (len(z_positions), 1))

    # Uso sole a mezzogiorno al Sud (per avere forte componente circumsolare da Sud).
    sun = np.array([[0.0, np.cos(np.radians(60)), np.sin(np.radians(60))]])
    sun /= np.linalg.norm(sun)

    f_sd = compute_diffuse_shading_factor(
        cell_points, cell_normals, wall, sun, K_d=0.3
    )

    # Le celle vicine al muro (z positivo) devono avere F_s,d minore di quelle lontane
    assert f_sd[0] < f_sd[-1], (
        f"Atteso f_sd[vicino]={f_sd[0]:.3f} < f_sd[lontano]={f_sd[-1]:.3f}"
    )
    # Tutte devono essere < 1 (il muro blocca parte del cielo)
    assert np.all(f_sd < 1.0)


# ─── Regressione: sky_model='isotropic' invariato ──────────────


@pytest.mark.asyncio
async def test_isotropic_default_regression(async_client):
    """Il default sky_model='isotropic' preserva l'output storico."""
    payload = {
        'building': {'width': 10, 'depth': 10, 'height': 3, 'roofType': 'flat'},
        'obstacles': [],
        'latitude': 45.0,
        'longitude': 9.0,
        'grid_resolution': 20,
        'timezone': 'Europe/Rome',
        'azimuth': 180,
        'analysis_mode': 'instant',
        'analysis_month': 6,
        'analysis_day': 15,
        'analysis_hour': 12.0,
    }
    # Due richieste identiche: default (isotropic) e esplicito
    r1 = await async_client.post('/api/v1/solar/shadows', json=payload)
    r2 = await async_client.post(
        '/api/v1/solar/shadows', json={**payload, 'sky_model': 'isotropic'}
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    g1 = np.array(r1.json()['shadow_grid'])
    g2 = np.array(r2.json()['shadow_grid'])
    assert np.allclose(g1, g2), "default != sky_model='isotropic' esplicito"


# ─── Vegetation / Tab. 6.2 riferimento ────────────────────────


def test_resolve_tree_transmissivity_deciduous_january():
    """Gennaio, deciduous, no override → valore tabellato (0.80)."""
    assert resolve_tree_transmissivity('cono', 'deciduous', None, 0) == 0.80


def test_resolve_tree_transmissivity_evergreen_july():
    """Luglio, evergreen, no override → ≈ 0.80 (Tab. 6.2 sempreverde)."""
    val = resolve_tree_transmissivity('sfera', 'evergreen', None, 6)
    assert abs(val - 0.80) < 1e-9


def test_resolve_tree_transmissivity_override_ignores_table():
    """Override = [0.5]*12 → la funzione ignora la tabella in ogni mese."""
    override = [0.5] * 12
    for m in range(12):
        assert resolve_tree_transmissivity('cono', 'deciduous', override, m) == 0.5
        assert resolve_tree_transmissivity('sfera', 'evergreen', override, m) == 0.5


def test_resolve_tree_category_mapping():
    """Mapping forma UI → famiglia canonica (Tab. 6.2)."""
    assert resolve_tree_category('cone') == 'truncated_cone'
    assert resolve_tree_category('cono') == 'truncated_cone'
    assert resolve_tree_category('umbrella') == 'truncated_cone'
    assert resolve_tree_category('ombrello') == 'truncated_cone'
    assert resolve_tree_category('sphere') == 'ellipsoidal'
    assert resolve_tree_category('sfera') == 'ellipsoidal'
    assert resolve_tree_category('columnar') == 'ellipsoidal'
    assert resolve_tree_category('colonnare') == 'ellipsoidal'
    # override esplicito
    assert resolve_tree_category('cone', 'ellipsoidal') == 'ellipsoidal'


def test_tree_transmissivity_table_shape():
    """La tabella ha 12 valori mensili in [0,1] per entrambe le colonne."""
    for key in ('deciduous', 'evergreen'):
        vals = TREE_TRANSMISSIVITY_TABLE[key]
        assert len(vals) == 12
        assert all(0.0 <= v <= 1.0 for v in vals)


@pytest.mark.asyncio
async def test_tree_legacy_transmissivity_regression(async_client):
    """Retrocompatibilità: un albero inviato col vecchio contratto (solo
    `foliageType` + `transmissivity` legacy, senza i nuovi campi) produce
    lo stesso output di prima — l'array legacy viene trattato come override."""
    base_payload = {
        'building': {'width': 10, 'depth': 10, 'height': 3, 'roofType': 'flat'},
        'obstacles': [{
            'type': 'tree',
            'position': [3.0, 0.0, 3.0],
            'trunkHeight': 2.0,
            'canopyRadius': 2.0,
            'treeShape': 'cone',
            'foliageType': 'deciduous',
            'transmissivity': [0.80, 0.80, 0.65, 0.40, 0.15, 0.10,
                               0.10, 0.10, 0.15, 0.40, 0.70, 0.80],
        }],
        'latitude': 45.0,
        'longitude': 9.0,
        'grid_resolution': 15,
        'timezone': 'Europe/Rome',
        'azimuth': 180,
        'analysis_mode': 'instant',
        'analysis_month': 6,
        'analysis_day': 15,
        'analysis_hour': 12.0,
    }

    # Stesso payload, aggiungendo esplicitamente gli stessi valori come
    # `monthly_transmissivity_override`: il risultato deve essere identico.
    explicit_payload = {
        **base_payload,
        'obstacles': [{
            **base_payload['obstacles'][0],
            'monthly_transmissivity_override': base_payload['obstacles'][0]['transmissivity'],
        }],
    }

    r1 = await async_client.post('/api/v1/solar/shadows', json=base_payload)
    r2 = await async_client.post('/api/v1/solar/shadows', json=explicit_payload)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    g1 = np.array(r1.json()['shadow_grid'])
    g2 = np.array(r2.json()['shadow_grid'])
    assert np.allclose(g1, g2), "override esplicito != campo legacy con stessi valori"


# ─── Step 10: F_s,m energy-weighted vs time-average ────────────────────


def _agg(pt_idx, sun_idx, all_cos, contribution, month_indices, n_points, diffuse):
    return _aggregate_cell_shading(
        np.asarray(pt_idx, dtype=int),
        np.asarray(sun_idx, dtype=int),
        np.asarray(all_cos, dtype=float),
        np.asarray(contribution, dtype=float),
        np.asarray(month_indices, dtype=int),
        n_points,
        np.asarray(diffuse, dtype=float),
    )


def test_fsm_no_shading_matches_time_and_energy():
    """Scena senza ostacoli: F_s,b=0 ovunque → energy-weighted == time-avg == 0."""
    n_points = 1
    # 4 raggi, tutti non bloccati: contribution == all_cos
    pt_idx = [0, 0, 0, 0]
    sun_idx = [0, 1, 2, 3]
    all_cos = [0.5, 0.7, 0.9, 0.6]
    contribution = list(all_cos)  # nessuna attenuazione
    month_indices = [1, 4, 7, 10]
    diffuse = [1.0]  # diffuse_factor=1 → F_s,d=0

    out = _agg(pt_idx, sun_idx, all_cos, contribution, month_indices, n_points, diffuse)
    assert abs(out['annual_energy']) < 1e-12
    assert abs(out['annual_time']) < 1e-12
    assert abs(out['annual_energy'] - out['annual_time']) < 1e-12


def test_fsm_morning_shadow_energy_weighted_lower():
    """Ombra concentrata di mattina (I_b basso) → energy-weighted < time-avg.
    Il raggio con cos_θ piccolo è quello bloccato: pesa poco nell'integrale energetico
    ma conta 1/4 nella media temporale."""
    n_points = 1
    pt_idx = [0, 0, 0, 0]
    sun_idx = [0, 1, 2, 3]
    # cos_θ bassi al mattino (sun_idx 0,1), alti a mezzogiorno (2,3)
    all_cos = [0.15, 0.25, 0.9, 0.85]
    # Il raggio 0 (mattino, cos basso) è BLOCCATO: F_s,b=1, contribution=0
    contribution = [0.0, 0.25, 0.9, 0.85]
    month_indices = [6, 6, 6, 6]
    diffuse = [1.0]  # escludo contributo diffuso

    out = _agg(pt_idx, sun_idx, all_cos, contribution, month_indices, n_points, diffuse)
    # time-avg = 1/4 = 0.25·0.65 = 0.1625 (solo componente diretta)
    # energy-weighted = 0.15/(0.15+0.25+0.9+0.85) = 0.15/2.15 ≈ 0.0698 ·0.65 ≈ 0.0454
    assert out['annual_energy'] < out['annual_time'], (
        f"energy={out['annual_energy']:.4f} time={out['annual_time']:.4f}"
    )


def test_fsm_midday_shadow_energy_weighted_higher():
    """Ombra a mezzogiorno (I_b alto) → energy-weighted > time-avg."""
    n_points = 1
    pt_idx = [0, 0, 0, 0]
    sun_idx = [0, 1, 2, 3]
    all_cos = [0.15, 0.25, 0.9, 0.85]
    # Raggi di mezzogiorno (2,3) BLOCCATI
    contribution = [0.15, 0.25, 0.0, 0.0]
    month_indices = [6, 6, 6, 6]
    diffuse = [1.0]

    out = _agg(pt_idx, sun_idx, all_cos, contribution, month_indices, n_points, diffuse)
    # time-avg beam = 2/4 = 0.5
    # energy-weighted beam = (0.9+0.85)/(0.15+0.25+0.9+0.85) = 1.75/2.15 ≈ 0.8139
    assert out['annual_energy'] > out['annual_time'], (
        f"energy={out['annual_energy']:.4f} time={out['annual_time']:.4f}"
    )


def test_fsm_monthly_breakdown():
    """Partizione su mesi: il mese con tutti i raggi bloccati ha F_s,b=1."""
    n_points = 1
    pt_idx = [0, 0, 0, 0]
    sun_idx = [0, 1, 2, 3]
    all_cos = [0.6, 0.6, 0.6, 0.6]
    contribution = [0.0, 0.0, 0.6, 0.6]  # gennaio bloccato, luglio libero
    month_indices = [1, 1, 7, 7]
    diffuse = [1.0]

    out = _agg(pt_idx, sun_idx, all_cos, contribution, month_indices, n_points, diffuse)
    # gennaio: F_s,b=1 → 0.65
    # luglio: F_s,b=0 → 0
    assert abs(out['monthly_energy'][1] - 0.65) < 1e-9
    assert abs(out['monthly_energy'][7]) < 1e-12
    assert abs(out['monthly_time'][1] - 0.65) < 1e-9
    assert abs(out['monthly_time'][7]) < 1e-12


def test_fsm_no_rays_uses_diffuse_only():
    """Senza raggi front-facing: F_s,m = diffuse_fraction · F_s,d."""
    n_points = 2
    out = _aggregate_cell_shading(
        np.array([], dtype=int), np.array([], dtype=int),
        np.array([], dtype=float), np.array([], dtype=float),
        np.array([], dtype=int), n_points,
        np.array([0.4, 0.8]),  # diffuse_factor: F_s,d = [0.6, 0.2]
    )
    # 0.35·0.6 = 0.21 ; 0.35·0.2 = 0.07 ; media = 0.14
    assert abs(out['annual_energy'] - 0.14) < 1e-9
    assert abs(out['annual_time'] - 0.14) < 1e-9


@pytest.mark.asyncio
async def test_shadow_response_new_fields_present(async_client):
    """ShadowResponse espone i nuovi campi Step 10 con valori coerenti."""
    payload = {
        'building': {'width': 10, 'depth': 10, 'height': 3, 'roofType': 'flat'},
        'obstacles': [],
        'latitude': 41.9,
        'longitude': 12.5,
        'grid_resolution': 15,
        'timezone': 'Europe/Rome',
        'azimuth': 180,
        'analysis_mode': 'annual',
    }
    r = await async_client.post('/api/v1/solar/shadows', json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    # Nuovi campi presenti
    for k in (
        'annual_shading_pct', 'annual_shading_pct_energy_weighted',
        'annual_shading_pct_time_avg',
        'monthly_shading_pct', 'monthly_shading_pct_energy_weighted',
        'monthly_shading_pct_time_avg',
    ):
        assert k in data, f"campo {k} assente"
    # Senza ostacoli, tetto piano, entrambe le medie sono basse (solo piccolo effetto bordo)
    assert data['annual_shading_pct'] == data['annual_shading_pct_energy_weighted']
    assert 0.0 <= data['annual_shading_pct_energy_weighted'] <= 100.0
    assert 0.0 <= data['annual_shading_pct_time_avg'] <= 100.0
    # Scena aperta + tetto piano: la componente beam time-avg è 0 (nessun blocco),
    # l'energy-weighted è anch'essa 0 → |δ| trascurabile.
    delta = abs(data['annual_shading_pct_energy_weighted'] - data['annual_shading_pct_time_avg'])
    assert delta < 1.0, f"δ annuale = {delta:.2f}pp > 1pp su scena aperta"


@pytest.mark.asyncio
async def test_brunger_hooper_endpoint_runs(async_client):
    """Smoke test: sky_model='brunger_hooper' completa senza errori e restituisce una heatmap valida."""
    payload = {
        'building': {'width': 10, 'depth': 10, 'height': 3, 'roofType': 'flat'},
        'obstacles': [],
        'latitude': 45.0,
        'longitude': 9.0,
        'grid_resolution': 15,
        'timezone': 'Europe/Rome',
        'azimuth': 180,
        'analysis_mode': 'instant',
        'analysis_month': 6,
        'analysis_day': 15,
        'analysis_hour': 12.0,
        'sky_model': 'brunger_hooper',
        'diffuse_fraction_kd': 0.35,
    }
    r = await async_client.post('/api/v1/solar/shadows', json=payload)
    assert r.status_code == 200, r.text
    grid = np.array(r.json()['shadow_grid'])
    # Tetto aperto → shadow_fraction bassa (molto irraggiamento)
    valid = grid[grid >= 0]
    assert valid.size > 0
    assert valid.mean() < 0.5
