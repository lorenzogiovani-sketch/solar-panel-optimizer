import io
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.export import ExportRequest, HourlyCsvRequest
from app.services.export_service import generate_csv, generate_hourly_csv, generate_pdf

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/csv")
async def export_csv(request: ExportRequest):
    """Esporta i risultati della simulazione in formato CSV."""
    try:
        payload = {
            **request.simulation_results.model_dump(),
            **request.project_info.model_dump(),
            "inverter_specs": request.inverter_specs.model_dump() if request.inverter_specs else None,
            "stringing": request.stringing.model_dump() if request.stringing else None,
            "economic": request.economic.model_dump() if request.economic else None,
        }

        csv_content = generate_csv(payload)
        filename = f"solar_report_{datetime.now().strftime('%Y%m%d')}.csv"

        return StreamingResponse(
            iter([csv_content]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore durante l'export CSV")
        raise HTTPException(status_code=500, detail="Errore interno del server")


@router.post("/csv-hourly")
async def export_csv_hourly(request: HourlyCsvRequest):
    """Esporta i dati orari annuali (8760 righe) in formato CSV."""
    try:
        csv_content = generate_hourly_csv(request.model_dump())
        filename = f"solar_hourly_{datetime.now().strftime('%Y%m%d')}.csv"

        return StreamingResponse(
            iter([csv_content]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore durante l'export CSV orario")
        raise HTTPException(status_code=500, detail="Errore interno del server")


@router.post("/pdf")
async def export_pdf(request: ExportRequest):
    """Genera un report PDF dei risultati della simulazione."""
    try:
        sim_data = request.simulation_results.model_dump()
        proj_data = request.project_info.model_dump()

        extra = {
            "monthly_irradiance": request.monthly_irradiance,
            "panel_specs": request.panel_specs.model_dump() if request.panel_specs else None,
            "panels_layout": [p.model_dump() for p in request.panels_layout] if request.panels_layout else None,
            "kpi": request.kpi.model_dump() if request.kpi else None,
            "building_width": request.building_width,
            "building_depth": request.building_depth,
            "economic": request.economic.model_dump() if request.economic else None,
            "inverter_specs": request.inverter_specs.model_dump() if request.inverter_specs else None,
            "stringing": request.stringing.model_dump() if request.stringing else None,
            "building_info": request.building_info.model_dump() if request.building_info else None,
            "obstacles": [o.model_dump() for o in request.obstacles] if request.obstacles else None,
        }

        pdf_bytes = generate_pdf(sim_data, proj_data, extra)
        filename = f"solar_report_{datetime.now().strftime('%Y%m%d')}.pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore durante l'export PDF")
        raise HTTPException(status_code=500, detail="Errore interno del server")
