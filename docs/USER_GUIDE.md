# Guida Utente di SolarOptimizer3D

Benvenuti in SolarOptimizer3D, l'applicazione web per l'analisi energetica fotovoltaica e il posizionamento ottimale dei pannelli solari su edifici 3D.

L'interfaccia e organizzata in una **scena 3D a schermo intero** con **card flottanti** sovrapposte che guidano il flusso di lavoro in 4 fasi.

---

## Installazione

### Prerequisiti

- **Python** >= 3.10
- **Node.js** >= 18
- **Docker** >= 24 (opzionale, raccomandato)

### Avvio con Docker (raccomandato)

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`

### Avvio locale (senza Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev
```

### Variabili d'Ambiente

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `DB_PATH` | `backend/data/panels.db` | Percorso database SQLite |
| `CORS_ORIGINS` | `http://localhost:5173` | Origini CORS consentite |

---

## 1. Modello (Tab "Model")

Il primo step consiste nella definizione della geometria dell'edificio.

### 1.1 Configurazione Sito

- **Latitudine** e **Longitudine**: Coordinate del sito (la citta viene rilevata automaticamente)
- **Timezone**: Fuso orario per i calcoli solari

### 1.2 Costruzione Parametrica

Se non si dispone di un file 3D, e possibile generare l'edificio tramite parametri:

- **Larghezza** (m): Dimensione lungo l'asse Est-Ovest
- **Profondita** (m): Dimensione lungo l'asse Nord-Sud
- **Altezza** (m): Altezza delle pareti
- **Tipo di Tetto:**
  - **Piano (flat):** Superficie orizzontale
  - **A due falde (gable):** Due superfici inclinate simmetriche con colmo
  - **A padiglione (hip):** Quattro falde inclinate convergenti verso un colmo ridotto
- **Angolo del tetto** (solo gable/hip): Inclinazione delle falde in gradi
- **Altezza colmo** e **Lunghezza colmo** (solo hip): Parametri aggiuntivi per il tetto a padiglione

### 1.3 Importazione Modello 3D

Per edifici con geometria complessa:

1. Trascinare un file `.obj` o `.stl` nella zona di upload (oppure cliccare per selezionarlo)
2. Il server elaborera il file, convertendo gli assi e centrando la mesh
3. Una volta importato, vengono mostrati il nome del file e il numero di vertici
4. E possibile regolare l'**offset verticale** per allineare il modello al terreno
5. E possibile rimuovere il modello importato e tornare alla modalita parametrica

### 1.4 Modifica Mesh (solo modelli importati)

Per escludere porzioni della mesh dal calcolo:

1. Attivare la modalita **"Seleziona Facce"**
2. Trascinare un rettangolo di selezione sulle facce da escludere (evidenziate in rosso)
3. Confermare la cancellazione
4. E possibile annullare l'ultima selezione o ripristinare tutte le facce

### 1.5 Orientamento

- **Rotazione del modello** (0-359°): Ruota l'edificio rispetto al Nord
- I punti cardinali sono indicati: N (0°), E (90°), S (180°), W (270°)

### 1.6 Zone di Installazione

Per limitare il posizionamento dei pannelli a specifiche aree del tetto:

1. Cliccare **"Disegna area"** per avviare la modalita di disegno poligono
2. Cliccare sulla superficie del tetto per aggiungere vertici
3. Doppio-click per chiudere il poligono
4. E possibile definire piu zone e cancellarle singolarmente

### 1.7 Ostacoli

E possibile aggiungere ostacoli che proiettano ombre e impediscono il posizionamento dei pannelli:

| Tipo | Descrizione |
| --- | --- |
| **Camino** | Box rettangolare sul tetto |
| **Abbaino** | Box con dimensioni personalizzabili |
| **Antenna** | Cilindro verticale |
| **Lucernario** | Box trasparente sul tetto |
| **Pannello solare termico** | Box piatto sul tetto |
| **Unita esterna (HVAC)** | Box per condizionatore/pompa di calore |
| **Albero** | Tronco opaco + chioma con trasmissivita stagionale |
| **Edificio adiacente** | Box di grandi dimensioni a terra |

**Forme delle chiome degli alberi:**

- **Cono** — Forma conica classica (conifere)
- **Sfera** — Chioma sferica (latifoglie)
- **Ombrello** — Chioma a ombrello (pini marittimi)
- **Colonnare** — Chioma stretta e allungata (cipressi)

