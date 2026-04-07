/**
 * Calcola le perdite totali di sistema composte:
 * - Se inverter selezionato: composizione perdite inverter × perdite BOS
 * - Altrimenti: aggiunge stima forfettaria 3% per inverter generico
 *
 * @param {number} otherBosLosses - Perdite BOS non-inverter (0–1), es. 0.11
 * @param {Array} inverterDatasheets - Lista inverter dal catalogo
 * @param {string|null} selectedInverterId - ID inverter selezionato
 * @returns {number} Perdite totali di sistema (0–1)
 */
export function computeTotalLosses(otherBosLosses, inverterDatasheets, selectedInverterId) {
  const inverter = inverterDatasheets?.find((i) => i.id === selectedInverterId);
  if (inverter?.efficiency_pct) {
    const invLoss = 1 - inverter.efficiency_pct / 100;
    return 1 - (1 - invLoss) * (1 - otherBosLosses);
  }
  return otherBosLosses + 0.03;
}

/**
 * Calcola l'energia annua stimata per un layout manuale di pannelli,
 * considerando ombreggiatura, derating termico, perdite di sistema
 * e l'irradianza specifica della falda su cui è posizionato ogni pannello.
 *
 * @param {Array} panels - Array di pannelli con { position: [x, y, z], irradiance_factor?, source?, effective_azimuth?, effective_tilt? }
 * @param {Object} specs - { width, height, efficiency, power, temp_coefficient?, noct_temperature? }
 * @param {Object} solar - { irradiance?: { annual_total, per_surface? }, shadows?: { shadow_grid, grid_bounds } }
 * @param {number} systemLosses - Perdite BOS/cablaggio/inverter (0-1), default 0.14
 * @param {Object} [building] - Stato building (per determinare la falda di ogni pannello)
 * @param {number} [buildingAzimuth] - Azimuth edificio (conv. pvlib)
 * @returns {number} Energia annua stimata in kWh
 */
export function computeManualEnergy(panels, specs, solar, systemLosses = 0.14) {
  const annualIrradiance = solar.irradiance?.annual_total || 1700;
  const perSurface = solar.irradiance?.per_surface || null;
  const shadowGrid = solar.shadows?.shadow_grid || null;
  const gridBounds = solar.shadows?.grid_bounds || null;
  const panelArea = specs.width * specs.height;

  // Build face → irradiance map from per_surface data
  const faceIrrMap = {};
  if (perSurface) {
    for (const s of perSurface) {
      faceIrrMap[s.face] = s.annual_total;
    }
  }

  // Derating termico annuo: T_cell ≈ NOCT (temperatura operativa tipica)
  const tempCoeff = specs.temp_coefficient ?? -0.4; // %/°C
  const noct = specs.noct_temperature ?? 45.0; // °C
  const tempDerating = Math.max(0.5, Math.min(1.0, 1 + (tempCoeff / 100) * (noct - 25)));

  const grossEnergy = panels.reduce((sum, panel) => {
    let irrFactor = 1.0;

    // Per pannelli adottati dall'ottimizzazione, usa direttamente l'irradiance_factor del backend
    if (panel.source === 'adopted' && panel.irradiance_factor != null) {
      irrFactor = panel.irradiance_factor;
    } else if (shadowGrid && gridBounds) {
      const rows = shadowGrid.length;
      const cols = shadowGrid[0].length;
      const col = Math.round(
        ((panel.position[0] - gridBounds.min_x) / (gridBounds.max_x - gridBounds.min_x)) * (cols - 1)
      );
      const row = Math.round(
        ((panel.position[2] - gridBounds.min_z) / (gridBounds.max_z - gridBounds.min_z)) * (rows - 1)
      );
      const clampedRow = Math.max(0, Math.min(rows - 1, row));
      const clampedCol = Math.max(0, Math.min(cols - 1, col));
      irrFactor = Math.max(0, 1.0 - shadowGrid[clampedRow][clampedCol]);
    }

    // Determine per-panel irradiance based on its face/orientation
    let panelIrradiance = annualIrradiance;
    if (perSurface && perSurface.length > 1) {
      // Try to match panel to its face using effective_azimuth/tilt
      const pAz = panel.effective_azimuth ?? panel.effectiveAzimuth;
      const pTilt = panel.effective_tilt ?? panel.effectiveTilt;
      if (pAz != null) {
        let bestFace = null;
        let bestDist = Infinity;
        for (const s of perSurface) {
          const d = Math.abs(s.azimuth - pAz) + Math.abs(s.tilt - (pTilt ?? 0));
          if (d < bestDist) { bestDist = d; bestFace = s.face; }
        }
        if (bestFace && faceIrrMap[bestFace] != null) {
          panelIrradiance = faceIrrMap[bestFace];
        }
      } else if (panel.face) {
        // Direct face label (from adopted panels)
        if (faceIrrMap[panel.face] != null) {
          panelIrradiance = faceIrrMap[panel.face];
        }
      }
    }

    return sum + irrFactor * specs.efficiency * panelArea * panelIrradiance * tempDerating;
  }, 0);

  return grossEnergy * (1 - systemLosses);
}
