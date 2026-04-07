# SolarOptimizer3D API Reference

Tutti gli endpoint sono esposti dal backend FastAPI sulla porta **8000** (default). La documentazione interattiva Swagger UI e disponibile su `http://localhost:8000/docs`.

Base URL: `http://localhost:8000/api/v1`

---

## 1. Building API

Gestione della struttura 3D dell'edificio.

### `POST /api/v1/building/upload`

Carica un file mesh 3D, applica la conversione degli assi (Z-up a Y-up), centra la mesh e restituisce vertices/faces per il rendering frontend.

**Content-Type:** `multipart/form-data`

**Parametri:**

- `file` (UploadFile, obbligatorio): File in formato `.obj` o `.stl`
- `axis_correction` (string, opzionale): Modalita di correzione assi. Default: `"auto"`

**Response (200 OK):**

```json
{
  "filename": "casa.obj",
  "vertices": [
    [-4.3, 10.2, 0.4],
    [5.2, 10.2, 0.4]
  ],
  "faces": [
    [0, 1, 2],
    [3, 4, 1]
  ],
  "bounds": [[-5, 0, -5], [5, 12, 5]],
  "vertex_count": 528,
  "face_count": 1056
}
```

**Esempio cURL:**

```bash
curl -X POST "http://localhost:8000/api/v1/building/upload" \
  -H "accept: application/json" \
  -F "file=@/percorso/casa.obj"
```

---

## 2. Solar API

Calcoli astronomici, simulazione solare e analisi economica.

### `POST /api/v1/solar/sun-path`

Genera le posizioni solari orarie per un anno intero, filtrate per ore diurne (elevazione > 0).

**Request Body (`SunPathRequest`):**

```json
{
  "latitude": 41.9028,
  "longitude": 12.4964,
  "timezone": "Europe/Rome",
  "year": 2024
}
```

**Response (`SunPathResponse`, 200 OK):**

```json
{
  "timestamps": [
    "2024-01-01T07:00:00+01:00",
    "2024-01-01T08:00:00+01:00"
  ],
  "azimuth": [121.5, 134.8],
  "elevation": [2.4, 9.8],
  "zenith": [87.6, 80.2]
}
```

### `POST /api/v1/solar/irradiance`

Calcola l'irradianza annuale su piano inclinato (POA) utilizzando dati TMY da PVGIS (con fallback a modello ClearSky). Trasposizione con modello di Perez.

**Request Body (`IrradianceRequest`):**

```json
{
  "latitude": 41.9028,
  "longitude": 12.4964,
  "timezone": "Europe/Rome",
  "year": 2024,
  "tilt": 30.0,
  "azimuth": 180.0
}
```

**Response (`IrradianceResponse`, 200 OK):**

```json
{
  "timestamps": ["2024-01-01T07:00:00+01:00"],
  "poa_global": [124.5],
  "poa_direct": [100.2],
  "poa_diffuse": [24.3],
  "monthly_totals": {
    "January": 115.4,
    "February": 130.8
  },
  "annual_total": 1850.2
}
```

### `POST /api/v1/solar/shadows`

Calcola la heatmap di ombreggiamento sul tetto tramite ray-casting. Supporta analisi annuale, mensile o istantanea.

**Request Body (`ShadowRequest`):**

```json
{
  "latitude": 41.9028,
  "longitude": 12.4964,
  "timezone": "Europe/Rome",
  "azimuth": 0,
  "model_rotation": 0,
  "grid_resolution": 50,
  "building": {
    "width": 12,
    "depth": 10,
    "height": 6,
    "roofType": "flat"
  },
  "obstacles": [
    {
      "type": "box",
      "dimensions": [1, 2, 1],
      "position": [2, 6, 2]
    }
  ],
  "installation_polygons": null,
  "installation_plane_y": null,
  "model_offset_y": 0,
  "analysis_mode": "annual",
  "analysis_month": null,
  "analysis_day": null,
  "analysis_hour": null
}
```

**Response (`ShadowResponse`, 200 OK):**

```json
{
  "shadow_grid": [
    [0.12, 0.45, 0.88],
    [0.05, 0.22, 0.67]
  ],
  "grid_bounds": {
    "min_x": -6.0,
    "max_x": 6.0,
    "min_z": -5.0,
    "max_z": 5.0
  },
  "monthly_shadows": {
    "Year": 0.154
  },
  "statistics": {
    "free_area_pct": 82.5
  },
  "computation_time_s": 3.2
}
```

**Note:**

