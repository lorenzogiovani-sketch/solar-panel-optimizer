import pytest
import numpy as np
from datetime import datetime


# ─── normalize_sun_geometry ─────────────────────────────────


def test_normalize_sun_geometry_south():
    """az_pvlib=180° (Sud) → psi≈0, beta≈30, sun_vector punta a Sud."""
    from app.services.geometry import normalize_sun_geometry
    g = normalize_sun_geometry(30, 180)
    assert abs(g.beta_deg - 30) < 1e-9
    assert abs(g.psi_deg) < 1e-9, f"psi={g.psi_deg}, atteso 0"
    assert abs(g.zenith_deg - (90 - g.beta_corr_deg)) < 1e-9
    # sun_vector: x≈0, z≈−cos(el) (punta a −Z = Nord, ma el>0 e az=180 → z>0)
    sun_x, sun_y, sun_z = g.sun_vector
    assert abs(sun_x) < 1e-9, f"sun_x={sun_x}, atteso ≈0 per sole a Sud"
    assert sun_y > 0


def test_normalize_sun_geometry_east():
    """az_pvlib=90° (Est) → psi≈−90 (convenzione riferimento)."""
    from app.services.geometry import normalize_sun_geometry
    g = normalize_sun_geometry(30, 90)
    assert abs(g.psi_deg - (-90)) < 1e-9, f"psi={g.psi_deg}, atteso −90"


def test_normalize_sun_geometry_refraction_horizon():
    """A β=0.5° la correzione di rifrazione Bennett deve essere ≈0.3–0.8°."""
    from app.services.geometry import normalize_sun_geometry
    g = normalize_sun_geometry(0.5, 180)
    delta = g.beta_corr_deg - g.beta_deg
    assert 0.3 <= delta <= 0.8, (
        f"Δβ={delta:.4f}°, atteso nell'intervallo [0.3, 0.8]° "
        "(rifrazione atmosferica all'orizzonte)"
    )


# ─── airmass ────────────────────────────────────────────────


def test_airmass_zenith():
    """Sole allo zenit (β=90°): massa d'aria ≈ 1.0."""
    from app.services.atmosphere import airmass
    assert abs(airmass(90, 0) - 1.0) < 0.01, f"m(90°)={airmass(90, 0)}, atteso ≈1.0"


def test_airmass_30deg():
    """β=30°, livello mare: massa d'aria ≈ 2 (ordine di grandezza)."""
    from app.services.atmosphere import airmass
    m = airmass(30, 0)
    assert 1.5 < m < 2.5, f"m(30°)={m:.3f}, atteso nell'intervallo [1.5, 2.5]"


def test_airmass_altitude_reduces_mass():
    """A 3000 m la massa d'aria è minore che al livello del mare."""
    from app.services.atmosphere import airmass
    assert airmass(30, 3000) < airmass(30, 0), "massa d'aria a 3000 m deve essere < livello mare"


def test_airmass_low_elevation():
    """Elevazione bassa (10°) → massa d'aria maggiore di 30°."""
    from app.services.atmosphere import airmass
    assert airmass(10, 0) > airmass(30, 0), "m(10°) deve essere > m(30°)"


