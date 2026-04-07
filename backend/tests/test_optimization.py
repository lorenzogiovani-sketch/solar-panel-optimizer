"""
Test per il servizio di ottimizzazione: helper di adiacenza, vincoli,
e algoritmo Seed-and-Grow.
"""

import math
import pytest
from app.services.optimization_service import (
    _count_isolated,
    _are_side_adjacent,
    _build_adjacency,
    _compute_effective_tilt_azimuth,
    run_seed_and_grow,
)
from app.models.optimization import (
    OptimizationRequest,
    BuildingGeometry,
    PanelSpecs,
    OptimizationConstraints,
)


# ---------------------------------------------------------------------------
# Test: adiacenza lato-su-lato
# ---------------------------------------------------------------------------

def test_are_side_adjacent_horizontal():
    """Due pannelli affiancati orizzontalmente (1.0m di larghezza)."""
    assert _are_side_adjacent(0.0, 0.0, 1.0, 1.7, 1.0, 0.0, 1.0, 1.7)


def test_are_side_adjacent_vertical():
    """Due pannelli affiancati verticalmente (1.7m di altezza)."""
    assert _are_side_adjacent(0.0, 0.0, 1.0, 1.7, 0.0, 1.7, 1.0, 1.7)


def test_not_adjacent_diagonal():
    """Due pannelli in diagonale non sono adiacenti."""
    assert not _are_side_adjacent(0.0, 0.0, 1.0, 1.7, 1.0, 1.7, 1.0, 1.7)


def test_count_isolated():
    """Un pannello completamente separato viene contato come isolato."""
    positions = [
        (0.0, 0.0, 1.0, 1.7),   # pannello 1
        (1.0, 0.0, 1.0, 1.7),   # pannello 2, adiacente a 1
        (10.0, 10.0, 1.0, 1.7), # pannello 3, isolato
    ]
    assert _count_isolated(positions) == 1


def test_no_isolated_in_block():
    """Un blocco 2x2 non ha pannelli isolati."""
    positions = [
        (0.0, 0.0, 1.0, 1.7),
        (1.0, 0.0, 1.0, 1.7),
        (0.0, 1.7, 1.0, 1.7),
        (1.0, 1.7, 1.0, 1.7),
    ]
    assert _count_isolated(positions) == 0


# ---------------------------------------------------------------------------
# Test: effective tilt/azimuth per falda del tetto
# ---------------------------------------------------------------------------

def test_effective_tilt_flat_roof():
    """Tetto piano: tilt=0, azimuth=buildingAzimuth."""
    bg = BuildingGeometry(width=10, depth=10, height=3, roof_type="flat", roof_angle=0)
    tilt, az = _compute_effective_tilt_azimuth(0, 0, bg, 180.0)
    assert tilt == 0.0
    assert az == 180.0


def test_effective_tilt_gable_south_face():
    """Gable, posZ >= 0 (local +Z) → tilt=roofAngle, azimuth=(buildingAzimuth+180)%360."""
    bg = BuildingGeometry(width=12, depth=10, height=6, roof_type="gable", roof_angle=30)
    tilt, az = _compute_effective_tilt_azimuth(0, 2.0, bg, 180.0)
    assert tilt == 30.0
    assert az == 0.0  # (180+180)%360 = 0 (nord)


def test_effective_tilt_gable_north_face():
    """Gable, posZ < 0 (local -Z) → tilt=roofAngle, azimuth=buildingAzimuth."""
    bg = BuildingGeometry(width=12, depth=10, height=6, roof_type="gable", roof_angle=30)
    tilt, az = _compute_effective_tilt_azimuth(0, -2.0, bg, 180.0)
    assert tilt == 30.0
    assert az == 180.0  # sud


def test_effective_tilt_gable_azimuth_90():
    """Gable con buildingAzimuth=90 (est): verifica coerenza falde."""
    bg = BuildingGeometry(width=12, depth=10, height=6, roof_type="gable", roof_angle=25)
    tilt_n, az_n = _compute_effective_tilt_azimuth(0, -2.0, bg, 90.0)
    tilt_s, az_s = _compute_effective_tilt_azimuth(0, 2.0, bg, 90.0)
    assert tilt_n == 25.0
    assert az_n == 90.0   # est
    assert tilt_s == 25.0
    assert az_s == 270.0  # ovest


