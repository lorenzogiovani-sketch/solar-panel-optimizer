from datetime import datetime

from pydantic import BaseModel, Field, model_validator
from typing import List, Dict, Literal, Optional, Any

from app.models.validators import normalize_polygons

def _current_year() -> int:
    return datetime.now().year

class TreeObstacle(BaseModel):
    """Schema documentale dell'ostacolo-albero.

    Non applicato strettamente (il campo `ShadowRequest.obstacles` resta
    `List[Dict[str, Any]]` per retrocompatibilità), ma documenta i campi
    accettati dal ray-casting delle chiome.

    Vedi `app.services.vegetation` per il mapping forma → famiglia canonica
    (Tab. 6.2 riferimento).
    """
    type: Literal['tree'] = 'tree'
    treeShape: Optional[Literal['cone', 'sphere', 'umbrella', 'columnar']] = None
    tree_category: Optional[Literal['truncated_cone', 'ellipsoidal']] = Field(
        default=None,
        description="Famiglia canonica del riferimento; se None è derivata da treeShape.",
    )
    foliage_type: Literal['deciduous', 'evergreen'] = Field(
        default='deciduous',
        description="Tipo di fogliame per la selezione della colonna di Tab. 6.2.",
    )
    monthly_transmissivity_override: Optional[List[float]] = Field(
        default=None,
        description="12 valori mensili in [0,1]; se forniti, sovrascrivono la tabella normativa.",
    )


class ShadowRequest(BaseModel):
    building: Dict[str, Any] = Field(..., description="Geometria dell'edificio (vertices, faces)")
    obstacles: List[Dict[str, Any]] = Field(default=[], description="Lista di geometrie ostacoli (gli alberi seguono lo schema TreeObstacle)")
    latitude: float = Field(..., ge=-90, le=90, description="Latitudine")
    longitude: float = Field(..., ge=-180, le=180, description="Longitudine")
    year: int = Field(default_factory=_current_year, ge=1950, le=2100, description="Anno per la simulazione")
    grid_resolution: int = Field(50, ge=10, le=500, description="Risoluzione griglia (NxN)")
    timezone: str = Field("UTC", description="Timezone")
    azimuth: float = Field(180, description="Azimuth edificio in gradi (180=Sud)")
    model_rotation: float = Field(0, description="Rotazione manuale aggiuntiva del modello in gradi")
    model_offset_y: float = Field(0, description="Offset verticale del modello importato (metri)")
    installation_polygon: Optional[List[Dict[str, float]]] = Field(None, description="[Deprecated] Singolo poligono, usa installation_polygons")
    installation_polygons: Optional[List[List[Dict[str, float]]]] = Field(None, description="Lista di poligoni installazione")
    installation_plane_y: Optional[float] = Field(None, description="Quota Y del piano di installazione (override manuale, None = auto)")
    analysis_mode: Literal["annual", "monthly", "instant"] = Field("annual", description="Modalità analisi: 'annual' | 'monthly' | 'instant'")
    sky_model: Literal["isotropic", "brunger_hooper"] = Field(
        "isotropic",
        description="Modello di radianza diffusa: 'isotropic' (SVF classico) | 'brunger_hooper' (TCCD anisotropo, Eq. 4.45)",
    )
    diffuse_fraction_kd: float = Field(
        0.35, ge=0.0, le=1.0,
        description="Rapporto K_d = H_dh/H_gh usato dal modello Brunger-Hooper (default 0.35, tipico clima temperato)",
    )

    @model_validator(mode='after')
    def _normalize_polygons(self):
        return normalize_polygons(self)
    analysis_month: Optional[int] = Field(None, ge=1, le=12, description="Mese per analisi mensile/istantanea (1-12)")
    analysis_day: Optional[int] = Field(None, ge=1, le=31, description="Giorno per analisi istantanea (1-31)")
    analysis_hour: Optional[float] = Field(None, ge=0, lt=24, description="Ora per analisi istantanea (0-23, es. 14.5 = 14:30)")

class ShadowResponse(BaseModel):
    shadow_grid: List[List[float]] = Field(..., description="Matrice NxN con valori 0.0-1.0 (percentuale ombra annuale)")
    grid_bounds: Dict[str, float] = Field(..., description="Limiti della griglia (min_x, min_z, max_x, max_z)")
    monthly_shadows: Dict[str, float] = Field(..., description="Ombreggiatura media per mese")
    statistics: Dict[str, float] = Field(..., description="Statistiche (es. % area libera)")
    computation_time_s: Optional[float] = Field(default=None, description="Tempo di calcolo backend (secondi)")
    annual_shading_pct: Optional[float] = Field(
        default=None,
        description="F_s,m annuale (0-100%). Step 10: popolato con il valore energy-weighted (Eq. 4.46).",
    )
    annual_shading_pct_energy_weighted: Optional[float] = Field(
        default=None,
        description="F_s,m annuale pesato energeticamente su beam/diffuse/reflected (0-100%, UNI/TS 11300-1).",
    )
    annual_shading_pct_time_avg: Optional[float] = Field(
        default=None,
        description="F_s,m annuale media aritmetica temporale (0-100%, legacy/debug).",
    )
    monthly_shading_pct: Optional[Dict[str, float]] = Field(
        default=None,
        description="F_s,m per mese (chiavi '1'..'12', 0-100%). Step 10: energy-weighted come primario.",
    )
    monthly_shading_pct_energy_weighted: Optional[Dict[str, float]] = Field(
        default=None,
        description="F_s,m mensile pesato energeticamente (chiavi '1'..'12', 0-100%).",
    )
    monthly_shading_pct_time_avg: Optional[Dict[str, float]] = Field(
        default=None,
        description="F_s,m mensile media aritmetica temporale (chiavi '1'..'12', 0-100%, legacy).",
    )
