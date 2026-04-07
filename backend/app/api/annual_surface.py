import uuid
import time
import logging
import traceback

from fastapi import APIRouter, HTTPException, BackgroundTasks

from app.models.annual_surface import AnnualSurfaceRequest, AnnualSurfaceResponse
from app.services.annual_surface_service import compute_annual_surface

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory job storage
_jobs: dict = {}
_JOB_TTL_SECONDS = 3600


def _cleanup_stale_jobs():
    now = time.time()
    stale = [
        jid for jid, j in _jobs.items()
        if j["status"] in ("completed", "error")
        and now - j.get("start_time", now) > _JOB_TTL_SECONDS
    ]
    for jid in stale:
        del _jobs[jid]


def _run_job(job_id: str, request: AnnualSurfaceRequest):
    try:
        logger.info(f"AnnualSurface job {job_id}: avvio calcolo")
        result = compute_annual_surface(request)
        _jobs[job_id].update({
            "status": "completed",
            "result": result.model_dump(),
        })
        logger.info(f"AnnualSurface job {job_id}: completato in {result.computation_time_s}s")
    except Exception:
        tb = traceback.format_exc()
        logger.error(f"AnnualSurface job {job_id}: errore\n{tb}")
        _jobs[job_id].update({
            "status": "error",
            "error_message": "Errore durante il calcolo della superficie annuale",
        })


@router.post("/run", summary="Avvia calcolo superficie annuale potenza 3D")
async def start_annual_surface(request: AnnualSurfaceRequest, background_tasks: BackgroundTasks):
    _cleanup_stale_jobs()
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "error_message": None,
        "result": None,
        "start_time": time.time(),
    }
    background_tasks.add_task(_run_job, job_id, request)
    return {"job_id": job_id, "status": "running"}


@router.get("/status/{job_id}", summary="Stato calcolo superficie annuale")
async def get_status(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} non trovato")
    job = _jobs[job_id]
    elapsed = round(time.time() - job.get("start_time", time.time()), 1)
    return {
        "job_id": job_id,
        "status": job["status"],
        "elapsed_time_s": elapsed,
        "error_message": job.get("error_message"),
    }


@router.get("/result/{job_id}", summary="Risultato superficie annuale")
async def get_result(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} non trovato")
    job = _jobs[job_id]
    if job["status"] == "error":
        raise HTTPException(status_code=500, detail=job.get("error_message", "Errore sconosciuto"))
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Calcolo non ancora completato (stato: {job['status']})")
    return job["result"]