def test_effective_tilt_hip_ns_faces():
    """Hip: falde NS usano slopeAngleNS."""
    bg = BuildingGeometry(width=12, depth=10, height=6, roof_type="hip",
                          roof_angle=0, ridge_height=3, ridge_length=8)
    # posZ=-2 è nella falda 'north' (local -Z)
    tilt_n, az_n = _compute_effective_tilt_azimuth(0, -2.0, bg, 180.0)
    expected_tilt = math.degrees(math.atan2(3, 5))  # rh / halfD
    assert abs(tilt_n - expected_tilt) < 0.1
    assert az_n == 180.0  # buildingAzimuth

    # posZ=+2 è nella falda 'south' (local +Z)
    tilt_s, az_s = _compute_effective_tilt_azimuth(0, 2.0, bg, 180.0)
    assert abs(tilt_s - expected_tilt) < 0.1
    assert az_s == 0.0  # (180+180)%360


def test_effective_tilt_hip_ew_faces():
    """Hip: falde EW usano slopeAngleEW."""
    bg = BuildingGeometry(width=12, depth=10, height=6, roof_type="hip",
                          roof_angle=0, ridge_height=3, ridge_length=8)
    # posX=+5.5 è nella falda 'east' (local +X), lontano dal ridge
    tilt_e, az_e = _compute_effective_tilt_azimuth(5.5, 0, bg, 180.0)
    slope_run_ew = 6 - 4  # halfW - hrl = 6 - 4 = 2
    expected_tilt = math.degrees(math.atan2(3, slope_run_ew))
    assert abs(tilt_e - expected_tilt) < 0.1
    assert az_e == 270.0  # ((90-180)%360+360)%360 = 270 (ovest)


def test_seed_and_grow_gable_has_effective_tilt():
    """Seed-and-Grow su gable: i pannelli nel risultato hanno effective_tilt/azimuth."""
    req = OptimizationRequest(
        building_geometry=BuildingGeometry(
            width=12, depth=10, height=6, roof_type="gable", roof_angle=30,
        ),
        panel_specs=PanelSpecs(width=1.0, height=1.7, power=400, efficiency=0.21),
        constraints=OptimizationConstraints(
            max_peak_power=2.0, min_distance=0.05, roof_margin=0.3,
        ),
        building_azimuth=180.0,
        annual_irradiance=1700.0,
    )
    result = run_seed_and_grow(req)
    assert result.total_panels >= 1
    for p in result.panels:
        assert p.effective_tilt is not None
        assert p.effective_azimuth is not None
        assert p.effective_tilt == 30.0


def test_seed_and_grow_face_irradiances_affects_energy():
    """Con face_irradiances diversificate, l'energia deve differire dal caso uniforme."""
    base_kwargs = dict(
        building_geometry=BuildingGeometry(
            width=12, depth=10, height=6, roof_type="gable", roof_angle=30,
        ),
        panel_specs=PanelSpecs(width=1.0, height=1.7, power=400, efficiency=0.21),
        constraints=OptimizationConstraints(
            max_peak_power=4.0, min_distance=0.05, roof_margin=0.3,
        ),
        building_azimuth=180.0,
        annual_irradiance=1700.0,
    )
    # Caso 1: senza face_irradiances (tutti usano 1700)
    result_uniform = run_seed_and_grow(OptimizationRequest(**base_kwargs))

    # Caso 2: con face_irradiances (falda sud-esposta = 1900, nord-esposta = 800)
    # 'north' label = local -Z = world south (buildingAzimuth=180) = alta irradianza
    # 'south' label = local +Z = world north = bassa irradianza
    result_perface = run_seed_and_grow(OptimizationRequest(
        **base_kwargs,
        face_irradiances={'north': 1900, 'south': 800},
    ))

    # Stesso numero di pannelli ma energia diversa
    assert result_uniform.total_panels == result_perface.total_panels
    assert result_perface.total_energy_kwh != result_uniform.total_energy_kwh


# ---------------------------------------------------------------------------
# Test: Seed-and-Grow algorithm
# ---------------------------------------------------------------------------

def _make_request(**overrides) -> OptimizationRequest:
    """Helper per costruire un OptimizationRequest con defaults ragionevoli."""
    defaults = dict(
        building_geometry=BuildingGeometry(
            width=10, depth=10, height=3, roof_type="flat", roof_angle=0,
        ),
        panel_specs=PanelSpecs(width=1.0, height=1.7, power=400, efficiency=0.21),
        constraints=OptimizationConstraints(
            min_panels=1, min_distance=0.05, roof_margin=0.3,
        ),
        shadow_grid=None,
        obstacles=None,
        installation_polygons=None,
        annual_irradiance=1700.0,
        system_losses=0.14,
        strategy="seed_and_grow",
    )
    defaults.update(overrides)
    return OptimizationRequest(**defaults)


