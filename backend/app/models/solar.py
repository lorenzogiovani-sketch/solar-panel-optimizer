from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import List, Optional, Dict

from app.models.validators import normalize_polygons
from app.services.decomposition import DecompositionModel


class AtmosphereProfile(str, Enum):
    rural = "rural"
    urban = "urban"
    industrial = "industrial"
    custom = "custom"


class SkyCondition(str, Enum):
    clear = "clear"
    average = "average"
    generic = "generic"

def _current_year() -> int:
    return datetime.now().year

class SunPathRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, description="Latitudine del sito (gradi decimali)")
    longitude: float = Field(..., ge=-180, le=180, description="Longitudine del sito (gradi decimali)")
    year: int = Field(default_factory=_current_year, ge=1950, le=2100, description="Anno per la simulazione")
    timezone: str = Field("UTC", description="Timezone (es. 'Europe/Rome', 'UTC')")
    altitude: Optional[float] = Field(0.0, ge=0, description="Altitudine del sito in metri s.l.m., usata per correggere la massa d'aria atmosferica (Kasten-Young, Eq. 1.28)")

class SunPathResponse(BaseModel):
    timestamps: List[str] = Field(..., description="Lista dei timestamp (ISO 8601)")
    azimuth: List[float] = Field(..., description="Lista dei valori di azimuth solare (gradi)")
    elevation: List[float] = Field(..., description="Lista dei valori di elevazione solare (gradi)")
    zenith: List[float] = Field(..., description="Lista dei valori di zenith solare (gradi)")

class RoofSurface(BaseModel):
    """Superficie del tetto con tilt/azimuth/peso per calcolo irradianza pesata."""
    tilt: float = Field(..., description="Inclinazione superficie (gradi)")
    azimuth: float = Field(..., description="Orientamento superficie (gradi, conv. pvlib)")
    weight: float = Field(1.0, gt=0, le=1, description="Peso relativo (frazione area totale)")
    face: str = Field("", description="Nome falda (south, north, east, west, flat)")

class IrradianceRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, description="Latitudine del sito (gradi decimali)")
    longitude: float = Field(..., ge=-180, le=180, description="Longitudine del sito (gradi decimali)")
    tilt: float = Field(..., description="Inclinazione del pannello (gradi, 0=orizzontale, 90=verticale)")
    azimuth: float = Field(..., description="Orientamento del pannello (gradi, 180=Sud)")
    year: int = Field(default_factory=_current_year, ge=1950, le=2100, description="Anno per la simulazione")
    timezone: str = Field("UTC", description="Timezone (es. 'Europe/Rome', 'UTC')")
    altitude: Optional[float] = Field(0.0, ge=0, description="Altitudine del sito in metri s.l.m., usata per correggere la massa d'aria atmosferica (Kasten-Young, Eq. 1.28)")
    atmosphere_profile: Optional[AtmosphereProfile] = Field(None, description="Profilo atmosferico predefinito (rural/urban/industrial/custom). None = pipeline pvlib invariata.")
    angstrom_beta: Optional[float] = Field(None, ge=0, le=1, description="Coefficiente di torbidezza Ångström β_A (0=limpido, 0.4=molto torbido). Usato se atmosphere_profile=custom o None con questo campo valorizzato.")
    angstrom_alpha: Optional[float] = Field(1.3, ge=0, le=3, description="Esponente di lunghezza d'onda Ångström α (default 1.3, aerosol rurali).")
    sky_condition: Optional[SkyCondition] = Field(
        SkyCondition.average,
        description="Condizione atmosferica: 'clear' (REST2/Bird), 'average' (Ineichen, default), 'generic' (scomposizione GHI→DNI/DHI se ghi_series fornito).",
    )
    decomposition_model: Optional[DecompositionModel] = Field(
        DecompositionModel.erbs,
        description="Modello di scomposizione GHI→(DNI,DHI). Attivo solo con sky_condition='generic' e ghi_series valorizzato senza dni_series/dhi_series.",
    )
    ghi_series: Optional[List[float]] = Field(
        None, description="Serie oraria GHI misurata (W/m², 8760 valori). Se fornita senza dni_series/dhi_series con sky_condition='generic', attiva la scomposizione."
    )
    dni_series: Optional[List[float]] = Field(
        None, description="Serie oraria DNI misurata (W/m²). Se fornita insieme a dhi_series, bypassa la scomposizione."
    )
    dhi_series: Optional[List[float]] = Field(
        None, description="Serie oraria DHI misurata (W/m²). Se fornita insieme a dni_series, bypassa la scomposizione."
    )
    roof_surfaces: Optional[List[RoofSurface]] = Field(
        None, description="Se presente, calcola irradianza pesata su più superfici del tetto. Override tilt/azimuth."
    )
    h_bh_daily: Optional[List[float]] = Field(
        None,
        description=(
            "12 valori mensili di irraggiamento diretto giornaliero medio su piano "
            "orizzontale (kWh/m²·d), come da UNI 10349-3. Se forniti insieme a "
            "h_dh_daily e con sky_condition='average', attiva la disaggregazione "
            "oraria Collares-Pereira-Rabl / Gueymard (beam) + Liu-Jordan (diffuse)."
        ),
    )
    h_dh_daily: Optional[List[float]] = Field(
        None,
        description=(
            "12 valori mensili di irraggiamento diffuso giornaliero medio su piano "
            "orizzontale (kWh/m²·d), come da UNI 10349-3. Vedi h_bh_daily."
        ),
    )

    @field_validator("h_bh_daily", "h_dh_daily")
    @classmethod
    def _validate_monthly_daily(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is None:
            return v
        if len(v) != 12:
            raise ValueError("h_bh_daily / h_dh_daily devono avere esattamente 12 valori (uno per mese)")
        if any((x is None) or (x < 0) for x in v):
            raise ValueError("h_bh_daily / h_dh_daily non possono contenere valori negativi o nulli")
        return v

class SurfaceIrradiance(BaseModel):
    """Irradianza annua per una singola superficie del tetto."""
    face: str = Field(..., description="Nome falda (south, north, east, west, flat)")
    tilt: float = Field(..., description="Tilt superficie (gradi)")
    azimuth: float = Field(..., description="Azimuth superficie (gradi)")
    annual_total: float = Field(..., description="Irradianza annua POA (kWh/m²)")

class IrradianceResponse(BaseModel):
    timestamps: List[str] = Field(..., description="Lista dei timestamp (ISO 8601)")
    poa_global: List[float] = Field(..., description="Irradianza globale sul piano inclinato (W/m²)")
    poa_direct: List[float] = Field(..., description="Componente diretta sul piano inclinato (W/m²)")
    poa_diffuse: List[float] = Field(..., description="Componente diffusa sul piano inclinato (W/m²)")
    monthly_totals: Dict[str, float] = Field(..., description="Totali mensili (kWh/m²)")
    annual_total: float = Field(..., description="Totale annuo (kWh/m²)")
    per_surface: Optional[List[SurfaceIrradiance]] = Field(
        None, description="Irradianza annua per ogni superficie del tetto (se roof_surfaces fornito)"
    )


# ─── Daily Simulation Models ──────────────────────────────

class PanelGroup(BaseModel):
    """Gruppo di pannelli su una stessa falda del tetto."""
    tilt: float = Field(..., description="Tilt falda (gradi)")
    azimuth: float = Field(..., description="Azimuth falda (gradi, conv. pvlib)")
    count: int = Field(..., ge=1, description="Numero pannelli su questa falda")


class DailySimulationRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, description="Latitudine del sito")
    longitude: float = Field(..., ge=-180, le=180, description="Longitudine del sito")
    year: int = Field(default_factory=_current_year, ge=1950, le=2100, description="Anno per la simulazione")
    timezone: str = Field("Europe/Rome", description="Timezone")
    month: int = Field(..., ge=1, le=12, description="Mese (1-12)")
    day: int = Field(..., ge=1, le=31, description="Giorno (1-31)")
    tilt: float = Field(0, description="Inclinazione pannelli (gradi)")
    panel_azimuth: float = Field(180, description="Orientamento pannelli (gradi, 180=Sud)")
    panel_groups: Optional[List[PanelGroup]] = Field(
        None, description="Gruppi pannelli per-falda. Se presente, tilt/panel_azimuth vengono ignorati per il calcolo POA."
    )
    building_azimuth: float = Field(180, description="Azimuth edificio (gradi)")
    model_rotation: float = Field(0, description="Rotazione modello (gradi)")
    model_offset_y: float = Field(0, description="Offset verticale modello importato (metri)")
    altitude: Optional[float] = Field(0.0, ge=0, description="Altitudine del sito in metri s.l.m., usata per correggere la massa d'aria atmosferica (Kasten-Young, Eq. 1.28)")
    building: Dict = Field(..., description="Geometria edificio")
    obstacles: List[Dict] = Field(default=[], description="Ostacoli")
    panels: List[Dict] = Field(default=[], description="Posizioni pannelli [{x, y, z, width, height}]")
    panel_power_w: float = Field(400, description="Potenza nominale pannello (W)")
    panel_efficiency: float = Field(0.21, description="Efficienza pannello")
    temp_coefficient: float = Field(-0.4, description="Coefficiente di temperatura Pmax (%/°C, es. -0.4)")
    noct_temperature: float = Field(45.0, description="Temperatura nominale di funzionamento cella NOCT (°C)")
    system_losses: float = Field(default=0.14, ge=0.0, le=0.5, description="Perdite totali di sistema BOS (0-0.5, default 14%)")
    ambient_temperature: Optional[float] = Field(default=None, description="Override temperatura ambiente (°C). Se None, stima stagionale automatica.")
    installation_polygon: Optional[List[Dict[str, float]]] = Field(None, description="[Deprecated] Singolo poligono")
    installation_polygons: Optional[List[List[Dict[str, float]]]] = Field(None, description="Lista di poligoni installazione")

    @model_validator(mode='after')
    def _normalize_polygons(self):
        return normalize_polygons(self)


