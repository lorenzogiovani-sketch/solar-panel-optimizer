import logging

from fastapi import APIRouter, HTTPException
from app.models.solar import (
    SunPathRequest, SunPathResponse,
    IrradianceRequest, IrradianceResponse,
    DailySimulationRequest, DailySimulationResponse,
    EconomicsRequest, EconomicsResponse,
)
from app.services.solar_service import calculate_sun_path, calculate_irradiance, calculate_daily_simulation, calculate_economics
from app.services.shadow_service import calculate_shadow_map
from app.models.shadow import ShadowRequest, ShadowResponse

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/shadows", response_model=ShadowResponse)
async def get_shadow_map(request: ShadowRequest):
    """
    Calcola la mappa delle ombreggiature sull'edificio.
    """
    try:
        return calculate_shadow_map(request)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Campo mancante: {e}")
    except Exception:
        logger.exception("Errore nel calcolo shadow map")
        raise HTTPException(status_code=500, detail="Errore interno del server")

@router.post("/sun-path", response_model=SunPathResponse, summary="Calcola il percorso solare")
async def get_sun_path(request: SunPathRequest):
    """
    Calcola la posizione del sole (azimuth, elevazione, zenith) per una data località
    e anno, con frequenza oraria.

    Restituisce solo i dati relativi alle ore diurne (elevazione > 0).
    """
    try:
        return calculate_sun_path(request)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Campo mancante: {e}")
    except Exception:
        logger.exception("Errore nel calcolo sun path")
        raise HTTPException(status_code=500, detail="Errore interno del server")

@router.post("/irradiance", response_model=IrradianceResponse, summary="Calcola l'irradianza solare")
async def get_irradiance(request: IrradianceRequest):
    """
    Calcola l'irradianza solare su un piano inclinato (POA) per una data località, anno,
    tilt e azimuth. Restituisce serie temporali e totali mensili/annuali.

    Usa dati clearsky e modello isotropic.
    """
    try:
        return calculate_irradiance(request)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Campo mancante: {e}")
    except Exception:
        logger.exception("Errore nel calcolo irradiance")
        raise HTTPException(status_code=500, detail="Errore interno del server")

@router.post("/daily-simulation", response_model=DailySimulationResponse, summary="Simulazione giornaliera produzione")
async def get_daily_simulation(request: DailySimulationRequest):
    """
    Simula la produzione energetica per un giorno intero (step 30 min).
    Calcola posizione solare, irradianza POA, ombre sui pannelli e potenza prodotta.
    """
    try:
        return calculate_daily_simulation(request)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Campo mancante: {e}")
    except Exception:
        logger.exception("Errore nella simulazione giornaliera")
        raise HTTPException(status_code=500, detail="Errore interno del server")

@router.post("/economics", response_model=EconomicsResponse, summary="Analisi economica autoconsumo vs cessione")
async def get_economics(request: EconomicsRequest):
    """
    Calcola l'analisi economica: autoconsumo, immissione in rete,
    risparmio in bolletta, ricavo cessione GSE e payback period.
    """
    try:
        return calculate_economics(request)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Campo mancante: {e}")
    except Exception:
        logger.exception("Errore nel calcolo economics")
        raise HTTPException(status_code=500, detail="Errore interno del server")