- `grid_resolution`: 30 (bassa), 50 (media), 100 (alta) punti per lato
- `analysis_mode`: `"annual"` (12 giorni campione), `"monthly"` (singolo mese), `"instant"` (singolo timestamp)
- Valori nella griglia: 0.0 = libero, 1.0 = completamente ombreggiato, -1.0 = fuori dal poligono di installazione
- `installation_polygons`: Array di poligoni `[{x, y, z}]` che definiscono le zone di installazione
- `installation_plane_y`: Quota Y del piano di installazione (per modelli importati)
- `model_offset_y`: Offset verticale del modello importato (metri)

### `POST /api/v1/solar/daily-simulation`

Simula la produzione energetica per un giorno specifico con step di 30 minuti. Include modello termico NOCT, ray-casting ombre per pannello e confronto con curva ClearSky.

**Request Body (`DailySimulationRequest`):**

```json
{
  "latitude": 41.9028,
  "longitude": 12.4964,
  "timezone": "Europe/Rome",
  "month": 6,
  "day": 21,
  "tilt": 30.0,
  "panel_azimuth": 180.0,
  "building_azimuth": 0.0,
  "model_rotation": 0.0,
  "model_offset_y": 0.0,
  "building": {
    "width": 12,
    "depth": 10,
    "height": 6,
    "roofType": "flat"
  },
  "obstacles": [],
  "panels": [
    {"x": 0.0, "z": 0.0}
  ],
  "panel_power_w": 410,
  "panel_efficiency": 0.21,
  "temp_coefficient": -0.4,
  "noct_temperature": 45,
  "system_losses": 0.14,
  "ambient_temperature": null,
  "installation_polygons": []
}
```

**Response (`DailySimulationResponse`, 200 OK):**

```json
{
  "date": "2024-06-21",
  "hourly": [
    {
      "time": "06:00",
      "solar_elevation": 5.2,
      "solar_azimuth": 68.3,
      "poa_global": 120.5,
      "power_w": 380.0,
      "power_ideal_w": 410.0,
      "power_clearsky_w": 410.0,
      "shading_loss_pct": 0.0,
      "temp_loss_pct": 2.5
    }
  ],
  "daily_kwh": 4.85,
  "daily_kwh_ideal": 5.10,
  "daily_kwh_clearsky": 5.30,
  "peak_power_w": 385.0,
  "sunshine_hours": 14.5,
  "daily_temp_loss_pct": 3.2,
  "computation_time_s": 1.8
}
```

### `POST /api/v1/solar/economics`

Analisi economica dell'impianto: calcolo autoconsumo, cessione in rete, risparmio e tempo di ritorno dell'investimento. Supporta 3 modalita di profilo consumo (annuo, mensile, orario).

**Request Body (`EconomicsRequest`):**

```json
{
  "monthly_production_kwh": [180, 220, 350, 420, 510, 540, 560, 520, 400, 300, 200, 160],
  "annual_consumption_kwh": 3500,
  "monthly_consumption_kwh": null,
  "hourly_consumption_kwh": null,
  "energy_price_eur": 0.25,
  "feed_in_tariff_eur": 0.08,
  "system_cost_eur": 8000
}
```

**Profili di consumo (mutuamente esclusivi, in ordine di priorita):**

1. `hourly_consumption_kwh` — Profilo orario 8760 valori (massima precisione)
2. `monthly_consumption_kwh` — 12 valori mensili (distribuzione ENEA interna per orario)
3. `annual_consumption_kwh` — Singolo valore annuo (distribuzione ENEA per mensile e orario). Default: 3500 kWh

**Response (`EconomicsResponse`, 200 OK):**

```json
{
  "monthly": [
    {
      "month": 1,
      "month_name": "Gennaio",
      "production_kwh": 180.0,
      "consumption_kwh": 320.0,
      "self_consumed_kwh": 145.0,
      "fed_in_kwh": 35.0,
      "grid_consumed_kwh": 175.0,
      "savings_eur": 36.25,
      "revenue_eur": 2.80
    }
  ],
  "total_production_kwh": 4360.0,
  "total_self_consumed_kwh": 2850.0,
  "total_fed_in_kwh": 1510.0,
  "total_savings_eur": 712.50,
  "total_revenue_eur": 120.80,
  "self_consumption_rate_pct": 65.4,
  "self_sufficiency_rate_pct": 81.4,
  "payback_years": 9.6
}
```

---

## 3. Optimization API

Interazione asincrona con pattern Job-Polling per l'algoritmo Seed-and-Grow.

### `POST /api/v1/optimize/run`

Avvia l'ottimizzazione del layout pannelli in background. Restituisce un job_id per il polling.

