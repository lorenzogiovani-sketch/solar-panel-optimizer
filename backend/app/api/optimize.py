import uuid
import time
import math
import logging
import traceback
from fastapi import APIRouter, HTTPException, BackgroundTasks

from app.models.optimization import (
    OptimizationRequest,
    OptimizationResult,
    OptimizationStatus,
)
from app.services.optimization_service import run_seed_and_grow

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory job storage (per MVP, nessun database)
_jobs: dict = {}

_JOB_TTL_SECONDS = 3600  # 1 ora


def _cleanup_stale_jobs():
    """Remove completed/errored jobs older than _JOB_TTL_SECONDS."""
    now = time.time()
    stale = [
        jid for jid, j in _jobs.items()
        if j["status"] in ("completed", "error")
        and now - j.get("start_time", now) > _JOB_TTL_SECONDS
    ]
    for jid in stale:
        del _jobs[jid]


# ---------------------------------------------------------------------------
# Background runner
# ---------------------------------------------------------------------------

def _compute_face_irradiances(request: OptimizationRequest) -> dict:
    """Calcola irradianza per-falda usando pvlib quando face_irradiances non è fornito."""
    from app.services.solar_service import calculate_irradiance
    from app.models.solar import IrradianceRequest, RoofSurface

    bg = request.building_geometry
    b_az = request.building_azimuth

    surfaces = []
    if bg.roof_type == 'gable' and bg.roof_angle > 0:
        surfaces = [
            RoofSurface(tilt=bg.roof_angle, azimuth=(b_az + 180) % 360, weight=0.5, face='south'),
            RoofSurface(tilt=bg.roof_angle, azimuth=b_az, weight=0.5, face='north'),
        ]
    elif bg.roof_type == 'hip' and bg.ridge_height > 0:
        half_d = bg.depth / 2
        half_w = bg.width / 2
        hrl = min(bg.ridge_length, bg.width) / 2
        slope_run_ew = half_w - hrl
        tilt_ns = math.degrees(math.atan2(bg.ridge_height, half_d))
        tilt_ew = math.degrees(math.atan2(bg.ridge_height, slope_run_ew)) if slope_run_ew > 0 else tilt_ns
        surfaces = [
            RoofSurface(tilt=tilt_ns, azimuth=(b_az + 180) % 360, weight=0.25, face='south'),
            RoofSurface(tilt=tilt_ns, azimuth=b_az, weight=0.25, face='north'),
            RoofSurface(tilt=tilt_ew, azimuth=((90 - b_az) % 360 + 360) % 360, weight=0.25, face='east'),
            RoofSurface(tilt=tilt_ew, azimuth=((270 - b_az) % 360 + 360) % 360, weight=0.25, face='west'),
        ]

    if not surfaces:
        return {}

    irr_request = IrradianceRequest(
        latitude=request.latitude,
        longitude=request.longitude,
        tilt=surfaces[0].tilt,
        azimuth=surfaces[0].azimuth,
        timezone=request.timezone,
        roof_surfaces=surfaces,
    )
    result = calculate_irradiance(irr_request)

    face_map = {}
    if result.per_surface:
        for s in result.per_surface:
            face_map[s.face] = s.annual_total
    return face_map


def _run_job(job_id: str, request: OptimizationRequest):
    """Esegue l'ottimizzazione in background e aggiorna _jobs."""
    try:
        def _on_progress(gen, total, best_fitness):
            _jobs[job_id].update({
                "current_generation": gen,
                "total_generations": total,
                "best_fitness": round(best_fitness, 1),
                "progress": round((gen / total) * 100, 1) if total > 0 else 0,
            })

        # Calcola SEMPRE face_irradiances via pvlib per tetti a falda,
        # ignorando eventuali valori stale inviati dal frontend.
        # Questo garantisce che l'azimut dell'edificio sia sempre rispettato.
        bg = request.building_geometry
        has_slope = (bg.roof_type == 'gable' and bg.roof_angle > 0) or \
                    (bg.roof_type == 'hip' and bg.ridge_height > 0)
        if has_slope and request.latitude is not None:
            logger.info(f"Job {job_id}: calcolo face_irradiances via pvlib per tetto {bg.roof_type} (azimuth={request.building_azimuth}°)")
            try:
                face_map = _compute_face_irradiances(request)
                if face_map:
                    request.face_irradiances = face_map
                    logger.info(f"Job {job_id}: face_irradiances calcolate: {face_map}")
            except Exception as e:
                logger.warning(f"Job {job_id}: fallback — errore calcolo pvlib: {e}")

        logger.info(f"Job {job_id}: avvio ottimizzazione (strategia=seed_and_grow)")
        result = run_seed_and_grow(request, progress_callback=_on_progress)

        _jobs[job_id].update({
            "status": "completed",
            "progress": 100.0,
            "result": result.model_dump(),
        })

        logger.info(
            f"Job {job_id}: completato — {result.total_panels} pannelli, "
            f"{result.total_energy_kwh} kWh/anno"
        )

    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Job {job_id}: errore durante l'ottimizzazione\n{tb}")
        _jobs[job_id].update({
            "status": "error",
            "error_message": "Errore durante l'ottimizzazione",
        })


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run", summary="Avvia ottimizzazione layout pannelli")
async def start_optimization(request: OptimizationRequest, background_tasks: BackgroundTasks):
    """
    Avvia l'ottimizzazione del layout pannelli con algoritmo Seed-and-Grow.
    L'ottimizzazione viene eseguita in background; utilizzare gli endpoint
    /status/{job_id} e /result/{job_id} per monitorare e recuperare i risultati.
    """
    _cleanup_stale_jobs()

    job_id = str(uuid.uuid4())

    _jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "progress": 0.0,
        "current_generation": 0,
        "total_generations": 100,
        "best_fitness": None,
        "error_message": None,
        "result": None,
        "start_time": time.time(),
    }

    background_tasks.add_task(_run_job, job_id, request)

    logger.info(f"Job {job_id}: creato, ottimizzazione in coda")
    return {"job_id": job_id, "status": "running"}


@router.get("/status/{job_id}", response_model=OptimizationStatus, summary="Stato ottimizzazione")
async def get_status(job_id: str):
    """Ritorna lo stato corrente dell'ottimizzazione (generazione, progresso, fitness)."""
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} non trovato")

    job = _jobs[job_id]

    elapsed = round(time.time() - job.get("start_time", time.time()), 1)
    estimated_remaining = None
    progress = job["progress"]
    if job["status"] == "running" and progress > 1:
        estimated_remaining = round(elapsed * (100 - progress) / progress, 1)

    return OptimizationStatus(
        job_id=job_id,
        status=job["status"],
        progress=progress,
        current_generation=job["current_generation"],
        total_generations=job["total_generations"],
        best_fitness=job["best_fitness"],
        error_message=job["error_message"],
        elapsed_time_s=elapsed,
        estimated_remaining_s=estimated_remaining,
    )


@router.get("/result/{job_id}", response_model=OptimizationResult, summary="Risultato ottimizzazione")
async def get_result(job_id: str):
    """Ritorna il layout ottimale una volta che l'ottimizzazione è completata."""
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} non trovato")

    job = _jobs[job_id]

    if job["status"] == "error":
        raise HTTPException(status_code=500, detail=job.get("error_message", "Errore sconosciuto"))

    if job["status"] != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Ottimizzazione non ancora completata (stato: {job['status']})"
        )

    return OptimizationResult(**job["result"])
