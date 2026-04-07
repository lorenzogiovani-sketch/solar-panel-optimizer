FROM python:3.11-slim

WORKDIR /app

# Installa dipendenze di sistema per trimesh, scipy e curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libspatialindex-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copia e installa dipendenze Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Crea utente non-root
RUN useradd -m appuser

# Copia il codice dell'applicazione
COPY . .

# Assicura che la directory data sia scrivibile
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

USER appuser

# Esponi la porta di FastAPI
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Avvia uvicorn (hot-reload gestito dal volume mount in docker-compose)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
