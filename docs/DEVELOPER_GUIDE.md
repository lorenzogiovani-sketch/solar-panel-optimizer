# Guida Sviluppatori SolarOptimizer3D

Questa guida copre il setup dell'ambiente di sviluppo, il testing, le convenzioni del codice e i pattern architetturali del progetto.

---

## 1. Setup dell'Ambiente Locale

### 1.1 Con Docker (Raccomandato)

Il modo piu rapido per avviare l'intero stack:

```bash
docker compose up --build
```

- **Frontend:** http://localhost:5173 (Vite con HMR)
- **Backend API:** http://localhost:8000 (Uvicorn con reload)
- **Swagger UI:** http://localhost:8000/docs

I volumi in `docker-compose.yml` abilitano il live reload:

- `./backend/app:/app/app` → Uvicorn rileva automaticamente le modifiche
- `./frontend/src:/app/src` → Vite HMR aggiorna il browser in tempo reale

### 1.2 Senza Docker

#### Backend (FastAPI)

Prerequisito: `Python >= 3.11`

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Il parametro `--reload` riavvia automaticamente il server quando vengono modificati file Python.

**Dipendenze chiave:**

- `pvlib` — Calcoli posizione solare e irradianza
- `trimesh` + `embreex` — Mesh 3D e ray-casting accelerato
- `scipy` — Calcoli scientifici
- `reportlab` — Generazione PDF
- `pandas` + `numpy` — Manipolazione dati
- `pydantic-settings` — Configurazione tipizzata

#### Frontend (Vite + React)

Prerequisito: `Node >= 18`

```bash
cd frontend
npm install
npm run dev
```

Vite avvia il dev server con HMR su http://localhost:5173.

**Dipendenze chiave:**

- `@react-three/fiber` + `@react-three/drei` + `three` — Scena 3D
- `zustand` — State management
- `recharts` — Grafici
- `lucide-react` — Icone
- `i18next` + `react-i18next` — Internazionalizzazione (IT/EN)
- `tailwindcss` — Utility CSS

### 1.3 Variabili d'Ambiente

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `DB_PATH` | `backend/data/panels.db` | Percorso database SQLite (pannelli + inverter) |
| `CORS_ORIGINS` | `http://localhost:5173` | Origini CORS consentite |
| `DEBUG` | `true` | Modalita debug |
| `VITE_API_URL` | `http://localhost:8000` | URL backend (usato nel frontend Docker) |

Configurabili via file `.env` nella root del backend o come variabili d'ambiente.

---

## 2. Testing

### 2.1 Backend (pytest)

L'ambiente di test utilizza `pytest` con il plugin `pytest-asyncio` per i test asincroni.

```bash
cd backend

# Esecuzione completa
pytest tests/ -v

# Test specifico
pytest tests/test_solar.py -v

# Con coverage
pytest tests/ -v --cov=app --cov-report=term-missing
```

#### Fixture Base

```python
# tests/conftest.py
@pytest.fixture
async def async_client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as client:
        yield client
```

#### Esempio di Test

```python
@pytest.mark.asyncio
async def test_sun_path_rome(async_client):
    response = await async_client.post("/api/v1/solar/sun-path", json={
        "latitude": 41.9028,
        "longitude": 12.4964,
        "timezone": "Europe/Rome",
        "year": 2024
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data["azimuth"]) > 0
    assert all(e > 0 for e in data["elevation"])
```

#### Test Disponibili

- `tests/test_solar.py` — Test endpoint solari (sun path, irradianza, daily simulation)
- `tests/test_optimization.py` — Test algoritmo Seed-and-Grow
- `tests/test_functional.py` — Test funzionali end-to-end

**Regola:** Se viene modificato un calcolo in un service, aggiungere almeno un test corrispondente.

### 2.2 Frontend

```bash
cd frontend
npm run build      # Build di produzione (verifica errori di compilazione)
npm run preview    # Preview della build
```

---

## 3. Architettura del Codice

### 3.1 Pattern Backend: Model-Service-Router

```
Request HTTP
    ↓
Router (api/*.py)      ← Validazione input, routing
    ↓
Service (services/*.py) ← Logica di business, calcoli
    ↓
Model (models/*.py)     ← Pydantic: serializzazione I/O
```

- I **Router** sono sottili: ricevono il request, chiamano il service, restituiscono la response
- I **Service** contengono tutta la logica: calcoli pvlib, ray-casting, ottimizzazione, stringing
- I **Model** definiscono contratti tipizzati tra frontend e backend

**7 Router registrati in `main.py`:**

| Router | Prefisso | Funzione |
| --- | --- | --- |
| `solar` | `/api/v1/solar` | Sun path, irradianza, ombre, simulazione giornaliera, economics |
| `building` | `/api/v1/building` | Upload modelli 3D (OBJ/STL) |
| `optimize` | `/api/v1/optimize` | Ottimizzazione layout (async polling) |
| `export` | `/api/v1/export` | Export CSV, CSV orario, PDF multi-pagina |
| `panels` | `/api/v1/panels` | CRUD catalogo pannelli |
| `inverters` | `/api/v1/inverters` | CRUD catalogo inverter |
| `stringing` | `/api/v1/stringing` | Dimensionamento stringhe serie/parallelo |

