from typing import Optional, Dict, List

from pydantic import BaseModel, Field, model_validator


class SimulationResults(BaseModel):
    annual_irradiance: float = 1700
    annual_energy_kwh: float = 0
    peak_power_kw: float = 0
    num_panels: int = 0
    co2_avoided_kg: float = 0
    improvement_pct: float = 0


class PanelSpecsExport(BaseModel):
    constructor: str = ""
    model: str = ""
    power: float = 0
    efficiency: float = 0
    width: float = 0
    height: float = 0
    temp_coefficient: float = 0
    warranty_years: int = 0
    weight_kg: Optional[float] = None
    degradation_pct: Optional[float] = None
    voc_v: Optional[float] = None
    isc_a: Optional[float] = None
    vmpp_v: Optional[float] = None
    impp_a: Optional[float] = None


class PanelPosition(BaseModel):
    x: float = 0
    z: float = 0
    orientation: str = "portrait"
    string_id: Optional[int] = None


class KpiExport(BaseModel):
    total_panels: int = 0
    peak_power_kw: float = 0
    annual_energy_kwh: float = 0
    specific_yield: float = 0


class ProjectInfo(BaseModel):
    latitude: float = 0
    longitude: float = 0
    tilt: float = 0
    azimuth: float = 180
    panel_type: str = "Monocristallino 400W"


class EconomicDataExport(BaseModel):
    cost_per_kwp: float = 1500
    energy_price_kwh: float = 0.25
    self_consumption_pct: float = 70
    incentives: float = 0


class InverterSpecsExport(BaseModel):
    constructor: str = ""
    model: str = ""
    power_kw: float = 0
    max_dc_power_kw: float = 0
    mppt_channels: int = 1
    mppt_voltage_min_v: float = 0
    mppt_voltage_max_v: float = 0
    efficiency_pct: float = 0


class StringingExport(BaseModel):
    panels_per_string: int = 0
    strings_per_mppt: int = 0
    mppt_used: int = 0
    total_panels_used: int = 0
    dc_power_kw: float = 0
    voc_max_v: float = 0
    vmpp_min_v: float = 0
    vmpp_max_v: float = 0
    dc_ac_ratio: float = 0
    compatible: bool = True
    status: str = "ok"


class BuildingExport(BaseModel):
    roof_type: str = "flat"
    roof_angle: float = 0
    ridge_height: float = 0
    width: float = 10
    depth: float = 10
    height: float = 3
    model_rotation_y: float = 0


class ObstacleExport(BaseModel):
    type: str = "box"
    position: List[float] = [0, 0, 0]
    dimensions: List[float] = [1, 1, 1]


class ExportRequest(BaseModel):
    simulation_results: SimulationResults = SimulationResults()
    project_info: ProjectInfo = ProjectInfo()
    monthly_irradiance: Optional[Dict[str, float]] = None
    panel_specs: Optional[PanelSpecsExport] = None
    panels_layout: Optional[List[PanelPosition]] = None
    kpi: Optional[KpiExport] = None
    building_width: float = 10
    building_depth: float = 10
    economic: Optional[EconomicDataExport] = None
    inverter_specs: Optional[InverterSpecsExport] = None
    stringing: Optional[StringingExport] = None
    building_info: Optional[BuildingExport] = None
    obstacles: Optional[List[ObstacleExport]] = None


class PanelGroupExport(BaseModel):
    """Gruppo di pannelli su una stessa falda del tetto (per export orario)."""
    tilt: float = Field(..., description="Tilt falda (gradi)")
    azimuth: float = Field(..., description="Azimuth falda (gradi, conv. pvlib)")
    count: int = Field(..., ge=1, description="Numero pannelli su questa falda")


class HourlyCsvRequest(BaseModel):
    latitude: float
    longitude: float
    tilt: float
    azimuth: float
    timezone: str = "Europe/Rome"
    panel_power_w: float = 400
    efficiency: float = 0.2
    temp_coefficient: float = -0.4
    num_panels: int = 1
    system_losses: float = 0.14
    noct_temperature: float = 45.0
    year: int = 2024
    inverter_efficiency_pct: float = 100.0  # 100 = nessuna perdita inverter aggiuntiva
    inverter_model: str = ""
    inverter_power_kw: float = 0.0
    # Energia annua dalla simulazione (include ombre). Se fornito, i dati orari
    # vengono scalati affinché il totale annuo corrisponda a questo valore.
    annual_energy_kwh: float | None = None
    panel_groups: Optional[List[PanelGroupExport]] = Field(
        None, description="Gruppi pannelli per-falda. Se presente, tilt/azimuth vengono ignorati per il calcolo POA."
    )
    hourly_consumption_kwh: Optional[List[float]] = Field(
        None, description="Profilo consumo orario (8760 valori in kWh). Se presente, aggiunge colonna Consumption_Wh al CSV"
    )

    @model_validator(mode='after')
    def _validate_hourly_consumption(self):
        if self.hourly_consumption_kwh is not None:
            if len(self.hourly_consumption_kwh) != 8760:
                raise ValueError("hourly_consumption_kwh deve avere esattamente 8760 valori")
            if any(v < 0 for v in self.hourly_consumption_kwh):
                raise ValueError("hourly_consumption_kwh non può contenere valori negativi")
        return self