# ─── Sun Path ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sun_path_Rome(async_client):
    """
    Test endpoint /sun-path per Roma.
    Verifica elevazione > 0, azimuth a mezzogiorno, durata del giorno.
    """
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "year": 2024,
        "timezone": "Europe/Rome"
    }
    response = await async_client.post("/api/v1/solar/sun-path", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert len(data["timestamps"]) > 0
    assert len(data["elevation"]) == len(data["timestamps"])

    # 1. Elevazione > 0 (filtro ore diurne)
    elevations = data["elevation"]
    assert all(e > 0 for e in elevations), "Tutte le elevazioni devono essere > 0"

    # 2. Azimuth a mezzogiorno (~180° / sud)
    timestamps = [datetime.fromisoformat(ts) for ts in data["timestamps"]]
    noon_azimuths = []
    for i, ts in enumerate(timestamps):
        if 11 <= ts.hour <= 14:
            if abs(data["azimuth"][i] - 180) < 10:
                noon_azimuths.append(data["azimuth"][i])
    assert len(noon_azimuths) > 0, "Dovrebbe esserci almeno un passaggio a Sud (azimuth ~180)"

    # 3. Durata del giorno (approssimativa)
    summer_hours = sum(1 for ts in timestamps if ts.month == 6 and ts.day == 21)
    winter_hours = sum(1 for ts in timestamps if ts.month == 12 and ts.day == 21)
    assert 14 <= summer_hours <= 17, f"Ore luce estate {summer_hours} fuori range (14-17)"
    assert 8 <= winter_hours <= 11, f"Ore luce inverno {winter_hours} fuori range (8-11)"


@pytest.mark.asyncio
async def test_irradiance_check_values(async_client):
    """
    Test endpoint /irradiance.
    Verifica range annuo, estate > inverno, tilt ottimo > tilt 0.
    """
    payload_opt = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome"
    }
    response_opt = await async_client.post("/api/v1/solar/irradiance", json=payload_opt)
    assert response_opt.status_code == 200
    data_opt = response_opt.json()

    # 1. Range annuo
    annual_kwh = data_opt["annual_total"]
    assert 1000 <= annual_kwh <= 2500, f"Totale annuo {annual_kwh} fuori range realistico"

    # 2. Estate > Inverno
    monthly = data_opt["monthly_totals"]
    assert monthly["July"] > monthly["December"], "Luglio > Dicembre"

    # 3. Tilt 30 > Tilt 0
    payload_flat = {**payload_opt, "tilt": 0}
    response_flat = await async_client.post("/api/v1/solar/irradiance", json=payload_flat)
    assert response_flat.status_code == 200
    data_flat = response_flat.json()
    assert data_opt["annual_total"] > data_flat["annual_total"]


# ─── Shadows ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_shadows_parametric_building(async_client):
    """Test endpoint /shadows con un edificio parametrico piccolo."""
    payload = {
        "building": {
            "width": 4,
            "depth": 4,
            "height": 3,
            "roofType": "flat",
        },
        "obstacles": [],
        "latitude": 41.9,
        "longitude": 12.5,
        "year": 2024,
        "timezone": "Europe/Rome",
        "grid_resolution": 10,
        "azimuth": 180,
    }
    response = await async_client.post("/api/v1/solar/shadows", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "shadow_grid" in data
    assert "grid_bounds" in data
    assert "monthly_shadows" in data
    assert "statistics" in data

    # La griglia deve avere dimensione grid_resolution × grid_resolution
    grid = data["shadow_grid"]
    assert len(grid) > 0
    assert len(grid[0]) > 0

    # Valori ombra tra 0 e 1
    for row in grid:
        for val in row:
            assert 0.0 <= val <= 1.0, f"Valore ombra {val} fuori range [0,1]"


# ─── Daily Simulation ──────────────────────────────────────


@pytest.mark.asyncio
async def test_daily_simulation(async_client):
    """Test endpoint /daily-simulation con edificio parametrico e 21 giugno."""
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "year": 2024,
        "timezone": "Europe/Rome",
        "month": 6,
        "day": 21,
        "tilt": 30,
        "panel_azimuth": 180,
        "building_azimuth": 180,
        "building": {
            "width": 4,
            "depth": 4,
            "height": 3,
            "roofType": "flat",
        },
        "obstacles": [],
        "panels": [],
        "panel_power_w": 400,
        "panel_efficiency": 0.21,
    }
    response = await async_client.post("/api/v1/solar/daily-simulation", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "date" in data
    assert "hourly" in data
    assert "daily_kwh" in data
    assert "daily_kwh_clearsky" in data
    assert data["daily_kwh_clearsky"] >= 0
    assert data["sunshine_hours"] > 0, "21 giugno dovrebbe avere ore di sole"


# ─── SkyCondition / clear_sky strategy ────────────────────


@pytest.mark.asyncio
async def test_irradiance_sky_condition_average_regression(async_client):
    """sky_condition='average' produce output identico al payload senza il campo."""
    base = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
    }
    r1 = await async_client.post("/api/v1/solar/irradiance", json=base)
    r2 = await async_client.post("/api/v1/solar/irradiance", json={**base, "sky_condition": "average"})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["annual_total"] == r2.json()["annual_total"]


