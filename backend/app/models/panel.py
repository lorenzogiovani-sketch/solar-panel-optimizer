from pydantic import BaseModel, Field
from typing import List, Optional


class PanelCreate(BaseModel):
    """Dati di un pannello solare inseriti manualmente dall'utente."""
    constructor: str = Field(..., max_length=200, description="Produttore del pannello")
    model: str = Field(..., max_length=200, description="Nome / codice modello")
    power_w: float = Field(..., gt=0, le=2000, description="Potenza nominale Pmax (W)")
    efficiency_pct: float = Field(..., gt=0, le=50, description="Efficienza modulo (%)")
    width_m: float = Field(..., gt=0, le=5, description="Larghezza modulo (m)")
    height_m: float = Field(..., gt=0, le=5, description="Altezza modulo (m)")
    weight_kg: Optional[float] = Field(None, gt=0, description="Peso modulo (kg)")
    op_temperature_c: Optional[str] = Field(None, description="Intervallo temperatura operativa (es. -40 / +85 °C)")
    temp_coefficient: Optional[float] = Field(None, description="Coefficiente di temperatura Pmax (%/°C, tipicamente negativo)")
    warranty_years: Optional[int] = Field(None, ge=0, le=50, description="Garanzia prodotto (anni)")
    degradation_pct: Optional[float] = Field(None, ge=0, le=5, description="Degrado annuo stimato (%/anno)")
    # Parametri elettrici (opzionali, per dimensionamento stringhe/inverter)
    voc_v: Optional[float] = Field(None, gt=0, le=100, description="Tensione a circuito aperto Voc (V)")
    isc_a: Optional[float] = Field(None, gt=0, le=30, description="Corrente di corto circuito Isc (A)")
    vmpp_v: Optional[float] = Field(None, gt=0, le=100, description="Tensione al MPP Vmpp (V)")
    impp_a: Optional[float] = Field(None, gt=0, le=30, description="Corrente al MPP Impp (A)")
    temp_coeff_voc: Optional[float] = Field(None, description="Coeff. temperatura Voc (%/°C, tipicamente negativo)")
    temp_coeff_isc: Optional[float] = Field(None, description="Coeff. temperatura Isc (%/°C, tipicamente positivo)")


class PanelRead(PanelCreate):
    """Pannello dal catalogo con identificativo univoco."""
    id: str = Field(..., description="Identificativo univoco generato dal server")

    # Alias per retrocompatibilità con PanelControls/ComparisonView
    @property
    def manufacturer(self) -> str:
        return self.constructor

    @property
    def model_name(self) -> str:
        return self.model


class PanelComparisonRequest(BaseModel):
    """Request per confronto produzione tra pannelli nel catalogo."""
    panel_ids: List[str] = Field(..., description="ID dei pannelli da confrontare")
    annual_irradiance_kwh_m2: float = Field(default=1700.0, gt=0)
    avg_shadow_factor: float = Field(default=1.0, ge=0, le=1, description="1=no ombra, 0=ombra totale")
    roof_area_m2: Optional[float] = Field(None, gt=0, description="Area disponibile per stimare n. pannelli")


class PanelProductionEstimate(BaseModel):
    """Stima produzione per un singolo pannello."""
    panel_id: str
    label: str
    panels_fit: int = Field(0, description="Pannelli stimati nell'area")
    annual_kwh_per_panel: float
    total_annual_kwh: float
    total_power_kwp: float
    degradation_pct: Optional[float] = None
    temp_coefficient: Optional[float] = None


class PanelComparisonResponse(BaseModel):
    """Risposta confronto pannelli."""
    estimates: List[PanelProductionEstimate]
