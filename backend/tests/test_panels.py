import pytest


# ─── CRUD ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_and_list_panel(async_client, sample_panel_payload):
    """Crea un pannello e verifica che compaia nella lista."""
    # Create
    resp = await async_client.post("/api/v1/panels", json=sample_panel_payload)
    assert resp.status_code == 201
    panel = resp.json()
    assert panel["constructor"] == "TestCorp"
    assert panel["model"] == "TC-400"
    assert panel["power_w"] == 400
    assert "id" in panel

    # List
    resp = await async_client.get("/api/v1/panels")
    assert resp.status_code == 200
    panels = resp.json()
    ids = [p["id"] for p in panels]
    assert panel["id"] in ids


@pytest.mark.asyncio
async def test_delete_panel(async_client, sample_panel_payload):
    """Crea un pannello, poi eliminalo e verifica 204."""
    resp = await async_client.post("/api/v1/panels", json=sample_panel_payload)
    panel_id = resp.json()["id"]

    resp = await async_client.delete(f"/api/v1/panels/{panel_id}")
    assert resp.status_code == 204

    # Verifica che non sia più in lista
    resp = await async_client.get("/api/v1/panels")
    ids = [p["id"] for p in resp.json()]
    assert panel_id not in ids


@pytest.mark.asyncio
async def test_delete_nonexistent_panel(async_client):
    """Eliminare un pannello inesistente deve restituire 404."""
    resp = await async_client.delete("/api/v1/panels/nonexistent-id")
    assert resp.status_code == 404


# ─── Compare ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_compare_two_panels(async_client):
    """Crea 2 pannelli e confrontali."""
    p1 = {
        "constructor": "A",
        "model": "A-300",
        "power_w": 300,
        "efficiency_pct": 18.0,
        "width_m": 1.0,
        "height_m": 1.6,
    }
    p2 = {
        "constructor": "B",
        "model": "B-500",
        "power_w": 500,
        "efficiency_pct": 22.0,
        "width_m": 1.1,
        "height_m": 1.8,
    }
    r1 = await async_client.post("/api/v1/panels", json=p1)
    r2 = await async_client.post("/api/v1/panels", json=p2)
    id1, id2 = r1.json()["id"], r2.json()["id"]

    resp = await async_client.post(
        "/api/v1/panels/compare",
        json={
            "panel_ids": [id1, id2],
            "annual_irradiance_kwh_m2": 1700,
            "avg_shadow_factor": 1.0,
            "roof_area_m2": 30,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["estimates"]) == 2

    # Il pannello più efficiente e potente dovrebbe produrre di più per pannello
    kwh_1 = data["estimates"][0]["annual_kwh_per_panel"]
    kwh_2 = data["estimates"][1]["annual_kwh_per_panel"]
    assert kwh_2 > kwh_1, "B-500 (22%, 1.98m²) dovrebbe produrre più di A-300 (18%, 1.6m²)"


# ─── Validation ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_panel_negative_power(async_client):
    """power_w negativo deve restituire 422."""
    payload = {
        "constructor": "Bad",
        "model": "Bad-1",
        "power_w": -100,
        "efficiency_pct": 20.0,
        "width_m": 1.0,
        "height_m": 1.7,
    }
    resp = await async_client.post("/api/v1/panels", json=payload)
    assert resp.status_code == 422