def test_seed_and_grow_flat_roof_basic():
    """Tetto piano 10x10m: almeno 1 pannello, potenza > 0."""
    req = _make_request()
    result = run_seed_and_grow(req)

    assert result.total_panels >= 1
    assert result.total_power_kw > 0
    assert result.total_energy_kwh > 0
    assert len(result.panels) == result.total_panels


def test_seed_and_grow_respects_max_power():
    """Con max_peak_power=1.0 kWp e pannello 400W → max 3 pannelli."""
    req = _make_request(
        building_geometry=BuildingGeometry(
            width=20, depth=20, height=3, roof_type="flat", roof_angle=0,
        ),
        constraints=OptimizationConstraints(
            max_peak_power=1.0, min_distance=0.05, roof_margin=0.3,
        ),
    )
    result = run_seed_and_grow(req)

    max_allowed = math.ceil(1000 / 400)  # 3
    assert result.total_panels <= max_allowed, (
        f"Con max_peak_power=1.0 kWp e 400W/pannello, "
        f"max {max_allowed} pannelli ma ne ha {result.total_panels}"
    )
    assert result.total_power_kw <= 1.0 + 0.01  # tolleranza arrotondamento


def test_seed_and_grow_small_roof():
    """Tetto 1x1m con pannello 1.7x1.0m: 0 pannelli (non ci sta)."""
    req = _make_request(
        building_geometry=BuildingGeometry(
            width=1, depth=1, height=3, roof_type="flat", roof_angle=0,
        ),
    )
    result = run_seed_and_grow(req)

    assert result.total_panels == 0
    assert result.total_power_kw == 0


def test_seed_and_grow_with_obstacle():
    """Tetto 10x10m con ostacolo box al centro: nessun pannello sovrapposto."""
    obstacle = {
        "type": "box",
        "position": [0, 3, 0],  # centro del tetto
        "dimensions": [3, 1, 3],  # 3x3m di ingombro
    }
    req = _make_request(obstacles=[obstacle])
    result = run_seed_and_grow(req)

    # Verifica che nessun pannello cada dentro l'ostacolo
    obs_x, obs_z = 0.0, 0.0
    obs_hw, obs_hd = 1.5, 1.5  # half-width/depth dell'ostacolo

    for p in result.panels:
        orient = p.orientation
        pw = 1.0 if orient == "portrait" else 1.7
        ph = 1.7 if orient == "portrait" else 1.0
        # Centro pannello vs centro ostacolo: nessun overlap
        dx = abs(p.x - obs_x)
        dy = abs(p.y - obs_z)
        overlap_x = dx < (pw / 2 + obs_hw)
        overlap_y = dy < (ph / 2 + obs_hd)
        assert not (overlap_x and overlap_y), (
            f"Pannello a ({p.x}, {p.y}) sovrapposto all'ostacolo al centro"
        )


def test_flat_vs_gable_no_face_irradiances_differs():
    """Senza face_irradiances, flat e gable devono produrre energie diverse (fallback cos-correction)."""
    common = dict(
        panel_specs=PanelSpecs(width=1.0, height=1.7, power=400, efficiency=0.21),
        constraints=OptimizationConstraints(max_peak_power=3.0, min_distance=0.05, roof_margin=0.3),
        annual_irradiance=1500.0,
        building_azimuth=180.0,
    )

    req_flat = OptimizationRequest(
        building_geometry=BuildingGeometry(width=12, depth=10, height=6, roof_type="flat", roof_angle=0),
        **common,
    )
    req_gable = OptimizationRequest(
        building_geometry=BuildingGeometry(width=12, depth=10, height=6, roof_type="gable", roof_angle=30),
        **common,
    )

    result_flat = run_seed_and_grow(req_flat)
    result_gable = run_seed_and_grow(req_gable)

    assert result_flat.total_panels >= 1
    assert result_gable.total_panels >= 1
    assert result_flat.total_energy_kwh != result_gable.total_energy_kwh, (
        f"Flat ({result_flat.total_energy_kwh} kWh) e gable ({result_gable.total_energy_kwh} kWh) "
        f"non dovrebbero avere la stessa energia senza face_irradiances"
    )


