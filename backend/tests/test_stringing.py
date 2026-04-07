"""Test suite per il servizio dimensionamento stringhe fotovoltaiche."""

import pytest

from app.services.stringing_service import calculate_stringing
from app.models.stringing import StringingRequest


# ─── Fixture base ─────────────────────────────────────────────

def _base_request(**overrides) -> StringingRequest:
    """Request tipo: pannello 400W, inverter 6kW 2 MPPT, 20 pannelli."""
    defaults = dict(
        mode='auto',
        voc_v=41.0,
        isc_a=12.5,
        vmpp_v=34.0,
        impp_a=11.7,
        power_w=400.0,
        temp_coeff_voc=-0.27,
        temp_coeff_isc=0.05,
        mppt_channels=2,
        mppt_voltage_min_v=160.0,
        mppt_voltage_max_v=800.0,
        max_input_voltage_v=1000.0,
        max_input_current_a=25.0,
        max_dc_power_kw=9.0,
        inverter_power_kw=6.0,
        t_min_c=-10.0,
        t_max_c=40.0,
        total_panels=20,
    )
    defaults.update(overrides)
    return StringingRequest(**defaults)


# ─── Test modalità auto ───────────────────────────────────────

class TestAutoMode:
    def test_basic_auto_finds_valid_config(self):
        req = _base_request()
        res = calculate_stringing(req)

        assert res.panels_per_string >= 5  # 160/34 ≈ 4.7 → min 5
        assert res.panels_per_string <= 19  # limitato da Voc: 1000/41 ≈ 24, ma MPPT max 800/34 ≈ 23
        assert res.strings_per_mppt >= 1
        assert res.mppt_used >= 1
        assert res.total_panels_used <= 20
        assert res.total_panels_used + res.total_panels_unused == 20
        assert res.dc_power_kw > 0

    def test_auto_respects_voc_limit(self):
        req = _base_request()
        res = calculate_stringing(req)

        # Voc max a T_min = N_serie * 41 * (1 + (-0.27/100) * (-10-25))
        # = N_serie * 41 * (1 + 0.0945) = N_serie * 44.87
        assert res.voc_max_v <= 1000.0

    def test_auto_respects_mppt_range(self):
        req = _base_request()
        res = calculate_stringing(req)

        # Se status ok, vmpp deve essere nel range
        if res.status == 'ok':
            assert res.vmpp_min_v >= 160.0
            assert res.vmpp_max_v <= 800.0

    def test_auto_respects_current_limit(self):
        req = _base_request()
        res = calculate_stringing(req)

        if res.status == 'ok':
            assert res.isc_max_a <= 25.0

    def test_auto_maximizes_panels_used(self):
        req = _base_request(total_panels=10)
        res = calculate_stringing(req)

        assert res.total_panels_used <= 10
        assert res.total_panels_used > 0

    def test_auto_dc_ac_ratio(self):
        req = _base_request()
        res = calculate_stringing(req)

        expected_ratio = res.dc_power_kw / 6.0
        assert abs(res.dc_ac_ratio - expected_ratio) < 0.01

    def test_auto_no_valid_config(self):
        """Pannello con Voc troppo alta per l'inverter → nessuna configurazione."""
        req = _base_request(voc_v=600.0, max_input_voltage_v=500.0)
        res = calculate_stringing(req)

        assert res.compatible is False
        assert res.status == 'error'
        assert res.total_panels_used == 0
        assert len(res.warnings) > 0


# ─── Test modalità manuale ────────────────────────────────────

class TestManualMode:
    def test_manual_valid_config(self):
        req = _base_request(
            mode='manual',
            panels_per_string=10,
            strings_per_mppt=1,
        )
        res = calculate_stringing(req)

        assert res.panels_per_string == 10
        assert res.strings_per_mppt == 1
        assert res.total_panels_used == 20  # 10*1*2 MPPT = 20
        assert res.dc_power_kw > 0

    def test_manual_out_of_range_returns_error(self):
        """Config manuale con troppi pannelli in serie → Voc supera il limite."""
        req = _base_request(
            mode='manual',
            panels_per_string=25,  # 25 * 41 * 1.0945 ≈ 1122 V > 1000V
            strings_per_mppt=1,
        )
        res = calculate_stringing(req)

        assert res.status == 'error'
        assert res.compatible is False
        assert any('Voc' in w for w in res.warnings)

    def test_manual_current_exceeded(self):
        """Config con troppe stringhe in parallelo → corrente supera il limite."""
        req = _base_request(
            mode='manual',
            panels_per_string=5,
            strings_per_mppt=3,  # 3 * 12.5 * 1.00375 ≈ 37.6 A > 25 A
        )
        res = calculate_stringing(req)

        assert any('Isc' in w for w in res.warnings)

    def test_manual_unused_panels(self):
        """Config che non usa tutti i pannelli."""
        req = _base_request(
            mode='manual',
            panels_per_string=8,
            strings_per_mppt=1,
            total_panels=20,
        )
        res = calculate_stringing(req)

        # 8*1*2 = 16, dovrebbero rimanere 4 inutilizzati
        assert res.total_panels_used == 16
        assert res.total_panels_unused == 4


# ─── Test endpoint API ────────────────────────────────────────

@pytest.mark.asyncio
async def test_stringing_endpoint_auto(async_client):
    payload = {
        "mode": "auto",
        "voc_v": 41.0,
        "isc_a": 12.5,
        "vmpp_v": 34.0,
        "impp_a": 11.7,
        "power_w": 400.0,
        "mppt_channels": 2,
        "mppt_voltage_min_v": 160.0,
        "mppt_voltage_max_v": 800.0,
        "max_input_voltage_v": 1000.0,
        "max_input_current_a": 25.0,
        "max_dc_power_kw": 9.0,
        "inverter_power_kw": 6.0,
        "total_panels": 20,
    }
    response = await async_client.post("/api/v1/stringing/calculate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "panels_per_string" in data
    assert "compatible" in data
    assert data["total_panels_used"] + data["total_panels_unused"] == 20


@pytest.mark.asyncio
async def test_stringing_endpoint_manual_error(async_client):
    payload = {
        "mode": "manual",
        "voc_v": 41.0,
        "isc_a": 12.5,
        "vmpp_v": 34.0,
        "impp_a": 11.7,
        "power_w": 400.0,
        "mppt_channels": 2,
        "mppt_voltage_min_v": 160.0,
        "mppt_voltage_max_v": 800.0,
        "max_input_voltage_v": 1000.0,
        "max_input_current_a": 25.0,
        "max_dc_power_kw": 9.0,
        "inverter_power_kw": 6.0,
        "total_panels": 20,
        "panels_per_string": 25,
        "strings_per_mppt": 1,
    }
    response = await async_client.post("/api/v1/stringing/calculate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "error"
    assert len(data["warnings"]) > 0
