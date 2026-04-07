from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import solar, building, optimize, export, panels, inverters, stringing, annual_surface
from app.core.config import settings
from app.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: initialize SQLite database."""
    init_db()
    yield


app = FastAPI(
    title="SolarOptimizer3D API",
    description="API per simulazione fotovoltaica con modellazione 3D e ottimizzazione",
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ─── CORS ─────────────────────────────────────────────────────
origins = settings.CORS_ORIGINS.split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ─── Routers ──────────────────────────────────────────────────
app.include_router(solar.router, prefix="/api/v1/solar", tags=["Solar"])
app.include_router(building.router, prefix="/api/v1/building", tags=["Building"])
app.include_router(optimize.router, prefix="/api/v1/optimize", tags=["Optimization"])
app.include_router(export.router, prefix="/api/v1/export", tags=["Export"])
app.include_router(panels.router, prefix="/api/v1/panels", tags=["Panels"])
app.include_router(inverters.router, prefix="/api/v1/inverters", tags=["Inverters"])
app.include_router(stringing.router, prefix="/api/v1/stringing", tags=["Stringing"])
app.include_router(annual_surface.router, prefix="/api/v1/annual-surface", tags=["Annual Surface"])


# ─── Health Check ─────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health_check():
    """Verifica che il servizio sia attivo."""
    return {"status": "ok", "service": "SolarOptimizer3D"}


@app.get("/", tags=["Health"])
async def root():
    return {
        "message": "SolarOptimizer3D API",
        "docs": "/docs",
        "health": "/health",
    }
