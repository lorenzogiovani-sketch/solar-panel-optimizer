from pydantic import BaseModel, Field
from typing import List, Literal, Optional


class StringingRequest(BaseModel):
    """Request per il dimensionamento stringhe fotovoltaiche."""
    mode: Literal['auto', 'manual'] = 'auto'
    # Parametri pannello
    voc_v: float = Field(..., gt=0, description="Tensione a circuito aperto Voc (V)")
    isc_a: float = Field(..., gt=0, description="Corrente di corto circuito Isc (A)")
    vmpp_v: float = Field(..., gt=0, description="Tensione al MPP Vmpp (V)")
    impp_a: float = Field(..., gt=0, description="Corrente al MPP Impp (A)")
    power_w: float = Field(..., gt=0, description="Potenza nominale Pmax (W)")
    temp_coeff_voc: float = Field(default=-0.27, description="Coeff. temperatura Voc (%/°C)")
    temp_coeff_isc: float = Field(default=0.05, description="Coeff. temperatura Isc (%/°C)")
    # Parametri inverter
    mppt_channels: int = Field(..., ge=1, description="Numero canali MPPT")
    mppt_voltage_min_v: float = Field(..., gt=0, description="Tensione minima MPPT (V)")
    mppt_voltage_max_v: float = Field(..., gt=0, description="Tensione massima MPPT (V)")
    max_input_voltage_v: float = Field(..., gt=0, description="Tensione massima ingresso DC (V)")
    max_input_current_a: float = Field(..., gt=0, description="Corrente massima per canale MPPT (A)")
    max_dc_power_kw: float = Field(..., gt=0, description="Potenza massima DC ingresso (kW)")
    inverter_power_kw: float = Field(..., gt=0, description="Potenza nominale AC inverter (kW)")
    # Parametri sito
    t_min_c: float = Field(default=-10.0, description="Temperatura minima storica sito (°C)")
    t_max_c: float = Field(default=40.0, description="Temperatura massima storica sito (°C)")
    # Configurazione
    total_panels: int = Field(..., ge=1, description="Numero totale pannelli posizionati")
    # Solo per mode='manual'
    panels_per_string: Optional[int] = Field(None, ge=1, description="Pannelli per stringa (solo modo manuale)")
    strings_per_mppt: Optional[int] = Field(None, ge=1, description="Stringhe per canale MPPT (solo modo manuale)")


class StringingResponse(BaseModel):
    """Risposta dimensionamento stringhe fotovoltaiche."""
    compatible: bool = Field(..., description="Compatibilità globale")
    status: Literal['ok', 'warning', 'error'] = Field(..., description="Stato complessivo")
    panels_per_string: int = Field(..., description="Pannelli in serie per stringa")
    strings_per_mppt: int = Field(..., description="Stringhe in parallelo per canale MPPT")
    mppt_used: int = Field(..., description="Canali MPPT utilizzati")
    total_panels_used: int = Field(..., description="Pannelli totali utilizzati")
    total_panels_unused: int = Field(..., description="Pannelli non assegnabili")
    dc_power_kw: float = Field(..., description="Potenza DC totale (kW)")
    voc_max_v: float = Field(..., description="Voc massima a T_min (V)")
    vmpp_min_v: float = Field(..., description="Vmpp minima a T_max (V)")
    vmpp_max_v: float = Field(..., description="Vmpp massima a T_min (V)")
    isc_max_a: float = Field(..., description="Isc massima a T_max (A)")
    dc_ac_ratio: float = Field(..., description="Rapporto sovradimensionamento DC/AC")
    warnings: List[str] = Field(default_factory=list, description="Lista warning/errori")