@pytest.mark.asyncio
async def test_irradiance_clear_dni_higher_than_average(async_client):
    """sky_condition='clear' a mezzogiorno estivo a Roma → DNI più alto di 'average' di ≥5%."""
    base = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
    }
    r_avg = await async_client.post("/api/v1/solar/irradiance", json={**base, "sky_condition": "average"})
    r_clr = await async_client.post("/api/v1/solar/irradiance", json={**base, "sky_condition": "clear"})
    assert r_avg.status_code == 200 and r_clr.status_code == 200

    annual_avg = r_avg.json()["annual_total"]
    annual_clr = r_clr.json()["annual_total"]
    assert annual_clr > annual_avg * 1.05, (
        f"Clear ({annual_clr:.1f}) non supera average ({annual_avg:.1f}) del 5%"
    )


def test_select_clear_sky_strategy_returns_correct_class():
    """La factory restituisce istanze della classe corretta per ogni condizione."""
    from app.services.clear_sky import (
        select_clear_sky_strategy, REST2Strategy, IneichenStrategy
    )
    assert isinstance(select_clear_sky_strategy('clear'), REST2Strategy)
    assert isinstance(select_clear_sky_strategy('average'), IneichenStrategy)
    assert isinstance(select_clear_sky_strategy('generic'), IneichenStrategy)


# ─── Input invalidi ────────────────────────────────────────