class HourlyDataPoint(BaseModel):
    time: str = Field(..., description="Ora (HH:MM)")
    solar_elevation: float = Field(..., description="Elevazione solare (gradi)")
    solar_azimuth: float = Field(..., description="Azimuth solare (gradi)")
    poa_global: float = Field(..., description="Irradianza POA clear-sky (W/m²)")
    power_w: float = Field(..., description="Potenza effettiva prodotta (W) — con ombre e perdite termiche")
    power_ideal_w: float = Field(..., description="Potenza ideale senza ombre, con de-rating termico (W)")
    power_clearsky_w: float = Field(..., description="Potenza teorica clear-sky pura, senza ombre né perdite termiche (W)")
    shading_loss_pct: float = Field(..., description="Perdita per ombreggiatura (%)")
    temp_loss_pct: float = Field(default=0.0, description="Perdita termica (%)")


class DailySimulationResponse(BaseModel):
    date: str = Field(..., description="Data simulata (YYYY-MM-DD)")
    hourly: List[HourlyDataPoint] = Field(..., description="Dati orari da alba a tramonto")
    daily_kwh: float = Field(..., description="Produzione giornaliera effettiva (kWh) — con ombre e perdite termiche")
    daily_kwh_ideal: float = Field(..., description="Produzione giornaliera ideale senza ombre (kWh)")
    daily_kwh_clearsky: float = Field(..., description="Produzione giornaliera teorica clear-sky pura (kWh)")
    peak_power_w: float = Field(..., description="Potenza di picco effettiva (W)")
    sunshine_hours: float = Field(..., description="Ore di sole effettive")
    daily_temp_loss_pct: float = Field(default=0.0, description="Perdita termica media ponderata sulla giornata (%)")
    computation_time_s: Optional[float] = Field(default=None, description="Tempo di calcolo backend (secondi)")


# ─── Economics Models ──────────────────────────────────────

