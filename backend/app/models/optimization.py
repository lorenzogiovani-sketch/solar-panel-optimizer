from pydantic import BaseModel, Field, model_validator
from typing import List, Literal, Optional, Dict, Any

from app.models.validators import normalize_polygons


class PanelSpecs(BaseModel):
    """Specifiche tecniche del pannello solare."""
    width: float = Field(default=1.0, gt=0, description="Larghezza pannello (m)")
    height: float = Field(default=1.7, gt=0, description="Altezza pannello (m)")
    power: float = Field(default=400, gt=0, description="Potenza nominale (W)")
    efficiency: float = Field(default=0.21, gt=0, le=0.5, description="Efficienza (0-0.5)")
    temp_coefficient: float = Field(default=-0.4, description="Coefficiente di temperatura Pmax (%/°C)")
    noct_temperature: float = Field(default=45.0, description="Temperatura NOCT (°C)")


class OptimizationConstraints(BaseModel):
    """Vincoli per l'ottimizzazione."""
    min_panels: int = Field(default=1, ge=1, description="Numero minimo di pannelli")
    max_panels: Optional[int] = Field(default=None, ge=1, description="Numero massimo di pannelli (calcolato da max_peak_power se omesso)")
    max_peak_power: Optional[float] = Field(default=None, gt=0, description="Potenza di picco massima ammessa (kWp). Se fornito, max_panels viene calcolato automaticamente.")
    min_distance: float = Field(default=0.1, ge=0, description="Distanza minima tra pannelli (m)")
    roof_margin: float = Field(default=0.3, ge=0, description="Margine dal bordo tetto (m)")
    allow_rotation: bool = Field(default=False, description="Consenti orientamento misto portrait/landscape")
    require_strings: bool = Field(default=False, description="Penalizza pannelli isolati (richiedi contiguità)")


class BuildingGeometry(BaseModel):
    """Geometria dell'edificio (parametrica o mesh)."""
    width: float = Field(default=12, gt=0, description="Larghezza edificio (m)")
    depth: float = Field(default=10, gt=0, description="Profondità edificio (m)")
    height: float = Field(default=6, gt=0, description="Altezza edificio (m)")
    roof_type: Literal["flat", "gable", "hip"] = Field(default="flat", description="Tipo tetto: flat, gable, hip")
    roof_angle: float = Field(default=0, ge=0, le=45, description="Angolo tetto (gradi)")
    ridge_height: float = Field(default=3, ge=0, description="Altezza colmo hip (m)")
    ridge_length: float = Field(default=8, ge=0, description="Lunghezza colmo hip (m)")


class OptimizationRequest(BaseModel):
    """Parametri per l'ottimizzazione del layout pannelli."""
    building_geometry: BuildingGeometry = Field(default_factory=BuildingGeometry)
    shadow_grid: Optional[List[List[float]]] = Field(
        default=None, description="Matrice NxN ombreggiatura (0=libero, 1=ombra)"
    )
    grid_bounds: Optional[Dict[str, float]] = Field(
        default=None, description="Bounds della griglia ombre (min_x, max_x, min_z, max_z). Se omesso, si usano building width/depth."
    )
    installation_polygon: Optional[list[dict]] = Field(default=None, description="[Deprecated] Singolo poligono, usa installation_polygons")
    installation_polygons: Optional[List[List[dict]]] = Field(default=None, description="Lista di poligoni installazione [[{x,z}, ...], ...]")
    obstacles: Optional[List[dict]] = Field(
        default=None,
        description="Lista ostacoli sul tetto. Ogni elemento: {type, position: [x,y,z], dimensions: [w,h,d]}"
    )
    panel_specs: PanelSpecs = Field(default_factory=PanelSpecs)
    constraints: OptimizationConstraints = Field(default_factory=OptimizationConstraints)
    annual_irradiance: float = Field(
        default=1700.0, gt=0,
        description="Irradianza annua POA di riferimento (kWh/m²)"
    )
    system_losses: float = Field(
        default=0.14, ge=0.0, le=0.5,
        description="Perdite totali di sistema BOS (0-0.5, default 14%)"
    )
    building_azimuth: float = Field(
        default=180.0, ge=0, le=360,
        description="Azimuth edificio (gradi, conv. pvlib: 0=N, 180=S)"
    )
    face_irradiances: Optional[Dict[str, float]] = Field(
        default=None,
        description="Irradianza annua per falda (kWh/m²): {'south': 1800, 'north': 900, ...}"
    )
    latitude: Optional[float] = Field(
        default=None, ge=-90, le=90,
        description="Latitudine del sito (per calcolo irradianza per-falda se face_irradiances manca)"
    )
    longitude: Optional[float] = Field(
        default=None, ge=-180, le=180,
        description="Longitudine del sito (per calcolo irradianza per-falda se face_irradiances manca)"
    )
    timezone: str = Field(
        default="Europe/Rome",
        description="Timezone del sito (per calcolo irradianza per-falda)"
    )
    strategy: Literal["seed_and_grow"] = Field(
        default="seed_and_grow",
        description="Strategia di ottimizzazione: 'seed_and_grow' (greedy compatto)"
    )

    @model_validator(mode='after')
    def _normalize_polygons(self):
        """Merge legacy installation_polygon into installation_polygons."""
        return normalize_polygons(self)


class PanelPosition(BaseModel):
    """Posizione di un singolo pannello ottimizzato."""
    x: float = Field(..., description="Coordinata X sul tetto (m)")
    y: float = Field(..., description="Coordinata Y sul tetto (m)")
    irradiance_factor: float = Field(
        default=1.0, ge=0, le=1,
        description="Fattore irradianza (1=pieno sole, 0=ombra totale)"
    )
    orientation: Literal["portrait", "landscape"] = Field(
        default="portrait",
        description="Orientamento pannello: 'portrait' o 'landscape'"
    )
    effective_tilt: Optional[float] = Field(
        None, description="Tilt effettivo della falda (gradi)"
    )
    effective_azimuth: Optional[float] = Field(
        None, description="Azimuth effettivo della falda (gradi, conv. pvlib)"
    )


class OptimizationResult(BaseModel):
    """Risultato dell'ottimizzazione."""
    panels: List[PanelPosition] = Field(..., description="Posizioni pannelli ottimizzate")
    total_panels: int = Field(..., description="Numero totale pannelli")
    total_power_kw: float = Field(..., description="Potenza totale installata (kWp)")
    total_energy_kwh: float = Field(..., description="Produzione annua stimata (kWh)")
    improvement_pct: float = Field(
        default=0, description="Miglioramento rispetto a layout uniforme (%)"
    )
    convergence_history: List[float] = Field(
        default=[], description="Miglior fitness per generazione"
    )
    best_fitness_per_generation: List[float] = Field(
        default=[], description="Fitness media per generazione"
    )


class OptimizationStatus(BaseModel):
    """Stato di avanzamento dell'ottimizzazione."""
    job_id: str
    status: str = Field(..., description="running | completed | error")
    progress: float = Field(default=0, ge=0, le=100, description="Progresso 0-100%")
    current_generation: Optional[int] = None
    total_generations: Optional[int] = None
    best_fitness: Optional[float] = None
    error_message: Optional[str] = None
    elapsed_time_s: Optional[float] = Field(default=None, description="Tempo trascorso dall'inizio (secondi)")
    estimated_remaining_s: Optional[float] = Field(default=None, description="Tempo stimato rimanente (secondi)")
