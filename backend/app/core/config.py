"""
Configurazione centrale dell'applicazione.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Impostazioni dell'applicazione, caricate da variabili d'ambiente."""

    # App
    APP_NAME: str = "SolarOptimizer3D"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173"

    # Calcoli
    SHADOW_GRID_RESOLUTION: int = 30

    # Raycasting
    RAYCASTING_WORKERS: int = 4
    RAYCASTING_CHUNK_SIZE: int = 500_000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