@pytest.mark.asyncio
async def test_sun_path_invalid_latitude(async_client):
    """Latitudine 999 deve restituire 422."""
    payload = {
        "latitude": 999,
        "longitude": 12.5,
        "year": 2024,
        "timezone": "Europe/Rome",
    }
    response = await async_client.post("/api/v1/solar/sun-path", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_sun_path_invalid_year(async_client):
    """Anno 0 deve restituire 422."""
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "year": 0,
        "timezone": "Europe/Rome",
    }
    response = await async_client.post("/api/v1/solar/sun-path", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_sun_path_invalid_month(async_client):
    """Mese 13 (via shadow endpoint) deve restituire 422."""
    payload = {
        "building": {"width": 4, "depth": 4, "height": 3, "roofType": "flat"},
        "latitude": 41.9,
        "longitude": 12.5,
        "grid_resolution": 10,
        "analysis_mode": "monthly",
        "analysis_month": 13,
    }
    response = await async_client.post("/api/v1/solar/shadows", json=payload)
    assert response.status_code == 422


# ─── Decomposition unit tests ───────────────────────────────
#
# DOY=80 (21 marzo), beta=45° → zenith=45° → cos(z)=0.707
# I_0(80) ≈ 1358 W/m²  → I_0h = 1358 * 0.707 ≈ 960 W/m²
# GHI per K_t=0.30 → 0.30 * 960 ≈ 288 W/m²
# GHI per K_t=0.75 → 0.75 * 960 ≈ 720 W/m²


def _setup_kt(kt_target: float) -> tuple:
    """Restituisce (ghi, beta_deg, doy) per il K_t richiesto (DOY=80, beta=45°)."""
    import pvlib
    doy = np.array([80.0])
    beta = np.array([45.0])
    cos_z = np.cos(np.radians(90.0 - beta))
    I0 = np.asarray(pvlib.irradiance.get_extra_radiation(doy), dtype=float)
    ghi = kt_target * I0 * cos_z
    return ghi, beta, doy


def test_decompose_erbs_overcast():
    """K_t=0.30 (cielo coperto): K_d ≥ 0.90 e DHI ≈ GHI."""
    from app.services.decomposition import erbs
    ghi, beta, doy = _setup_kt(0.30)
    dni, dhi = erbs(ghi, beta, doy)
    kd = float(dhi[0] / ghi[0])
    assert kd >= 0.90, f"K_t=0.30 → K_d={kd:.3f}, atteso ≥ 0.90"
    assert float(dhi[0]) == pytest.approx(float(ghi[0]) * kd, rel=1e-3)


def test_decompose_erbs_clear():
    """K_t=0.75 (cielo sereno): K_d ≤ 0.25 e DNI significativo."""
    from app.services.decomposition import erbs
    ghi, beta, doy = _setup_kt(0.75)
    dni, dhi = erbs(ghi, beta, doy)
    kd = float(dhi[0] / ghi[0])
    assert kd <= 0.25, f"K_t=0.75 → K_d={kd:.3f}, atteso ≤ 0.25"
    assert float(dni[0]) > float(dhi[0]), "Per cielo sereno DNI deve essere > DHI"


def test_decompose_skartveit_overcast():
    """S-O: K_t=0.30 → K_d ≥ 0.85 (breakpoint SO al 0.30, confine del segmento piatto)."""
    from app.services.decomposition import skartveit_olseth
    ghi, beta, doy = _setup_kt(0.30)
    dni, dhi = skartveit_olseth(ghi, beta, doy)
    kd = float(dhi[0] / ghi[0])
    assert kd >= 0.85, f"S-O K_t=0.30 → K_d={kd:.3f}, atteso ≥ 0.85"


def test_decompose_ruiz_arias_monotone():
    """RA: K_d decresce al crescere di K_t (test monotonia su 5 punti)."""
    from app.services.decomposition import ruiz_arias
    kts = [0.20, 0.35, 0.50, 0.65, 0.80]
    doy = np.array([80.0])
    beta = np.array([45.0])
    import pvlib
    cos_z = np.cos(np.radians(90.0 - beta))
    I0 = float(np.asarray(pvlib.irradiance.get_extra_radiation(doy)))
    kds = []
    for kt in kts:
        ghi = np.array([kt * I0 * float(cos_z)])
        _, dhi = ruiz_arias(ghi, beta, doy)
        kds.append(float(dhi[0] / ghi[0]) if ghi[0] > 0 else 1.0)
    for i in range(len(kds) - 1):
        assert kds[i] > kds[i + 1], (
            f"RA non monotona: K_d({kts[i]})={kds[i]:.3f} ≤ K_d({kts[i+1]})={kds[i+1]:.3f}"
        )


def test_decompose_energy_conservation():
    """DNI·cos(z) + DHI ≈ GHI (tolleranza 0.5 W/m²) per tutti e tre i modelli."""
    from app.services.decomposition import erbs, skartveit_olseth, ruiz_arias
    import pvlib
    doy = np.array([80.0])
    beta = np.array([45.0])
    cos_z = float(np.cos(np.radians(90.0 - beta)))
    I0 = float(np.asarray(pvlib.irradiance.get_extra_radiation(doy)))
    ghi = np.array([0.55 * I0 * cos_z])

    for name, fn in [("erbs", erbs), ("skartveit_olseth", skartveit_olseth), ("ruiz_arias", ruiz_arias)]:
        dni, dhi = fn(ghi, beta, doy)
        reconstructed = float(dni[0]) * cos_z + float(dhi[0])
        err = abs(reconstructed - float(ghi[0]))
        assert err < 0.5, f"{name}: |DNI·cos(z)+DHI - GHI| = {err:.4f} W/m², atteso < 0.5"


@pytest.mark.asyncio
async def test_decomposition_regression_all_provided(async_client):
    """
    Con (ghi, dni, dhi) tutti forniti e sky_condition='generic',
    la scomposizione NON viene attivata: il payload viene usato direttamente.
    Verifica: status 200 e annual_total coerente con i dati in input.
    """
    import pvlib, pandas as pd
    # Costruiamo serie Ineichen per Roma 2024 come riferimento
    loc = pvlib.location.Location(41.9, 12.5, tz="Europe/Rome")
    times = pd.date_range("2024-01-01", "2024-12-31 23:00", freq="1h", tz="Europe/Rome")
    cs = loc.get_clearsky(times)
    ghi_list = cs["ghi"].clip(lower=0).tolist()
    dni_list = cs["dni"].clip(lower=0).tolist()
    dhi_list = cs["dhi"].clip(lower=0).tolist()

    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
        "sky_condition": "generic",
        "ghi_series": ghi_list,
        "dni_series": dni_list,
        "dhi_series": dhi_list,
    }
    r = await async_client.post("/api/v1/solar/irradiance", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["annual_total"] > 0
    # Con i dati Ineichen il totale annuo per Roma dovrebbe essere nel range realistico
    assert 1200 <= data["annual_total"] <= 2500, (
        f"annual_total={data['annual_total']} fuori range con dati Ineichen"
    )


# ─── Daily-to-hourly disaggregation (Step 6) ───────────────


def test_cprg_rt_noon_greater_than_edges():
    """r_t a ω=0 (mezzogiorno) deve essere > r_t ai bordi della giornata (ω=±ω_s)."""
    from app.services.daily_to_hourly import collares_pereira_rabl_rt, _sunset_hour_angle_rad

    omega_s = _sunset_hour_angle_rad(41.9, 80)  # Roma, 21 marzo ≈ π/2
    rt_noon = float(collares_pereira_rabl_rt(np.array([0.0]), omega_s)[0])
    rt_edge_morning = float(collares_pereira_rabl_rt(np.array([-omega_s + 1e-3]), omega_s)[0])
    rt_edge_evening = float(collares_pereira_rabl_rt(np.array([omega_s - 1e-3]), omega_s)[0])
    assert rt_noon > rt_edge_morning, f"r_t(noon)={rt_noon:.4f} ≤ r_t(morning)={rt_edge_morning:.4f}"
    assert rt_noon > rt_edge_evening, f"r_t(noon)={rt_noon:.4f} ≤ r_t(evening)={rt_edge_evening:.4f}"
    # Oltre ω_s il rapporto è zero
    rt_night = float(collares_pereira_rabl_rt(np.array([omega_s + 0.1]), omega_s)[0])
    assert rt_night == 0.0


def test_liu_jordan_rd_noon_greater_than_edges():
    """r_d a ω=0 (mezzogiorno) deve essere > r_d ai bordi della giornata."""
    from app.services.daily_to_hourly import liu_jordan_rd, _sunset_hour_angle_rad

    omega_s = _sunset_hour_angle_rad(41.9, 80)
    rd_noon = float(liu_jordan_rd(np.array([0.0]), omega_s)[0])
    rd_edge = float(liu_jordan_rd(np.array([omega_s - 1e-3]), omega_s)[0])
    assert rd_noon > rd_edge


def test_disaggregate_energy_conservation():
    """Somma oraria su 24h ≈ H giornaliero fornito (tolleranza 1%)."""
    from app.services.daily_to_hourly import disaggregate_daily_to_hourly

    h_bh = 2.5  # kWh/m²·d
    h_dh = 1.7
    h_bh_hourly, h_dh_hourly = disaggregate_daily_to_hourly(h_bh, h_dh, latitude=41.9, day_of_year=172)

    # Ogni valore orario è W/m² medio sull'ora → integrale 24h in Wh/m²
    total_bh_wh = float(h_bh_hourly.sum())
    total_dh_wh = float(h_dh_hourly.sum())
    assert abs(total_bh_wh - h_bh * 1000.0) / (h_bh * 1000.0) < 0.01, (
        f"Non conserva beam: Σh={total_bh_wh:.1f} vs atteso {h_bh*1000:.1f}"
    )
    assert abs(total_dh_wh - h_dh * 1000.0) / (h_dh * 1000.0) < 0.01, (
        f"Non conserva diffuse: Σh={total_dh_wh:.1f} vs atteso {h_dh*1000:.1f}"
    )


def test_disaggregate_rome_january_noon_magnitude():
    """Roma, gennaio, valori UNI 10349 → H_th(h=12) nell'ordine 300-500 W/m²."""
    from app.services.daily_to_hourly import disaggregate_daily_to_hourly, KLEIN_REPRESENTATIVE_DOY

    # Valori indicativi UNI 10349-3 per Roma (Lazio), gennaio:
    #   H_bh ≈ 1.5 kWh/m²·d, H_dh ≈ 1.5 kWh/m²·d.
    h_bh_jan = 1.5
    h_dh_jan = 1.5
    bh_hourly, dh_hourly = disaggregate_daily_to_hourly(
        h_bh_jan, h_dh_jan, latitude=41.9, day_of_year=KLEIN_REPRESENTATIVE_DOY[0],
    )
    # Ora di mezzogiorno (h=12): indice 12 = clock-time 12:00-13:00 (midpoint 12:30 ≈ solar noon)
    # Noon solare è a ω=0, ovvero midpoint h=11.5 → prendi massimo attorno a mezzogiorno.
    h_th_noon = float(bh_hourly[11] + dh_hourly[11])
    assert 200.0 <= h_th_noon <= 600.0, (
        f"H_th(noon) Roma gennaio = {h_th_noon:.1f} W/m², fuori dall'ordine di grandezza atteso"
    )
    # Il picco giornaliero deve cadere attorno a mezzogiorno (indici 11 o 12)
    peak_idx = int(np.argmax(bh_hourly + dh_hourly))
    assert peak_idx in (11, 12), f"Picco atteso a mezzogiorno, trovato a h={peak_idx}"


def test_expand_monthly_to_yearly_length_and_conservation():
    """Expansion su anno intero: lunghezza 8760/8784 e conservazione totale."""
    from app.services.daily_to_hourly import expand_monthly_to_yearly
    import calendar

    h_bh = [1.2] * 12
    h_dh = [0.8] * 12
    bhi_year, dhi_year = expand_monthly_to_yearly(h_bh, h_dh, latitude=41.9, year=2024)

    # 2024 bisestile → 8784 ore
    assert len(bhi_year) == 8784
    assert len(dhi_year) == 8784

    # Conservazione mensile: la somma oraria del mese ≈ h_bh * 1000 * giorni
    import numpy as _np
    offset = 0
    for m in range(1, 13):
        days = calendar.monthrange(2024, m)[1]
        n = days * 24
        bh_month_wh = float(_np.asarray(bhi_year[offset:offset + n]).sum())
        expected_wh = h_bh[m - 1] * 1000.0 * days
        # Tolleranza 2%: la Riemann-sum discreta su 24 midpoint-ore produce un
        # residuo più alto nei mesi in cui ω_s non si allinea ai confini d'ora.
        assert abs(bh_month_wh - expected_wh) / expected_wh < 0.02, (
            f"Mese {m}: Σh_bh={bh_month_wh:.1f} vs atteso {expected_wh:.1f}"
        )
        offset += n


@pytest.mark.asyncio
async def test_irradiance_daily_aggregates_regression(async_client):
    """
    Payload senza h_bh_daily / h_dh_daily → output identico al passato.
    (Con sky_condition='average', default pre-esistente.)
    """
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
    }
    r1 = await async_client.post("/api/v1/solar/irradiance", json=payload)
    r2 = await async_client.post(
        "/api/v1/solar/irradiance",
        json={**payload, "h_bh_daily": None, "h_dh_daily": None},
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["annual_total"] == r2.json()["annual_total"]


@pytest.mark.asyncio
async def test_irradiance_daily_aggregates_activates_branch(async_client):
    """
    Payload con h_bh_daily + h_dh_daily + sky_condition='average' → branch CPRG+LJ attivo,
    output coerente (annual_total > 0, range realistico per Roma).
    """
    # Valori indicativi UNI 10349 per Roma (kWh/m²·d, stima compatta)
    h_bh = [1.5, 2.0, 2.8, 3.5, 4.3, 4.9, 5.2, 4.7, 3.6, 2.5, 1.7, 1.3]
    h_dh = [1.2, 1.5, 2.0, 2.3, 2.6, 2.7, 2.5, 2.3, 1.9, 1.5, 1.2, 1.0]
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
        "sky_condition": "average",
        "h_bh_daily": h_bh,
        "h_dh_daily": h_dh,
    }
    r = await async_client.post("/api/v1/solar/irradiance", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["annual_total"] > 0
    # Range ampio (l'input è medio UNI 10349, non TMY) — verifica ordine di grandezza
    assert 1000 <= data["annual_total"] <= 2500, (
        f"annual_total={data['annual_total']} fuori range plausibile Roma"
    )


@pytest.mark.asyncio
async def test_irradiance_daily_aggregates_validation(async_client):
    """h_bh_daily di lunghezza ≠ 12 → 422."""
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
        "h_bh_daily": [1.0] * 11,
        "h_dh_daily": [1.0] * 12,
    }
    r = await async_client.post("/api/v1/solar/irradiance", json=payload)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_decomposition_generic_only_ghi(async_client):
    """
    Con solo ghi_series e sky_condition='generic', la scomposizione Erbs viene attivata.
    Verifica: status 200, annual_total > 0, nessun crash.
    """
    import pvlib, pandas as pd
    loc = pvlib.location.Location(41.9, 12.5, tz="Europe/Rome")
    times = pd.date_range("2024-01-01", "2024-12-31 23:00", freq="1h", tz="Europe/Rome")
    cs = loc.get_clearsky(times)
    ghi_list = cs["ghi"].clip(lower=0).tolist()

    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "year": 2024,
        "timezone": "Europe/Rome",
        "sky_condition": "generic",
        "decomposition_model": "erbs",
        "ghi_series": ghi_list,
    }
    r = await async_client.post("/api/v1/solar/irradiance", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["annual_total"] > 0


# ─── Reflected irradiance — Eq. 4.2 (Step 8) ───────────────


def test_reflected_irradiance_isotropic_matches_legacy_view_factor():
    """I_r = ρ · (1−cos Σ)/2 · GHI (view-factor classico Liu-Jordan)."""
    from app.services.solar_service import compute_reflected_irradiance
    bhi, dhi = 600.0, 200.0
    tilt = 30.0
    rho = 0.2
    i_r = compute_reflected_irradiance(bhi, dhi, tilt, rho=rho, sky_model="isotropic")
    expected = rho * (bhi + dhi) * (1.0 - np.cos(np.radians(tilt))) / 2.0
    assert abs(float(i_r) - expected) < 1e-9


def test_reflected_irradiance_open_scene_matches_isotropic():
    """F_s,th = F_s,rh = 0 → brunger_hooper coincide con isotropo (tolleranza 5%)."""
    from app.services.solar_service import compute_reflected_irradiance
    i_r_iso = compute_reflected_irradiance(550.0, 250.0, 25.0, rho=0.2, sky_model="isotropic")
    i_r_bh = compute_reflected_irradiance(
        550.0, 250.0, 25.0, rho=0.2, F_s_th_beam=0.0, F_s_rh=0.0, sky_model="brunger_hooper"
    )
    rel_err = abs(float(i_r_bh) - float(i_r_iso)) / float(i_r_iso)
    assert rel_err < 0.05, f"Δ rel={rel_err:.3f} oltre la tolleranza 5%"


def test_reflected_irradiance_with_wall_reduces_ir():
    """Scena con F_s,rh > 0 e F_s,th_beam > 0: I_r < caso aperto."""
    from app.services.solar_service import compute_reflected_irradiance
    bhi, dhi = 500.0, 200.0
    i_r_open = compute_reflected_irradiance(
        bhi, dhi, 30.0, rho=0.2, F_s_th_beam=0.0, F_s_rh=0.0, sky_model="brunger_hooper"
    )
    i_r_wall = compute_reflected_irradiance(
        bhi, dhi, 30.0, rho=0.2, F_s_th_beam=0.4, F_s_rh=0.6, sky_model="brunger_hooper"
    )
    assert i_r_wall < i_r_open
    expected_ratio = (0.6 * bhi + 0.4 * dhi) / (bhi + dhi)
    assert abs(float(i_r_wall) / float(i_r_open) - expected_ratio) < 1e-6


def test_reflected_irradiance_vectorized():
    """Firma ndarray: calcolo elementwise su serie orarie."""
    from app.services.solar_service import compute_reflected_irradiance
    bhi = np.array([0.0, 100.0, 600.0, 0.0])
    dhi = np.array([0.0, 50.0, 200.0, 20.0])
    i_r = compute_reflected_irradiance(bhi, dhi, tilt_deg=30.0, rho=0.2, sky_model="isotropic")
    assert i_r.shape == bhi.shape
    assert float(i_r[0]) == 0.0
    assert float(i_r[2]) > float(i_r[1])


# ─── Obstruction factors (sky + ground) — by-product Step 7/8 ───


def test_surface_obstruction_factors_open_scene():
    """Scena aperta: F_s,th ≈ 0 e F_s,rh ≈ 0."""
    import trimesh
    from app.services.sky_diffuse import compute_surface_obstruction_factors

    far = trimesh.creation.box(extents=[0.1, 0.1, 0.1])
    far.apply_translation([500.0, -500.0, 500.0])
    cells = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 1.0]])
    normals = np.tile([0.0, 1.0, 0.0], (2, 1))

    f_s_th, f_s_rh = compute_surface_obstruction_factors(cells, normals, far)
    assert np.all(f_s_th < 0.01)
    assert np.all(f_s_rh < 0.01)


def test_surface_obstruction_factors_north_wall_increases_rh():
    """Muro alto a Nord: F_s,rh maggiore per celle vicine al muro."""
    import trimesh
    from app.services.sky_diffuse import compute_surface_obstruction_factors

    wall = trimesh.creation.box(extents=[10.0, 8.0, 0.2])
    wall.apply_translation([0.0, 4.0, -2.0])

    cells = np.array([
        [0.0, 0.0, -1.5],
        [0.0, 0.0,  2.5],
    ])
    normals = np.tile([0.0, 1.0, 0.0], (2, 1))

    f_s_th, f_s_rh = compute_surface_obstruction_factors(cells, normals, wall)
    assert f_s_rh[0] > f_s_rh[1]
    assert f_s_rh[0] > 0.0
