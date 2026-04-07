"""Test per l'endpoint di export CSV orario."""
import pytest


@pytest.mark.asyncio
async def test_csv_hourly_basic(async_client):
    """Il CSV orario deve restituire 200 e contenere 8760+ righe."""
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "timezone": "Europe/Rome",
        "panel_power_w": 400,
        "efficiency": 0.2,
        "temp_coefficient": -0.4,
        "num_panels": 10,
        "system_losses": 0.14,
        "noct_temperature": 45.0,
        "year": 2024,
    }
    response = await async_client.post("/api/v1/export/csv-hourly", json=payload)
    assert response.status_code == 200, f"Got {response.status_code}: {response.text}"
    assert response.headers["content-type"].startswith("text/csv")

    lines = response.text.strip().split("\n")
    # Header + 8760 data rows (or 8784 for leap year 2024)
    assert len(lines) >= 8761, f"Expected >=8761 lines, got {len(lines)}"

    # Check header columns
    header = lines[0]
    assert "Timestamp" in header
    assert "Power_W" in header
    assert "Energy_kWh" in header


@pytest.mark.asyncio
async def test_csv_hourly_night_zero(async_client):
    """Le ore notturne devono avere potenza 0."""
    payload = {
        "latitude": 41.9,
        "longitude": 12.5,
        "tilt": 30,
        "azimuth": 180,
        "timezone": "Europe/Rome",
        "panel_power_w": 400,
        "num_panels": 1,
        "year": 2024,
    }
    response = await async_client.post("/api/v1/export/csv-hourly", json=payload)
    assert response.status_code == 200

    lines = response.text.strip().split("\n")
    # Check midnight row (first data row = Jan 1 00:00)
    first_data = lines[1].split(",")
    assert first_data[0] == "2024-01-01 00:00"
    power_w = float(first_data[8])  # Power_W column
    assert power_w == 0.0, f"Night power should be 0, got {power_w}"
