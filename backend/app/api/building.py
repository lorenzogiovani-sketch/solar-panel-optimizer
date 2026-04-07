import logging

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.building_service import process_3d_file

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

@router.post("/upload", summary="Carica un modello 3D (OBJ, STL)")
async def upload_model(
    file: UploadFile = File(...),
    axis_correction: str = Form("auto"),
):
    """
    Carica un file 3D e restituisce i dati della mesh processati (vertices, faces).
    Supporta: .obj, .stl
    axis_correction: 'auto' applica conversione Z-up → Y-up, 'none' lascia invariato.
    """
    if not file.filename.lower().endswith(('.obj', '.stl')):
        raise HTTPException(status_code=400, detail="Formato file non supportato. Usa .obj o .stl")

    try:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File troppo grande. Dimensione massima: 50 MB")
        mesh_data = process_3d_file(content, file.filename, axis_correction=axis_correction)
        return mesh_data
    except HTTPException:
        raise
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Parametri non validi: {e}")
    except Exception:
        logger.exception("Errore durante il processamento del file 3D")
        raise HTTPException(status_code=500, detail="Errore interno del server")