### 3.2 Pattern Frontend: Store-Driven

```
User Action → Store Action (Zustand) → API Call → State Update → Component Re-render
```

Lo store Zustand in `useStore.js` e suddiviso in slice:

| Slice | Responsabilita |
| --- | --- |
| `ui` | Tab attivo, card espansa, modalita misura, modale info, modale progetti |
| `project` | Coordinate, tilt, azimut, timezone |
| `building` | Geometria edificio, ostacoli, mesh importata, zone, offset verticale |
| `solar` | Sun path, irradianza, shadow grid |
| `dailySimulation` | Dati simulazione giornaliera, playback |
| `panels` | Catalogo pannelli, selezione, confronto, multi-risultati |
| `inverters` | Catalogo inverter, selezione |
| `stringing` | Modalita (auto/manual), temperature sito, risultato dimensionamento |
| `optimization` | Layout pannelli, job asincrono, risultati, zone installazione |

**Best practice:** Usare selettori granulari per evitare re-render inutili:

```javascript
// Corretto: re-render solo quando cambia building.width
const width = useStore((s) => s.building.width);

// Da evitare: re-render ad ogni cambio di stato
const state = useStore();
```

### 3.3 Pattern UI: Glass Card

Le card flottanti utilizzano il componente `FlashCard.jsx`:

- Header compatto (48px) sempre visibile
- Body espandibile con animazione
- Effetto glassmorphism (`backdrop-filter: blur(20px)`)
- Accento colorato per dominio

### 3.4 Internazionalizzazione (i18n)

Il sistema i18n utilizza `i18next` + `react-i18next` con supporto per due lingue:

- **IT** — Italiano (default)
- **EN** — Inglese

Il toggle lingua e posizionato nella Navbar. Le traduzioni coprono tutti i testi della UI.

### 3.5 Salvataggio Progetti

I progetti vengono salvati/caricati via `localStorage`:

- `saveProject(name)` — Serializza lo stato dello store
- `loadProject(name)` — Ripristina lo stato completo
- `deleteProject(name)` — Rimuove il progetto salvato

La gestione avviene tramite il `ProjectsModal` nella Navbar.

---

## 4. Aggiungere un Nuovo Endpoint API

Procedura standard per aggiungere funzionalita:

### Step 1: Definire i Modelli Pydantic

```python
# backend/app/models/nuovo_modulo.py
from pydantic import BaseModel

class NuovoRequest(BaseModel):
    parametro: float
    opzionale: str = "default"

class NuovoResponse(BaseModel):
    risultato: float
    dettagli: dict
```

### Step 2: Implementare la Logica nel Service

```python
# backend/app/services/nuovo_service.py
from app.models.nuovo_modulo import NuovoRequest, NuovoResponse

def calcola_nuovo(request: NuovoRequest) -> NuovoResponse:
    # Logica di business
    risultato = request.parametro * 2
    return NuovoResponse(risultato=risultato, dettagli={})
```

### Step 3: Creare la Route

```python
# backend/app/api/nuovo.py
from fastapi import APIRouter
from app.models.nuovo_modulo import NuovoRequest, NuovoResponse
from app.services.nuovo_service import calcola_nuovo

router = APIRouter()

@router.post("/calcola", response_model=NuovoResponse)
async def endpoint_calcola(request: NuovoRequest):
    return calcola_nuovo(request)
```

### Step 4: Registrare il Router

```python
# backend/app/main.py
from app.api.nuovo import router as nuovo_router
app.include_router(nuovo_router, prefix="/api/v1/nuovo", tags=["nuovo"])
```

### Step 5: Aggiungere il Metodo API nel Frontend

```javascript
// frontend/src/utils/api.js
nuovo: {
    calcola: (params) => request('/nuovo/calcola', { method: 'POST', body: params }),
},
```

### Step 6: Aggiungere l'Action nello Store (se necessario)

```javascript
// frontend/src/store/useStore.js
fetchNuovoCalcolo: async () => {
    set((state) => ({ nuovo: { ...state.nuovo, isLoading: true } }));
    try {
        const data = await api.nuovo.calcola({ parametro: 42 });
        set((state) => ({ nuovo: { ...state.nuovo, data, isLoading: false } }));
    } catch (error) {
        set((state) => ({ nuovo: { ...state.nuovo, error: error.message, isLoading: false } }));
    }
},
```

### Step 7: Scrivere il Test

```python
# backend/tests/test_nuovo.py
@pytest.mark.asyncio
async def test_calcola_nuovo(async_client):
    response = await async_client.post("/api/v1/nuovo/calcola", json={"parametro": 5.0})
    assert response.status_code == 200
    assert response.json()["risultato"] == 10.0
```

