import logging

from fastapi import APIRouter, HTTPException

from app.models.stringing import StringingRequest, StringingResponse
from app.services.stringing_service import calculate_stringing

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/calculate",
    response_model=StringingResponse,
    summary="Dimensionamento stringhe fotovoltaiche",
)
def stringing_calculate(req: StringingRequest) -> StringingResponse:
    """Calcola la configurazione serie/parallelo ottimale (auto) o verifica una configurazione manuale."""
    try:
        return calculate_stringing(req)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore nel calcolo dimensionamento stringhe")
        raise HTTPException(status_code=500, detail="Errore interno del server")
