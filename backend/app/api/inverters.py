import logging
import uuid
from typing import List

from fastapi import APIRouter, HTTPException

from app.models.inverter import InverterCreate, InverterRead
from app.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

_COLUMNS = (
    "id", "constructor", "model", "power_kw", "max_dc_power_kw",
    "mppt_channels", "mppt_voltage_min_v", "mppt_voltage_max_v",
    "max_input_voltage_v", "max_input_current_a", "efficiency_pct",
    "weight_kg", "warranty_years",
)


def _row_to_inverter(row) -> InverterRead:
    return InverterRead(**dict(row))


# ─── CRUD ────────────────────────────────────────────────────


@router.post("", response_model=InverterRead, status_code=201, summary="Aggiungi inverter al catalogo")
def create_inverter(inverter: InverterCreate) -> InverterRead:
    """Aggiunge un inverter al catalogo persistente (SQLite)."""
    try:
        inv_id = uuid.uuid4().hex[:12]
        entry = InverterRead(id=inv_id, **inverter.model_dump())
        with get_db() as con:
            placeholders = ", ".join("?" * len(_COLUMNS))
            con.execute(
                f"INSERT INTO inverters ({', '.join(_COLUMNS)}) VALUES ({placeholders})",
                tuple(getattr(entry, col) for col in _COLUMNS),
            )
            con.commit()
        return entry
    except HTTPException:
        raise
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore durante la creazione dell'inverter")
        raise HTTPException(status_code=500, detail="Errore interno del server")


@router.get("", response_model=List[InverterRead], summary="Elenca inverter nel catalogo")
def list_inverters() -> List[InverterRead]:
    """Restituisce tutti gli inverter presenti nel catalogo."""
    try:
        with get_db() as con:
            rows = con.execute("SELECT * FROM inverters ORDER BY rowid").fetchall()
        return [_row_to_inverter(r) for r in rows]
    except Exception:
        logger.exception("Errore durante il listing degli inverter")
        raise HTTPException(status_code=500, detail="Errore interno del server")


@router.delete("/{inverter_id}", status_code=204, summary="Rimuovi inverter dal catalogo")
def delete_inverter(inverter_id: str) -> None:
    """Elimina un inverter dal catalogo tramite ID."""
    with get_db() as con:
        cur = con.execute("DELETE FROM inverters WHERE id = ?", (inverter_id,))
        con.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Inverter '{inverter_id}' non trovato")