**Request Body (`OptimizationRequest`):**

```json
{
  "building_geometry": {
    "width": 10,
    "depth": 15,
    "height": 6,
    "roof_type": "flat",
    "roof_angle": 0
  },
  "panel_specs": {
    "width": 1.0,
    "height": 1.7,
    "power": 410,
    "efficiency": 0.21,
    "temp_coefficient": -0.004,
    "noct_temperature": 45
  },
  "constraints": {
    "max_peak_power": 6.0,
    "min_distance": 0.05,
    "roof_margin": 0.3,
    "allow_rotation": true,
    "require_strings": false
  },
  "shadow_grid": [[0.1, 0.2], [0.3, 0.05]],
  "grid_bounds": {
    "min_x": -5.0,
    "max_x": 5.0,
    "min_z": -7.5,
    "max_z": 7.5
  },
  "installation_polygons": null,
  "obstacles": [],
  "annual_irradiance": 1400.0,
  "system_losses": 0.14,
  "strategy": "seed_and_grow"
}
```

**Response (200 OK):**

```json
{
  "job_id": "8f3b1456-e92c-4a1b-..."
}
```

### `GET /api/v1/optimize/status/{job_id}`

Polling dello stato del job di ottimizzazione. Consigliato: ogni 2 secondi.

**Response (200 OK):**

```json
{
  "job_id": "8f3b1456-e92c-4a1b-...",
  "status": "running",
  "progress": 45,
  "current_generation": null,
  "total_generations": null,
  "best_fitness": null,
  "error_message": null,
  "elapsed_time_s": 3.5,
  "estimated_remaining_s": 4.2
}
```

**Valori di `status`:** `"pending"`, `"running"`, `"completed"`, `"failed"`

### `GET /api/v1/optimize/result/{job_id}`

Recupera il risultato finale dell'ottimizzazione. Disponibile solo quando `status = "completed"`.

**Response (`OptimizationResult`, 200 OK):**

```json
{
  "panels": [
    {
      "x": -2.3,
      "y": 4.1,
      "irradiance_factor": 0.98,
      "orientation": "landscape"
    },
    {
      "x": -1.3,
      "y": 4.1,
      "irradiance_factor": 0.94,
      "orientation": "landscape"
    }
  ],
  "total_panels": 14,
  "total_power_kw": 5.74,
  "total_energy_kwh": 8036.0,
  "improvement_pct": 12.5,
  "convergence_history": [],
  "best_fitness_per_generation": []
}
```

**Note:**

- `panels[].x`, `panels[].y`: Coordinate nel piano del tetto (x = larghezza, y = profondita)
- `panels[].orientation`: `"portrait"` o `"landscape"`
- `panels[].irradiance_factor`: Fattore di irradianza (0.0-1.0), dove 1.0 = nessuna ombra
- L'algoritmo esegue automaticamente due run (portrait e landscape) e seleziona l'orientamento con il miglior kWh/kWp

---

## 4. Panels API

CRUD per il catalogo pannelli fotovoltaici, persistito in SQLite.

### `POST /api/v1/panels`

Aggiunge un nuovo pannello al catalogo.

**Request Body (`PanelCreate`):**

```json
{
  "constructor": "SunPower",
  "model": "Maxeon 6",
  "power_w": 420,
  "efficiency_pct": 22.8,
  "width_m": 1.046,
  "height_m": 1.690,
  "weight_kg": 19.0,
  "op_temperature_c": "-40/+85",
  "temp_coefficient": -0.29,
  "warranty_years": 40,
  "degradation_pct": 0.25,
  "voc_v": 48.3,
  "isc_a": 11.12,
  "vmpp_v": 40.5,
  "impp_a": 10.37,
  "temp_coeff_voc": -0.27,
  "temp_coeff_isc": 0.05
}
```

**Campi obbligatori:** `constructor`, `model`, `power_w`, `efficiency_pct`, `width_m`, `height_m`

**Campi opzionali:** `weight_kg`, `op_temperature_c`, `temp_coefficient`, `warranty_years`, `degradation_pct`, `voc_v`, `isc_a`, `vmpp_v`, `impp_a`, `temp_coeff_voc`, `temp_coeff_isc`

**Campi elettrici:** I parametri `voc_v`, `isc_a`, `vmpp_v`, `impp_a`, `temp_coeff_voc`, `temp_coeff_isc` sono necessari per il dimensionamento stringhe con l'inverter.

**Response (`PanelRead`, 200 OK):**

