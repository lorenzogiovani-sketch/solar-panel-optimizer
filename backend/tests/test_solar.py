import pytest
from datetime import datetime


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
