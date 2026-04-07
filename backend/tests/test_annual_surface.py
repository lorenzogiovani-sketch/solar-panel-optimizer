"""Test per l'endpoint annual-surface (calcolo superficie annuale potenza 3D)."""

import asyncio
import pytest


@pytest.mark.asyncio
async def test_annual_surface_run_and_poll(async_client):
    """Verifica che /annual-surface/run accetti una richiesta valida,
    restituisca un job_id, e che dopo polling il risultato contenga
    365 giorni × 24 ore."""

    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "timezone": "Europe/Rome",
        "tilt": 30,
        "panel_azimuth": 180,
        "building_azimuth": 180,
        "building": {
            "width": 10,
            "depth": 8,
            "height": 6,
            "roofType": "flat",
            "roofAngle": 0,
            "ridgeHeight": 0,
            "ridgeLength": 0,
        },
        "obstacles": [],
        "panels": [],
        "panel_power_w": 400,
        "panel_efficiency": 0.21,
        "temp_coefficient": -0.4,
        "noct_temperature": 45.0,
        "system_losses": 0.14,
    }

    # Avvia il job
    resp = await async_client.post("/api/v1/annual-surface/run", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "job_id" in data
    assert data["status"] == "running"
    job_id = data["job_id"]

    # Polling fino a completamento (max 120s)
    for _ in range(60):
        status_resp = await async_client.get(f"/api/v1/annual-surface/status/{job_id}")
        assert status_resp.status_code == 200
        status = status_resp.json()
        if status["status"] == "completed":
            break
        assert status["status"] in ("running", "completed")
        await asyncio.sleep(2)
    else:
        pytest.fail("Job non completato entro il timeout")

    # Recupera risultato
    result_resp = await async_client.get(f"/api/v1/annual-surface/result/{job_id}")
    assert result_resp.status_code == 200
    result = result_resp.json()

    # Verifica struttura
    assert "days" in result
    assert len(result["days"]) == 365 or len(result["days"]) == 366
    assert result["max_power_w"] >= 0
    assert result["max_poa"] >= 0
    assert result["computation_time_s"] > 0

    # Verifica primo giorno: 24 ore
    first_day = result["days"][0]
    assert first_day["day_of_year"] == 1
    assert len(first_day["hours"]) == 24

    # Verifica che almeno un'ora abbia potenza > 0 (non è tutto zero)
    any_power = any(
        h["power_w"] > 0
        for day in result["days"]
        for h in day["hours"]
    )
    assert any_power, "Nessuna ora con potenza > 0 nell'intero anno"


@pytest.mark.asyncio
async def test_annual_surface_status_not_found(async_client):
    """Verifica 404 per job_id inesistente."""
    resp = await async_client.get("/api/v1/annual-surface/status/fake-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_annual_surface_result_not_found(async_client):
    """Verifica 404 per job_id inesistente."""
    resp = await async_client.get("/api/v1/annual-surface/result/fake-id")
    assert resp.status_code == 404