```json
{
  "id": "a1b2c3d4",
  "constructor": "SunPower",
  "model": "Maxeon 6",
  "power_w": 420,
  "efficiency_pct": 22.8,
  "width_m": 1.046,
  "height_m": 1.690,
  "weight_kg": 19.0,
  "op_temperature_c": "-40/+85",
  "temp_coefficient": -0.29,
  "warranty_years": 40,
  "degradation_pct": 0.25,
  "voc_v": 48.3,
  "isc_a": 11.12,
  "vmpp_v": 40.5,
  "impp_a": 10.37,
  "temp_coeff_voc": -0.27,
  "temp_coeff_isc": 0.05
}
```

### `GET /api/v1/panels`

Restituisce l'elenco completo dei pannelli nel catalogo.

**Response (200 OK):** `List[PanelRead]`

### `DELETE /api/v1/panels/{panel_id}`

Rimuove un pannello dal catalogo.

**Response:** `204 No Content`

### `POST /api/v1/panels/compare`

Confronta la produzione stimata di piu pannelli selezionati nelle stesse condizioni.

**Request Body (`PanelComparisonRequest`):**

```json
{
  "panel_ids": ["id1", "id2", "id3"],
  "annual_irradiance_kwh_m2": 1400.0,
  "avg_shadow_factor": 0.15,
  "roof_area_m2": 50.0
}
```

**Response (`PanelComparisonResponse`, 200 OK):**

```json
{
  "estimates": [
    {
      "panel_id": "id1",
      "label": "SunPower Maxeon 6",
      "panels_fit": 28,
      "annual_kwh_per_panel": 520.3,
      "total_annual_kwh": 14568.4,
      "total_power_kwp": 11.76,
      "degradation_pct": 0.25,
      "temp_coefficient": -0.29
    }
  ]
}
```

---

## 5. Inverters API

CRUD per il catalogo inverter, persistito in SQLite.

### `POST /api/v1/inverters`

Aggiunge un nuovo inverter al catalogo.

**Request Body (`InverterCreate`):**

```json
{
  "constructor": "Huawei",
  "model": "SUN2000-6KTL-M1",
  "power_kw": 6.0,
  "max_dc_power_kw": 9.0,
  "mppt_channels": 2,
  "mppt_voltage_min_v": 140,
  "mppt_voltage_max_v": 980,
  "max_input_voltage_v": 1100,
  "max_input_current_a": 12.5,
  "efficiency_pct": 98.6,
  "weight_kg": 10.5,
  "warranty_years": 10
}
```

**Campi obbligatori:** `constructor`, `model`, `power_kw`, `max_dc_power_kw`, `mppt_channels`, `mppt_voltage_min_v`, `mppt_voltage_max_v`, `max_input_voltage_v`, `max_input_current_a`, `efficiency_pct`

**Campi opzionali:** `weight_kg`, `warranty_years`

**Response (`InverterRead`, 200 OK):**

```json
{
  "id": "a1b2c3d4e5f6",
  "constructor": "Huawei",
  "model": "SUN2000-6KTL-M1",
  "power_kw": 6.0,
  "max_dc_power_kw": 9.0,
  "mppt_channels": 2,
  "mppt_voltage_min_v": 140,
  "mppt_voltage_max_v": 980,
  "max_input_voltage_v": 1100,
  "max_input_current_a": 12.5,
  "efficiency_pct": 98.6,
  "weight_kg": 10.5,
  "warranty_years": 10
}
```

### `GET /api/v1/inverters`

Restituisce l'elenco completo degli inverter nel catalogo.

**Response (200 OK):** `List[InverterRead]`

### `DELETE /api/v1/inverters/{inverter_id}`

Rimuove un inverter dal catalogo.

**Response:** `204 No Content`

---

## 6. Stringing API

Dimensionamento stringhe fotovoltaiche per la verifica di compatibilita pannello-inverter.

### `POST /api/v1/stringing/calculate`

Calcola la configurazione ottimale serie/parallelo (modalita auto) o verifica una configurazione manuale, nel rispetto dei vincoli elettrici MPPT dell'inverter selezionato.

**Request Body (`StringingRequest`):**

```json
{
  "mode": "auto",
  "voc_v": 48.3,
  "isc_a": 11.12,
  "vmpp_v": 40.5,
  "impp_a": 10.37,
  "power_w": 420,
  "temp_coeff_voc": -0.27,
  "temp_coeff_isc": 0.05,
  "mppt_channels": 2,
  "mppt_voltage_min_v": 140,
  "mppt_voltage_max_v": 980,
  "max_input_voltage_v": 1100,
  "max_input_current_a": 12.5,
  "max_dc_power_kw": 9.0,
  "inverter_power_kw": 6.0,
  "t_min_c": -10,
  "t_max_c": 40,
  "total_panels": 14,
  "panels_per_string": null,
  "strings_per_mppt": null
}
```

