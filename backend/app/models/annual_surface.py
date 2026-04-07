from datetime import datetime
from typing import List, Optional, Dict

from pydantic import BaseModel, Field, model_validator

from app.models.solar import PanelGroup
from app.models.validators import normalize_polygons


def _current_year() -> int:
    return datetime.now().year


class AnnualSurfaceRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, description="Latitudine del sito")
    longitude: float = Field(..., ge=-180, le=180, description="Longitudine del sito")
    year: int = Field(default_factory=_current_year, ge=1950, le=2100)
    timezone: str = Field("Europe/Rome", description="Timezone")
    tilt: float = Field(0, description="Inclinazione pannelli (gradi)")
    panel_azimuth: float = Field(180, description="Orientamento pannelli (gradi, 180=Sud)")
    panel_groups: Optional[List[PanelGroup]] = Field(None, description="Gruppi pannelli per-falda")
    building_azimuth: float = Field(180, description="Azimuth edificio (gradi)")
    model_rotation: float = Field(0, description="Rotazione modello (gradi)")
    model_offset_y: float = Field(0, description="Offset verticale modello importato (m)")
    building: Dict = Field(..., description="Geometria edificio")
    obstacles: List[Dict] = Field(default=[], description="Ostacoli")
    panels: List[Dict] = Field(default=[], description="Posizioni pannelli")
    panel_power_w: float = Field(400, description="Potenza nominale pannello (W)")
    panel_efficiency: float = Field(0.21, description="Efficienza pannello")
    temp_coefficient: float = Field(-0.4, description="Coefficiente temperatura Pmax (%/°C)")
    noct_temperature: float = Field(45.0, description="Temperatura NOCT (°C)")
    system_losses: float = Field(default=0.14, ge=0.0, le=0.5, description="Perdite BOS")
    ambient_temperature: Optional[float] = Field(default=None, description="Override temperatura ambiente (°C)")
    installation_polygon: Optional[List[Dict[str, float]]] = Field(None)
    installation_polygons: Optional[List[List[Dict[str, float]]]] = Field(None)
    curve_type: str = Field("power_w", description="Tipo curva (per future estensioni)")

    @model_validator(mode='after')
    def _normalize_polygons(self):
        return normalize_polygons(self)


class HourlySurfacePoint(BaseModel):
    power_w: float
    power_ideal_w: float
    power_clearsky_w: float
    poa_global: float


class DaySurfaceData(BaseModel):
    day_of_year: int
    date: str
    hours: List[HourlySurfacePoint] = Field(..., description="24 elementi, uno per ora")


class AnnualSurfaceResponse(BaseModel):
    days: List[DaySurfaceData] = Field(..., description="365 elementi")
    max_power_w: float
    max_poa: float
    computation_time_s: float