**Tipi di fogliame:**

- **Deciduo:** Trasmissivita alta in inverno (0.80), bassa in estate (0.10)
- **Sempreverde:** Trasmissivita costante (~0.15)

**Controlli ostacoli:**

- Trascinamento diretto nella scena 3D per il posizionamento
- Rotazione e inclinazione configurabili
- Indicatore di distanza dal bordo del tetto

---

## 2. Simulazione (Tab "Simulation")

### 2.1 Posizione Geografica

Inserire le coordinate del sito:

- **Latitudine** (es. 41.9 per Roma)
- **Longitudine** (es. 12.5 per Roma)

### 2.2 Modalita di Analisi

| Modalita | Descrizione | Utilizzo |
| --- | --- | --- |
| **Annuale** | Media ponderata su 12 giorni rappresentativi | Analisi standard per ottimizzazione |
| **Mensile** | Analisi dettagliata per un mese specifico | Verifica stagionale |
| **Istantanea** | Ombra per data e ora specifiche | Verifica puntuale |

### 2.3 Risoluzione della Griglia

La risoluzione determina la granularita della heatmap di ombreggiamento:

| Livello | Griglia | Tempo di calcolo |
| --- | --- | --- |
| **Bassa** | 30 x 30 | Rapido (~2-5s) |
| **Media** | 50 x 50 | Moderato (~5-15s) |

### 2.4 Calcolo delle Ombre

Premere **"Calcola"** per avviare il ray-casting. Un timer mostra il tempo trascorso durante il calcolo.

La heatmap risultante viene sovrapposta al modello 3D:

- **Verde** (0%): Area completamente libera da ombre
- **Giallo** (30%): Ombreggiamento parziale
- **Rosso** (70%): Ombreggiamento significativo
- **Viola** (100%): Area completamente ombreggiata

La heatmap e attivabile/disattivabile tramite un toggle nella UI. Se sono definite piu zone di installazione, il calcolo viene eseguito per ciascuna zona.

---

## 3. Catalogo Componenti (Navbar)

Il catalogo pannelli e inverter e accessibile dalla **barra di navigazione superiore** tramite un menu a tendina.

### 3.1 Catalogo Pannelli

Per aggiungere un pannello:

1. Cliccare il pulsante catalogo nella Navbar
2. Selezionare la sezione **Pannelli**
3. Compilare i dati di targa:
   - Costruttore e modello
   - Potenza nominale (W)
   - Efficienza (%)
   - Dimensioni (larghezza x altezza in metri)
   - Peso (kg)
   - Coefficiente di temperatura Pmax (%/°C)
   - Garanzia (anni) e degrado annuale (%)
   - **Parametri elettrici** (per dimensionamento stringhe):
     - Voc (V), Isc (A), Vmpp (V), Impp (A)
     - Coefficienti temperatura Voc e Isc (%/°C)
4. Il pannello viene salvato nel database e sara disponibile nelle sessioni successive

Selezionare uno o piu pannelli dalla lista con i checkbox.

### 3.2 Catalogo Inverter

Per aggiungere un inverter:

1. Selezionare la sezione **Inverter** nel catalogo
2. Compilare i dati di targa:
   - Costruttore e modello
   - Potenza nominale AC (kW) e potenza massima DC (kW)
   - Numero canali MPPT
   - Range tensione MPPT (min-max V)
   - Tensione massima ingresso DC (V)
   - Corrente massima per canale MPPT (A)
   - Efficienza (%)
   - Peso (kg) e garanzia (anni)
3. L'inverter viene salvato nel database

### 3.3 Confronto Pannelli

Con 2 o piu pannelli selezionati, il pulsante **"Confronta"** genera una tabella comparativa con:

- Produzione annuale stimata per pannello (kWh)
- Numero di pannelli installabili
- Potenza totale installata (kWp)

---

## 4. Ottimizzazione (Tab "Optimization")

### 4.1 Parametri di Sistema

- **Potenza massima** (kWp): Limite superiore per la potenza installabile
- **Efficienza di sistema** (%): Fattore che tiene conto delle perdite BOS (inverter, cablaggio, soiling)

### 4.2 Esecuzione dell'Ottimizzazione

Premere **"Ottimizza"** per avviare l'algoritmo Seed-and-Grow. Requisiti:

- Almeno un pannello selezionato nel catalogo
- Calcolo delle ombre completato (Tab Simulazione)

L'algoritmo:

1. Identifica le posizioni con il massimo irraggiamento
2. Espande il layout a macchia d'olio verso i vicini piu irraggiati
3. Confronta automaticamente l'orientamento Portrait vs Landscape
4. Seleziona il layout con il miglior rendimento specifico (kWh/kWp)

Un timer mostra il tempo trascorso e il tempo stimato rimanente.

### 4.3 Installazione Manuale

In alternativa all'ottimizzazione automatica, e possibile posizionare manualmente i pannelli:

- Drag & drop dei pannelli sulla superficie del tetto
- I pannelli si agganciano alla griglia e rispettano i vincoli di bordo

### 4.4 Visualizzazione Risultati

Al termine dell'ottimizzazione:

- I pannelli ottimizzati appaiono nella scena 3D in verde
- Un toggle permette di passare tra la vista **"Manuale"** e **"Ottimizzata"**
- Il pulsante **"Adotta Layout"** converte i pannelli ottimizzati in pannelli manuali editabili

---

## 5. Dimensionamento Stringhe (Tab "Optimization")

Dopo il posizionamento dei pannelli, e possibile verificare la compatibilita elettrica con l'inverter.

### 5.1 Modalita Automatica

Il sistema trova la configurazione ottimale serie/parallelo:

1. Selezionare un pannello con parametri elettrici (Voc, Isc, Vmpp, Impp) nel catalogo
2. Selezionare un inverter dal catalogo
3. Configurare le temperature del sito (T_min e T_max storiche)
4. Premere **"Calcola"** — il sistema determina automaticamente il numero di pannelli in serie per stringa, le stringhe in parallelo per canale MPPT e i canali MPPT utilizzati

### 5.2 Modalita Manuale

Per verificare una configurazione scelta dall'utente:

1. Selezionare la modalita **"Manuale"**
2. Inserire il numero di pannelli per stringa e stringhe per canale MPPT
3. Il sistema verifica la compatibilita e mostra eventuali warning/errori

### 5.3 Parametri Visualizzati

- Voc max a temperatura minima (V)
- Range Vmpp a temperature estreme (V)
- Isc max a temperatura massima (A)
- Rapporto DC/AC
- Stato di compatibilita (ok / warning / errore)

---

## 6. Risultati (Tab "Results")

La schermata dei risultati si apre come overlay modale con layout a colonne.

### 6.1 KPI

| Metrica | Descrizione |
| --- | --- |
| **Potenza installata** | kWp totali del layout |
| **Numero pannelli** | Pannelli posizionati |
| **Produzione annuale** | kWh stimati per anno |
| **Rendimento specifico** | kWh/kWp — indicatore di efficienza del sito |
| **Performance Ratio** | Rapporto tra produzione reale e teorica (%) |
| **Miglioramento** | % di miglioramento rispetto al layout base |

I KPI hanno tooltip informativi che spiegano il significato di ciascuna metrica.

### 6.2 Produzione Mensile

- Grafico a barre con la distribuzione mensile della produzione
- Se sono stati selezionati piu pannelli, una tabella comparativa mostra i risultati per ciascun tipo

### 6.3 Simulazione Giornaliera

- Grafico a linee con il profilo orario di produzione per un giorno selezionato
- **Curva ClearSky** (tratteggiata): Potenza massima teorica senza nuvole ne ombre
- **Curva Effettiva** (solida): Potenza con ombre, perdite termiche e di sistema
- Mini statistiche: produzione giornaliera (kWh), potenza di picco (W), ore di sole

Se la simulazione giornaliera non e ancora stata eseguita, un pulsante permette di avviarla direttamente.

### 6.4 Analisi Economica

L'analisi economica calcola il ritorno dell'investimento:

- **Profili di consumo:** Annuo (singolo valore), mensile (12 valori) o orario (8760 valori)
- **Autoconsumo vs cessione in rete:** Ripartizione mensile della produzione
- **Risparmio annuo:** Basato sulla tariffa energia elettrica e la tariffa di cessione GSE
- **Payback period:** Tempo di ritorno dell'investimento (se fornito il costo impianto)
- **Indicatori:** Tasso di autoconsumo (%) e tasso di autosufficienza (%)