### Esempio Reale: Pattern CRUD (Inverter)

Il catalogo inverter segue lo stesso pattern del catalogo pannelli:

```
models/inverter.py → db.py (tabella inverters) → api/inverters.py → main.py → api.js → useStore.js
```

1. `InverterCreate` / `InverterRead` — Modelli Pydantic con 13 campi (MPPT, tensioni, correnti)
2. `db.py` — Tabella `inverters` creata in `init_db()`, query SQL raw
3. `api/inverters.py` — CRUD: POST `/`, GET `/`, DELETE `/{id}`
4. `main.py` — `app.include_router(inverters_router, prefix="/api/v1/inverters")`
5. `api.js` — `inverters: { list, create, delete }`
6. `useStore.js` — Slice `inverters: { datasheets, selectedId }`

---

## 5. Database (SQLite)

Il database SQLite (`backend/data/panels.db`) gestisce due tabelle:

### Tabella `panels`

18 campi totali:

- Base: `id`, `constructor`, `model`, `power_w`, `efficiency_pct`, `width_m`, `height_m`, `weight_kg`, `op_temperature_c`, `temp_coefficient`, `warranty_years`, `degradation_pct`
- Elettrici: `voc_v`, `isc_a`, `vmpp_v`, `impp_a`, `temp_coeff_voc`, `temp_coeff_isc`

### Tabella `inverters`

13 campi: `id`, `constructor`, `model`, `power_kw`, `max_dc_power_kw`, `mppt_channels`, `mppt_voltage_min_v`, `mppt_voltage_max_v`, `max_input_voltage_v`, `max_input_current_a`, `efficiency_pct`, `weight_kg`, `warranty_years`

### Note

- **Inizializzazione:** Automatica al startup via `lifespan` hook in `main.py` → `init_db()`
- **Migrazioni:** Idempotenti — `ALTER TABLE ADD COLUMN` con gestione errore se la colonna esiste gia
- **Accesso:** `get_db()` restituisce un context manager con `Row` factory abilitata
- **Nessun ORM:** Tutte le query sono SQL raw via `sqlite3` stdlib

---

## 6. Convenzioni

### 6.1 Commit

Seguire [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat:     nuova funzionalita
fix:      correzione bug
docs:     solo documentazione
refactor: refactoring senza cambi funzionali
test:     aggiunta/modifica test
```

Esempio: `feat: add seed-and-grow optimization algorithm`

### 6.2 Code Style

**Backend (Python):**

- Type hints obbligatori su tutti i parametri e return type delle funzioni pubbliche
- Modelli Pydantic per tutti i contratti API
- Docstring per le funzioni di servizio complesse

**Frontend (JavaScript/JSX):**

- Componenti React come funzioni (no classi)
- Selettori Zustand granulari
- `fetch` API nativa (no librerie HTTP esterne)
- Testi UI tramite `useTranslation()` hook (i18next)

### 6.3 Design Tokens

I colori e gli stili sono centralizzati in `frontend/src/styles/tokens.css`:

| Token | Valore | Utilizzo |
| --- | --- | --- |
| `--bg` | `#080C14` | Sfondo principale |
| `--blue` | `#4F9CF9` | Accento modello |
| `--solar` | `#FFB547` | Accento simulazione |
| `--teal` | `#2DD4BF` | Accento ottimizzazione |
| `--violet` | `#A78BFA` | Accento risultati |
| `--red` | `#F87171` | Errori e collisioni |

---

## 7. Risoluzione Problemi

### Il backend non si avvia

- Verificare che Python >= 3.11 sia installato
- Verificare che tutte le dipendenze siano installate: `pip install -r requirements.txt`
- Controllare che la porta 8000 non sia gia in uso

### Il frontend non si connette al backend

- Verificare che il backend sia in esecuzione sulla porta 8000
- Controllare le origini CORS in `backend/app/core/config.py`
- In Docker, assicurarsi che entrambi i container siano nella stessa rete

### Il calcolo delle ombre e molto lento

- Ridurre la risoluzione della griglia (usare "bassa" = 30x30 per test rapidi)
- Ridurre il numero di ostacoli nella scena
- Per analisi annuali, il sistema campiona 12 giorni rappresentativi per ottimizzare i tempi

### L'ottimizzazione non produce risultati

- Verificare che le ombre siano state calcolate (prerequisito)
- Controllare che la potenza massima (kWp) sia sufficiente per almeno un pannello
- Se sono definite zone di installazione, verificare che siano abbastanza grandi per contenere i pannelli

### Il dimensionamento stringhe fallisce

- Verificare che il pannello selezionato abbia i parametri elettrici (Voc, Isc, Vmpp, Impp)
- Verificare che sia stato selezionato un inverter dal catalogo
- Controllare che le temperature del sito (T_min, T_max) siano realistiche
