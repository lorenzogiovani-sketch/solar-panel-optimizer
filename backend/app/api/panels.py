import logging
import uuid
from typing import List

from fastapi import APIRouter, HTTPException

from app.models.panel import (
    PanelCreate,
    PanelRead,
    PanelComparisonRequest,
    PanelComparisonResponse,
    PanelProductionEstimate,
)
from app.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

_COLUMNS = (
    "id", "constructor", "model", "power_w", "efficiency_pct",
    "width_m", "height_m", "weight_kg", "op_temperature_c",
    "temp_coefficient", "warranty_years", "degradation_pct",
    "voc_v", "isc_a", "vmpp_v", "impp_a", "temp_coeff_voc", "temp_coeff_isc",
)


def _row_to_panel(row) -> PanelRead:
    return PanelRead(**dict(row))


# ─── CRUD ────────────────────────────────────────────────────


@router.post("", response_model=PanelRead, status_code=201, summary="Aggiungi pannello al catalogo")
def create_panel(panel: PanelCreate) -> PanelRead:
    """
    Riceve i dati di targa di un pannello solare inseriti manualmente
    e li aggiunge al catalogo persistente (SQLite).
    """
    try:
        panel_id = str(uuid.uuid4())[:8]
        entry = PanelRead(id=panel_id, **panel.model_dump())
        with get_db() as con:
            placeholders = ", ".join("?" * len(_COLUMNS))
            con.execute(
                f"INSERT INTO panels ({', '.join(_COLUMNS)}) VALUES ({placeholders})",
                tuple(getattr(entry, col) for col in _COLUMNS),
            )
            con.commit()
        return entry
    except HTTPException:
        raise
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore durante la creazione del pannello")
        raise HTTPException(status_code=500, detail="Errore interno del server")


@router.get("", response_model=List[PanelRead], summary="Elenca pannelli nel catalogo")
def list_panels() -> List[PanelRead]:
    """Restituisce tutti i pannelli presenti nel catalogo."""
    try:
        with get_db() as con:
            rows = con.execute("SELECT * FROM panels ORDER BY rowid").fetchall()
        return [_row_to_panel(r) for r in rows]
    except Exception:
        logger.exception("Errore durante il listing dei pannelli")
        raise HTTPException(status_code=500, detail="Errore interno del server")


@router.delete("/{panel_id}", status_code=204, summary="Rimuovi pannello dal catalogo")
def delete_panel(panel_id: str) -> None:
    """Elimina un pannello dal catalogo tramite ID."""
    with get_db() as con:
        cur = con.execute("DELETE FROM panels WHERE id = ?", (panel_id,))
        con.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Pannello '{panel_id}' non trovato")


# ─── Confronto ───────────────────────────────────────────────


@router.post(
    "/compare",
    response_model=PanelComparisonResponse,
    summary="Confronta produzione stimata tra pannelli",
)
def compare_panels(req: PanelComparisonRequest) -> PanelComparisonResponse:
    """
    Calcola stime di produzione annuale per i pannelli specificati.
    """
    try:
        if not req.panel_ids:
            raise HTTPException(status_code=400, detail="Nessun pannello da confrontare")

        with get_db() as con:
            placeholders = ", ".join("?" * len(req.panel_ids))
            rows = con.execute(
                f"SELECT * FROM panels WHERE id IN ({placeholders})", req.panel_ids
            ).fetchall()

        panels_map = {r["id"]: _row_to_panel(r) for r in rows}
        missing = [pid for pid in req.panel_ids if pid not in panels_map]
        if missing:
            raise HTTPException(status_code=404, detail=f"Pannelli non trovati: {missing}")

        estimates = [
            _estimate_production(
                panels_map[pid], req.annual_irradiance_kwh_m2, req.avg_shadow_factor, req.roof_area_m2
            )
            for pid in req.panel_ids
        ]
        return PanelComparisonResponse(estimates=estimates)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Errore durante il confronto pannelli")
        raise HTTPException(status_code=500, detail="Errore interno del server")


# ─── Helper privato ──────────────────────────────────────────


def _estimate_production(
    panel: PanelRead,
    annual_irradiance: float,
    avg_shadow_factor: float,
    roof_area: float | None,
) -> PanelProductionEstimate:
    panel_area = panel.width_m * panel.height_m
    if panel_area <= 0:
        raise ValueError(f"Area pannello non valida ({panel.width_m} x {panel.height_m})")
    efficiency = panel.efficiency_pct / 100.0
    kwh_per_panel = efficiency * panel_area * annual_irradiance * avg_shadow_factor

    panels_fit = 0
    if roof_area and panel_area > 0:
        panels_fit = int(roof_area / (panel_area * 1.15))

    total_kwh = kwh_per_panel * panels_fit if panels_fit > 0 else kwh_per_panel
    total_kwp = (panel.power_w * (panels_fit or 1)) / 1000.0
    label = f"{panel.constructor} {panel.model}".strip()

    return PanelProductionEstimate(
        panel_id=panel.id,
        label=label,
        panels_fit=panels_fit,
        annual_kwh_per_panel=round(kwh_per_panel, 1),
        total_annual_kwh=round(total_kwh, 1),
        total_power_kwp=round(total_kwp, 2),
        degradation_pct=panel.degradation_pct,
        temp_coefficient=panel.temp_coefficient,
    )