**Modalita:**

- `"auto"` — Trova la configurazione ottimale che massimizza i pannelli utilizzati
- `"manual"` — Verifica `panels_per_string` e `strings_per_mppt` forniti dall'utente

**Response (`StringingResponse`, 200 OK):**

```json
{
  "compatible": true,
  "status": "ok",
  "panels_per_string": 7,
  "strings_per_mppt": 1,
  "mppt_used": 2,
  "total_panels_used": 14,
  "total_panels_unused": 0,
  "dc_power_kw": 5.88,
  "voc_max_v": 386.8,
  "vmpp_min_v": 253.6,
  "vmpp_max_v": 321.9,
  "isc_max_a": 11.18,
  "dc_ac_ratio": 0.98,
  "warnings": []
}
```

**Verifiche effettuate:**

- `Voc_max` a T_min < `max_input_voltage_v` dell'inverter
- `Vmpp` nel range MPPT (`mppt_voltage_min_v` - `mppt_voltage_max_v`)
- `Isc_max` a T_max < `max_input_current_a` per canale
- Rapporto DC/AC (warning se > 1.3, errore se > 1.5)
- Potenza DC totale < `max_dc_power_kw`

---

## 7. Export API

Generazione report esportabili.

### `POST /api/v1/export/csv`

Genera un report CSV con la distribuzione mensile della produzione.

**Request Body (`ExportRequest`):** Oggetto con dati di simulazione e info progetto.

**Response:** File CSV in streaming (`text/csv`).

### `POST /api/v1/export/csv-hourly`

Genera un CSV con le 8760 ore dell'anno, includendo per ogni ora: posizione solare, irradianza, temperatura, potenza, perdite termiche.

**Request Body (`HourlyCsvRequest`):**

```json
{
  "latitude": 41.9028,
  "longitude": 12.4964,
  "tilt": 30.0,
  "azimuth": 180.0,
  "timezone": "Europe/Rome",
  "panel_power_w": 420,
  "efficiency": 0.228,
  "temp_coefficient": -0.4,
  "num_panels": 14,
  "system_losses": 0.14,
  "noct_temperature": 45.0,
  "year": 2024
}
```

**Response:** File CSV in streaming (`text/csv`) con 8760 righe.

### `POST /api/v1/export/pdf`

Genera un report PDF professionale multi-pagina con:

- **Pagina copertina:** KPI principali (potenza, pannelli, produzione, rendimento)
- **Pagina sito e componenti:** Dati sito, specifiche pannello (inclusi parametri elettrici), inverter, configurazione stringhe
- **Pagina produzione:** Tabella e grafici produzione mensile e irradianza
- **Pagina economica:** Payback period, proiezione 25 anni, flusso di cassa
- **Pagina layout:** Disegno tecnico con posizione pannelli numerati, bussola, dimensioni edificio, ostacoli
- **Pagina ambientale:** CO2 evitata, alberi equivalenti, note normative

**Request Body (`ExportRequest`):** Oggetto completo con simulation_results, project_info, monthly_irradiance, panel_specs, panels_layout, kpi, economic, inverter_specs, stringing, building_info, obstacles.

**Response:** File PDF in streaming (`application/pdf`).

---

## 8. Health Check

### `GET /health`

```json
{
  "status": "ok"
}
```

### `GET /`

```json
{
  "message": "SolarOptimizer3D API",
  "docs": "/docs",
  "health": "/health"
}
```

---

## 9. Pattern di Comunicazione

| Tipo | Endpoint | Tempo tipico |
| --- | --- | --- |
| **Sincrono** | sun-path, irradiance, shadows, daily-simulation, economics, building upload, panels CRUD, inverters CRUD, stringing | < 10s |
| **Asincrono (polling)** | optimize/run + status + result | 5-60s |
| **Streaming** | export/csv, export/csv-hourly, export/pdf | < 2s |

### Gestione Errori

Tutti gli endpoint restituiscono errori HTTP standard:

```json
{
  "detail": "Descrizione dell'errore"
}
```

Codici comuni:

- `400 Bad Request` — Parametri non validi
- `404 Not Found` — Job, pannello o inverter non trovato
- `422 Unprocessable Entity` — Validazione Pydantic fallita
- `500 Internal Server Error` — Errore di calcolo