def test_flat_vs_hip_no_face_irradiances_differs():
    """Senza face_irradiances, flat e hip devono produrre energie diverse (fallback cos-correction)."""
    common = dict(
        panel_specs=PanelSpecs(width=1.0, height=1.7, power=400, efficiency=0.21),
        constraints=OptimizationConstraints(max_peak_power=3.0, min_distance=0.05, roof_margin=0.3),
        annual_irradiance=1500.0,
        building_azimuth=180.0,
    )

    req_flat = OptimizationRequest(
        building_geometry=BuildingGeometry(width=12, depth=10, height=6, roof_type="flat", roof_angle=0),
        **common,
    )
    req_hip = OptimizationRequest(
        building_geometry=BuildingGeometry(
            width=12, depth=10, height=6, roof_type="hip",
            roof_angle=0, ridge_height=3, ridge_length=8,
        ),
        **common,
    )

    result_flat = run_seed_and_grow(req_flat)
    result_hip = run_seed_and_grow(req_hip)

    assert result_flat.total_panels >= 1
    assert result_hip.total_panels >= 1
    assert result_flat.total_energy_kwh != result_hip.total_energy_kwh, (
        f"Flat ({result_flat.total_energy_kwh} kWh) e hip ({result_hip.total_energy_kwh} kWh) "
        f"non dovrebbero avere la stessa energia senza face_irradiances"
    )


def test_different_azimuth_produces_different_energy():
    """Tetto hip: cambiare building_azimuth con face_irradiances diverse deve cambiare l'energia."""
    bg = BuildingGeometry(
        width=12, depth=10, height=6, roof_type="hip",
        roof_angle=0, ridge_height=3, ridge_length=8,
    )
    ps = PanelSpecs(width=1.0, height=1.7, power=400, efficiency=0.21)
    cs = OptimizationConstraints(max_peak_power=4.0, min_distance=0.05, roof_margin=0.3)

    # Azimuth 180 (edificio verso sud): 'north' label (local -Z) faces south → high irradiance
    req_south = OptimizationRequest(
        building_geometry=bg, panel_specs=ps, constraints=cs,
        building_azimuth=180.0, annual_irradiance=1500.0,
        face_irradiances={'north': 1900, 'south': 800, 'east': 1200, 'west': 1200},
    )

    # Azimuth 90 (edificio verso est): stesse face_irradiances ma distribuite diversamente
    req_east = OptimizationRequest(
        building_geometry=bg, panel_specs=ps, constraints=cs,
        building_azimuth=90.0, annual_irradiance=1500.0,
        face_irradiances={'north': 1200, 'south': 1200, 'east': 1900, 'west': 800},
    )

    result_south = run_seed_and_grow(req_south)
    result_east = run_seed_and_grow(req_east)

    assert result_south.total_panels >= 1
    assert result_east.total_panels >= 1
    # L'energia totale deve differire perché la distribuzione dei pannelli
    # sulle falde cambia in base alle irradianze per-falda
    assert abs(result_south.total_energy_kwh - result_east.total_energy_kwh) > 1.0, (
        f"South-facing ({result_south.total_energy_kwh} kWh) ed east-facing "
        f"({result_east.total_energy_kwh} kWh) dovrebbero avere produzione diversa"
    )


def test_seed_and_grow_with_installation_zone():
    """Tetto 10x10m con zona installazione 5x5m: pannelli dentro la zona."""
    # Zona installazione: quadrato 5x5m centrato (da -2.5 a 2.5)
    zone = [
        {"x": -2.5, "z": -2.5},
        {"x": 2.5, "z": -2.5},
        {"x": 2.5, "z": 2.5},
        {"x": -2.5, "z": 2.5},
    ]
    req = _make_request(installation_polygons=[zone])
    result = run_seed_and_grow(req)

    assert result.total_panels >= 1, "Almeno 1 pannello nella zona 5x5m"

    margin = 0.5  # tolleranza per bordi
    for p in result.panels:
        assert -2.5 - margin <= p.x <= 2.5 + margin, (
            f"Pannello x={p.x} fuori dalla zona installazione"
        )
        assert -2.5 - margin <= p.y <= 2.5 + margin, (
            f"Pannello y={p.y} fuori dalla zona installazione"
        )
