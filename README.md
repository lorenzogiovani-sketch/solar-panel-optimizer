# SolarOptimizer3D

> Applicazione web per l'ottimizzazione del posizionamento di pannelli fotovoltaici con modellazione 3D, simulazione solare, analisi energetica e dimensionamento elettrico.

[![License: Source Available](https://img.shields.io/badge/License-Source%20Available-orange.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](#-quick-start)
[![Python](https://img.shields.io/badge/Python-3.11-green.svg)](backend/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](frontend/)

https://github.com/user-attachments/assets/efd9dbb8-692b-45b0-9695-f790e6d2e10d

---

## Panoramica

SolarOptimizer3D permette di:

1. **Modellare edifici in 3D** — costruzione parametrica (piano, a falde, a padiglione) o importazione OBJ/STL con selezione e rimozione facce
2. **Simulare il percorso solare** — heatmap di ombreggiamento via ray-casting con trasmissivita stagionale degli alberi (4 forme di chioma)
3. **Ottimizzare il layout fotovoltaico** — algoritmo Seed-and-Grow greedy con espansione BFS, selezione automatica orientamento e zone di installazione poligonali
4. **Dimensionare l'impianto elettrico** — catalogo inverter, dimensionamento stringhe auto/manuale con verifica MPPT
5. **Analizzare la produzione** — simulazione giornaliera con modello termico NOCT, confronto multi-pannello, analisi economica con autoconsumo
6. **Esportare i risultati** — report PDF multi-pagina, CSV riepilogativo, CSV orario annuale (8760 righe)
7. **Gestire cataloghi componenti** — database SQLite per pannelli (con parametri elettrici Voc/Isc/Vmpp/Impp) e inverter
8. **Salvare e caricare progetti** — persistenza in localStorage con gestione multi-progetto

---

## Disclaimer

> **Attenzione:** I risultati prodotti da SolarOptimizer3D (irradianza, produzione energetica, ombreggiamento, dimensionamento elettrico, analisi economica) sono **stime basate su modelli matematici semplificati** e librerie open source di terze parti. Non costituiscono calcoli ingegneristici certificati e **non sostituiscono la consulenza di un professionista abilitato**. Verificare sempre i risultati prima di prendere decisioni progettuali o economiche. Vedi [LICENSE](LICENSE) per il disclaimer completo.

Le dipendenze di calcolo (pvlib, trimesh, scipy, embreex) utilizzano licenze open source permissive (BSD-3, MIT, Apache 2.0). Per i dettagli, vedi la colonna "Licenza" nella sezione [Stack Tecnologico](#stack-tecnologico).

---

## Prerequisiti

| Requisito | Versione minima | Note |
| --- | --- | --- |
| [Git](https://git-scm.com/) | 2.x | Per clonare il repository |
| [Python](https://www.python.org/downloads/) | 3.11 | Backend FastAPI |
| [Node.js](https://nodejs.org/) | 18 | Frontend React + Vite |
| [npm](https://www.npmjs.com/) | 9 | Gestore pacchetti frontend |
| [Docker](https://www.docker.com/) + Compose V2 | 24 | **Opzionale** — metodo di installazione raccomandato |

---

## Quick Start (Docker — raccomandato)

Assicurarsi che Docker sia in esecuzione (`docker info`), poi:

```bash
git clone https://github.com/lorenzogiovani/solar-optimizer.git
cd solar-optimizer
docker compose up --build
```

| Servizio | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/docs |

---

## Installazione manuale (senza Docker)

### 1. Clonare il repository

```bash
git clone https://github.com/lorenzogiovani/solar-optimizer.git
cd solar-optimizer
```

### 2. Backend (terminale 1)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Linux/macOS
# .venv\Scripts\activate         # Windows (PowerShell)
pip install -r requirements.txt
mkdir -p data                    # Il database SQLite viene creato qui al primo avvio
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Frontend (terminale 2)

```bash
cd frontend
npm install
npm run dev
```

### 4. Verifica

- Aprire http://localhost:5173 → deve mostrare la scena 3D con il modello parametrico
- Aprire http://localhost:8000/docs → deve mostrare la documentazione Swagger
- Test rapido API: `curl http://localhost:8000/api/v1/panels` → deve restituire `[]`

---

## Variabili d'Ambiente

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `DB_PATH` | `backend/data/panels.db` | Percorso database SQLite (pannelli + inverter) |
| `CORS_ORIGINS` | `http://localhost:5173` | Origini CORS consentite |

---

## Troubleshooting

| Problema | Soluzione |
| --- | --- |
| `embreex` non si compila | Installare gli strumenti di build C: `xcode-select --install` (macOS), `sudo apt install build-essential` (Ubuntu/Debian), Visual Studio Build Tools (Windows) |
| Porta 5173 o 8000 già occupata | Cambiare porta: `uvicorn app.main:app --port 8001` per il backend, `npx vite --port 5174` per il frontend |
| Errore CORS nel browser | Verificare che `CORS_ORIGINS` includa l'URL del frontend (default: `http://localhost:5173`) |
| Docker: `Cannot connect to the Docker daemon` | Avviare Docker Desktop (macOS/Windows) o il servizio `sudo systemctl start docker` (Linux) |
| `ModuleNotFoundError: No module named 'app'` | Assicurarsi di avviare uvicorn dalla cartella `backend/`, non dalla root del progetto |
| Il database non viene creato | Verificare che la cartella `data/` esista e sia scrivibile (`mkdir -p backend/data`) |

---

## Documentazione

| Documento | Contenuto |
| --- | --- |
| [Modelli Fisici (PHYSICS.md)](docs/PHYSICS.md) | Equazioni solari, irradianza POA, ray-casting ombre, modello termico NOCT, Seed-and-Grow, dimensionamento stringhe, analisi economica |
| [Architettura (ARCHITECTURE.md)](docs/ARCHITECTURE.md) | Stack tecnologico, layer backend/frontend, flusso dati, sistemi di coordinate |
| [API Reference (API_REFERENCE.md)](docs/API_REFERENCE.md) | Endpoint REST con esempi, request/response, pattern di comunicazione |
| [Guida Utente (USER_GUIDE.md)](docs/USER_GUIDE.md) | Flusso di lavoro in 8 step, configurazione, interpretazione risultati |
| [Guida Sviluppatore (DEVELOPER_GUIDE.md)](docs/DEVELOPER_GUIDE.md) | Setup ambiente, testing, convenzioni, pattern architetturali, i18n |

---

## Struttura del Progetto

```text
solar-optimizer/
├── frontend/                  # React 18 + Vite + Three.js
│   └── src/
│       ├── components/
│       │   ├── 3d/            # Scene3D, Building, ShadowHeatmap, SolarPanel, MeasureTool, ...
│       │   ├── cards/         # ModelCard, SimulationCard, OptimizationCard, StringingCard, ResultsCard
│       │   ├── layout/        # MainContent, Navbar, SceneHUD, ComputationTimer
│       │   ├── dashboard/     # Grafici Recharts, metriche, export
│       │   └── optimization/  # Form pannelli, confronto, progress
│       ├── store/useStore.js  # Zustand store globale (9 slice)
│       ├── i18n/              # Internazionalizzazione IT/EN (i18next)
│       ├── utils/             # API client, coordinate, geometria tetti
│       └── styles/tokens.css  # Design tokens (palette scura, glassmorphism)
├── backend/                   # FastAPI + Python 3.11
│   ├── app/
│   │   ├── api/               # 7 router: solar, building, optimize, panels, inverters, stringing, export
│   │   ├── services/          # pvlib, trimesh ray-casting, Seed-and-Grow, stringing, economics, ReportLab
│   │   ├── models/            # Pydantic request/response
│   │   ├── db.py              # SQLite (stdlib sqlite3)
│   │   └── main.py            # FastAPI app, CORS, lifespan
│   ├── tests/                 # pytest + pytest-asyncio
│   └── data/panels.db         # Database catalogo pannelli e inverter
├── docs/                      # Documentazione completa
└── docker-compose.yml
```

---

## Stack Tecnologico

| Layer | Tecnologia | Ruolo | Licenza |
| --- | --- | --- | --- |
| Frontend | React 18 + Vite | SPA con HMR | MIT |
| 3D Engine | Three.js + React Three Fiber | Rendering 3D interattivo | MIT |
| State | Zustand | Store globale reattivo (9 slice) | MIT |
| Grafici | Recharts | Visualizzazione dati energetici | MIT |
| i18n | i18next + react-i18next | Interfaccia bilingue IT/EN | MIT |
| Styling | Tailwind CSS + design tokens | Palette scura con glassmorphism | MIT |
| Backend | FastAPI (Python 3.11) | API REST asincrona con Swagger | MIT |
| Solar | pvlib-python | Posizione solare, irradianza, modello Perez | BSD-3 |
| 3D Processing | trimesh + embreex | Ray-casting ombre accelerato, processamento mesh | MIT / Apache 2.0 |
| Optimization | Seed-and-Grow (custom) | Layout greedy con espansione BFS | — |
| Report | ReportLab | Generazione PDF multi-pagina | BSD |
| Database | SQLite (stdlib) | Catalogo pannelli e inverter | Public Domain |
| Deploy | Docker Compose | Orchestrazione container | Apache 2.0 |

---

## Funzionalita Principali

### Modellazione 3D

- **3 tipi di tetto:** Piano (flat), a due falde (gable), a padiglione (hip)
- **Importazione mesh:** OBJ/STL con conversione assi, offset verticale e selezione/rimozione facce
- **6 tipi di ostacoli:** Camino, abbaino, antenna, box, cilindro, albero
- **4 forme di chioma albero:** Cono, sfera, ombrello, colonnare — con trasmissivita stagionale (deciduo/sempreverde)
- **Strumento metro:** Misurazione distanze 3D interattiva

### Simulazione Solare

- **3 modalita di analisi ombre:** Annuale, mensile, istantanea
- **2 livelli di risoluzione heatmap:** 50x50, 100x100
- **Simulazione giornaliera:** Profilo orario con curva ClearSky vs effettiva, playback animato
- **Modello termico NOCT:** De-rating potenza basato su temperatura cella

### Ottimizzazione e Dimensionamento

- **Algoritmo Seed-and-Grow:** Posizionamento greedy con espansione Von Neumann e multi-seed
- **Selezione automatica orientamento:** Portrait vs Landscape in base al rapporto kWh/kWp
- **Zone di installazione:** Poligoni disegnabili per limitare l'area di posizionamento
- **Confronto multi-pannello:** Ottimizzazione sequenziale per ogni pannello selezionato con tabella comparativa
- **Catalogo inverter:** Database SQLite con CRUD e selezione per dimensionamento
- **Dimensionamento stringhe:** Auto/manuale con verifica range MPPT, Voc a temperatura minima, rapporto DC/AC

### Analisi Economica

- **3 profili di consumo:** Annuale totale, mensile (12 valori), orario (8760 valori)
- **Autoconsumo e immissione:** Calcolo mensile con distribuzione consumi
- **Indicatori:** Tasso di autoconsumo, tasso di autosufficienza, payback period

### Export e Persistenza

- **Report PDF:** Multi-pagina con dati edificio, layout, KPI, analisi economica, schema stringhe
- **CSV riepilogativo:** Parametri progetto e risultati
- **CSV orario:** 8760 righe con posizione solare, irradianza, potenza, perdite
- **Salvataggio progetti:** Persistenza in localStorage con gestione multi-progetto

### Interfaccia

- **Bilingue IT/EN:** Toggle lingua nella Navbar con rilevamento automatico dal browser
- **Scena 3D fullscreen:** Card flottanti glassmorphism sovrapposte
- **Palette scura:** Sfondo `#080C14`, accenti blue/solar/teal/violet
- **Catalogo componenti:** Dropdown nella topbar per pannelli e inverter

---

## Licenza

Source Available License — vedi [LICENSE](LICENSE) per dettagli e per il disclaimer sui limiti di responsabilità dei calcoli.