### 6.5 Esportazione

- **Export PDF:** Report professionale multi-pagina con:
  - Copertina con KPI principali
  - Dati sito, specifiche pannello, inverter e configurazione stringhe
  - Tabella e grafici produzione mensile
  - Analisi economica con payback e proiezione 25 anni
  - Disegno tecnico layout pannelli con numerazione
  - Pagina ambientale (CO2 evitata, alberi equivalenti)
- **Export CSV:** Dati di produzione mensile in formato tabellare
- **Export CSV orario:** 8760 righe con dati orari dettagliati (posizione solare, irradianza, temperatura, potenza)

---

## 7. Strumenti Aggiuntivi

### 7.1 Strumento di Misura

Attivabile dalla barra superiore (HUD), permette di misurare distanze nella scena 3D:

1. Attivare la modalita misura
2. Cliccare due punti nella scena
3. La distanza viene visualizzata in metri

### 7.2 Indicatore Distanza Ostacoli

Quando un ostacolo e selezionato, viene mostrata automaticamente la distanza dal bordo del tetto piu vicino.

### 7.3 Toggle Visualizzazione

Dalla scena 3D e possibile attivare/disattivare:

- **Heatmap ombre:** Sovrapposta al modello 3D
- **Percorso solare:** Arco nel cielo con posizione del sole

### 7.4 Navigazione 3D

- **Rotazione:** Click sinistro + trascinamento
- **Pan:** Click destro + trascinamento (o click centrale)
- **Zoom:** Rotella del mouse
- **Rosa dei venti:** Indica sempre la direzione Nord nella scena
- **Cielo e terreno:** Rendering 3D dell'ambiente circostante

---

## 8. Salvataggio Progetti

Il sistema supporta il salvataggio e il caricamento di progetti in localStorage:

1. Cliccare l'icona **Progetti** nella Navbar
2. **Salvare:** Inserire un nome e confermare — l'intero stato viene serializzato
3. **Caricare:** Selezionare un progetto salvato dalla lista
4. **Eliminare:** Rimuovere un progetto non piu necessario

I progetti salvati persistono tra le sessioni del browser.

---

## 9. Lingua

L'applicazione supporta due lingue:

- **Italiano** (IT) — Default
- **Inglese** (EN)

Il toggle lingua e disponibile nella Navbar. La selezione viene memorizzata e applicata a tutta l'interfaccia.

---

## 10. Flusso di Lavoro Consigliato

```text
1. Configurare il sito (latitudine, longitudine)
   ↓
2. Definire la geometria dell'edificio (parametrica con 4 tipi di tetto, o importata con offset verticale)
   ↓
3. Aggiungere ostacoli (camini, alberi con 4 forme chioma, edifici adiacenti)
   ↓
4. Definire zone di installazione (opzionale)
   ↓
5. Inserire pannelli e inverter nel catalogo (dalla Navbar)
   ↓
6. Calcolare le ombre (analisi annuale raccomandata)
   ↓
7. Eseguire l'ottimizzazione Seed-and-Grow (o posizionamento manuale)
   ↓
8. Dimensionare le stringhe (verifica compatibilita pannello-inverter)
   ↓
9. Eseguire la simulazione giornaliera per verificare il profilo
   ↓
10. Consultare i risultati, l'analisi economica ed esportare il report PDF/CSV
```

---

## 11. Note e Limitazioni

- I dati meteorologici TMY vengono scaricati automaticamente da PVGIS. Se non disponibili, il sistema utilizza il modello ClearSky (cielo sereno ideale), che sovrastima la produzione reale.
- L'algoritmo di ottimizzazione non tiene conto di vincoli strutturali del tetto (portanza, accesso per manutenzione).
- Le perdite di sistema (default 14%) sono un valore globale che include inverter, cablaggio, soiling e mismatch. Per un'analisi piu accurata, inserire un valore basato sulle specifiche dell'impianto.
- La heatmap delle ombre rappresenta una media ponderata e non cattura effetti di microombreggiamento su singole celle dei pannelli.
- Il dimensionamento stringhe verifica la compatibilita elettrica ma non sostituisce la progettazione di un tecnico abilitato.
- L'analisi economica utilizza profili di consumo ENEA per la distribuzione oraria; per la massima precisione, fornire il profilo orario effettivo (8760 valori).
