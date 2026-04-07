# Changelog

Tutte le modifiche rilevanti a questo progetto sono documentate in questo file.

## [1.0.0] - 2026-04-07

Rilascio pubblico iniziale.

### Modellazione 3D

- Edifici parametrici con 3 tipi di tetto: piano (flat), a due falde (gable), a padiglione (hip)
- Importazione mesh OBJ/STL con conversione assi, offset verticale, selezione e rimozione facce
- 6 tipi di ostacoli: camino, abbaino, antenna, box, cilindro, albero
- 4 forme di chioma albero (cono, sfera, ombrello, colonnare) con trasmissività stagionale
- Strumento metro per misurazione distanze 3D interattiva
- Indicatore distanza ostacoli e inclinazione alberi

### Simulazione Solare

- Percorso solare e heatmap di ombreggiamento via ray-casting (annuale, mensile, istantanea)
- 2 livelli di risoluzione heatmap: 50x50, 100x100
- Simulazione giornaliera con profilo orario ClearSky vs effettivo e playback animato
- Modello termico NOCT per de-rating potenza basato su temperatura cella
- Calcolo irradianza per superficie basato su orientamento pannello e geometria tetto
- Superficie di potenza solare annuale con visualizzazione 3D
- Integrazione dati TMY da PVGIS con modello di trasposizione Perez

### Ottimizzazione

- Algoritmo Seed-and-Grow con espansione BFS e vicini Von Neumann
- Selezione automatica orientamento (Portrait vs Landscape) in base al rapporto kWh/kWp
- Multi-seed: apertura nuovi punti seme quando lo spazio si esaurisce
- Zone di installazione poligonali disegnabili
- Posizionamento manuale pannelli con drag, rotazione e collision detection
- Confronto multi-pannello con ottimizzazione sequenziale e tabella comparativa

### Dimensionamento Elettrico

- Catalogo pannelli con parametri elettrici (Voc, Isc, Vmpp, Impp) in database SQLite
- Catalogo inverter con CRUD e selezione per dimensionamento
- Dimensionamento stringhe automatico e manuale con verifica range MPPT
- Calcolo Voc a temperatura minima, Isc a temperatura massima, rapporto DC/AC

### Analisi Economica

- 3 profili di consumo: annuale totale, mensile (12 valori), orario (8760 valori)
- Calcolo autoconsumo e immissione in rete su base mensile
- Indicatori: tasso di autoconsumo, tasso di autosufficienza, payback period, risparmio annuo

### Export e Persistenza

- Report PDF multi-pagina con dati edificio, layout, KPI, analisi economica, schema stringhe
- CSV riepilogativo con parametri progetto e risultati
- CSV orario annuale (8760 righe) con posizione solare, irradianza, potenza, perdite
- Profilo consumo orario incluso nell'export CSV
- Salvataggio e caricamento progetti in localStorage con gestione multi-progetto

### Interfaccia

- Interfaccia bilingue IT/EN con i18next e rilevamento automatico lingua browser
- Scena 3D fullscreen con card flottanti glassmorphism
- Palette scura con design tokens CSS
- Error boundaries per Three.js canvas e crash recovery a livello app
- Dropdown catalogo componenti nella topbar

### Infrastruttura

- Backend FastAPI con Python 3.11 e API REST documentata (Swagger)
- Frontend React 18 + Vite con Three.js / React Three Fiber
- Zustand state management con 9 slice e selector helpers
- Docker Compose con healthcheck, utenti non-root, e .dockerignore
- Suite di test completa (pytest + pytest-asyncio)
- Sicurezza: DEBUG off, CORS strict, UUID completi, cleanup job