class EconomicsRequest(BaseModel):
    monthly_production_kwh: List[float] = Field(..., min_length=12, max_length=12, description="Produzione mensile (kWh) per i 12 mesi")
    annual_consumption_kwh: Optional[float] = Field(None, gt=0, description="Consumo annuo dell'utenza (kWh)")
    monthly_consumption_kwh: Optional[List[float]] = Field(None, description="Consumo mensile (kWh) per i 12 mesi")
    hourly_consumption_kwh: Optional[List[float]] = Field(None, description="Consumo orario (kWh) per le 8760 ore dell'anno")
    energy_price_eur: float = Field(0.25, gt=0, description="Tariffa energia elettrica (EUR/kWh)")
    feed_in_tariff_eur: float = Field(0.08, ge=0, description="Tariffa cessione GSE (EUR/kWh)")
    system_cost_eur: Optional[float] = Field(None, gt=0, description="Costo impianto (EUR), opzionale per calcolo payback")

    @model_validator(mode='after')
    def _validate_consumption(self):
        if self.hourly_consumption_kwh is not None:
            if len(self.hourly_consumption_kwh) != 8760:
                raise ValueError("hourly_consumption_kwh deve avere esattamente 8760 valori")
            if any(v < 0 for v in self.hourly_consumption_kwh):
                raise ValueError("hourly_consumption_kwh non può contenere valori negativi")
            self.annual_consumption_kwh = sum(self.hourly_consumption_kwh)
        elif self.monthly_consumption_kwh is not None:
            if len(self.monthly_consumption_kwh) != 12:
                raise ValueError("monthly_consumption_kwh deve avere esattamente 12 valori")
            if any(v < 0 for v in self.monthly_consumption_kwh):
                raise ValueError("monthly_consumption_kwh non può contenere valori negativi")
            self.annual_consumption_kwh = sum(self.monthly_consumption_kwh)
        elif self.annual_consumption_kwh is None:
            self.annual_consumption_kwh = 3500
        return self

class MonthlyEconomicsData(BaseModel):
    month: int = Field(..., ge=1, le=12)
    month_name: str
    production_kwh: float
    consumption_kwh: float
    self_consumed_kwh: float
    fed_in_kwh: float
    grid_consumed_kwh: float
    savings_eur: float
    revenue_eur: float

class HourlyAnalysis(BaseModel):
    """Analisi statistica del profilo di consumo orario (8760 valori)."""
    avg_daily_kwh: float = Field(..., description="Consumo medio giornaliero (kWh/giorno)")
    avg_hourly_kwh: float = Field(..., description="Consumo medio orario (kWh/h)")
    peak_hourly_kw: float = Field(..., description="Picco orario massimo (kW)")
    peak_hour_index: int = Field(..., ge=0, le=8759, description="Indice ora del picco (0-8759)")
    peak_hour_label: str = Field(..., description="Label leggibile del picco (es. '15 Marzo, ore 18:00')")
    base_load_kw: float = Field(..., description="Carico base stimato — percentile 10 (kW)")
    peak_to_avg_ratio: float = Field(..., description="Rapporto picco/media")
    daily_profile: List[float] = Field(..., min_length=24, max_length=24, description="Media oraria (24 valori, kWh)")
    weekly_profile: List[float] = Field(..., min_length=7, max_length=7, description="Media giornaliera per giorno settimana (7 valori, kWh, Lun=0)")
    monthly_totals: List[float] = Field(..., min_length=12, max_length=12, description="Totale mensile (12 valori, kWh)")
    daily_totals: List[float] = Field(..., min_length=365, max_length=366, description="Totale giornaliero (365 valori, kWh)")


class EconomicsResponse(BaseModel):
    monthly: List[MonthlyEconomicsData]
    total_production_kwh: float
    total_self_consumed_kwh: float
    total_fed_in_kwh: float
    total_savings_eur: float
    total_revenue_eur: float
    self_consumption_rate_pct: float
    self_sufficiency_rate_pct: float
    payback_years: Optional[float] = None
    annual_consumption_kwh: float = Field(..., description="Consumo annuo totale usato per il calcolo (kWh)")
    hourly_analysis: Optional[HourlyAnalysis] = Field(None, description="Analisi statistica profilo consumo orario (solo se hourly_consumption_kwh fornito)")
