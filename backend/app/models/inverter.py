from pydantic import BaseModel, Field
from typing import Optional


class InverterCreate(BaseModel):
    """Dati di un inverter inseriti manualmente dall'utente."""
    constructor: str = Field(..., max_length=200, description="Produttore")
    model: str = Field(..., max_length=200, description="Nome / codice modello")
    power_kw: float = Field(..., gt=0, le=500, description="Potenza nominale AC (kW)")
    max_dc_power_kw: float = Field(..., gt=0, le=600, description="Potenza massima DC ingresso (kW)")
    mppt_channels: int = Field(..., ge=1, le=20, description="Numero canali MPPT")
    mppt_voltage_min_v: float = Field(..., gt=0, description="Tensione minima MPPT (V)")
    mppt_voltage_max_v: float = Field(..., gt=0, description="Tensione massima MPPT (V)")
    max_input_voltage_v: float = Field(..., gt=0, description="Tensione massima ingresso DC (V)")
    max_input_current_a: float = Field(..., gt=0, description="Corrente massima per canale MPPT (A)")
    efficiency_pct: float = Field(..., gt=0, le=100, description="Efficienza Euro/CEC (%)")
    weight_kg: Optional[float] = Field(None, gt=0, description="Peso (kg)")
    warranty_years: Optional[int] = Field(None, ge=0, le=30, description="Garanzia (anni)")


class InverterRead(InverterCreate):
    """Inverter dal catalogo con identificativo univoco."""
    id: str = Field(..., description="Identificativo univoco generato dal server")
