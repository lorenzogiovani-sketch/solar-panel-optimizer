import React, { useState } from 'react';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import useStore from '../../store/useStore';
import { computeManualEnergy, computeTotalLosses } from '../../utils/energy';
import { computeRoofSurfaces } from '../../utils/roofGeometry';
import { API_BASE_URL } from '../../utils/api';

export function buildExportPayload(state) {
  const { optimization, solar, project, building, panels: panelsState,
          inverter, stringing, economic } = state;
  const { panels, panelSpecs, result, viewMode } = optimization;

  const isOptimized = viewMode === 'optimized' && result;
  const totalPanels = isOptimized ? result.total_panels : panels.length;
  const peakPowerKW = isOptimized
    ? (result.total_power_kw ?? (totalPanels * panelSpecs.power) / 1000)
    : (totalPanels * panelSpecs.power) / 1000;

  const annualIrradiance = solar.irradiance?.annual_total || 1700;

  let annualEnergyKWh;
  if (isOptimized) {
    annualEnergyKWh = result.total_energy_kwh || 0;
  } else if (optimization.adoptedEnergyKwh != null && panels.length > 0 && panels.every((p) => p.source === 'adopted')) {
    annualEnergyKWh = optimization.adoptedEnergyKwh;
  } else {
    const totalLosses = computeTotalLosses(
      optimization.otherBosLosses ?? 0.11,
      inverter?.datasheets ?? [],
      inverter?.selectedId ?? null,
    );
    annualEnergyKWh = computeManualEnergy(panels, panelSpecs, solar, totalLosses);
  }

  const co2Avoided = annualEnergyKWh * 0.4;
  const improvementPct = result?.improvement_pct ?? 0;
  const specificYield = peakPowerKW > 0 ? annualEnergyKWh / peakPowerKW : 0;

  // Pannello selezionato dal catalogo (per dati elettrici aggiuntivi)
  const selectedPanel = panelsState?.selectedIds?.length > 0
    ? panelsState.datasheets.find((d) => d.id === panelsState.selectedIds[0])
    : null;

  // Inverter selezionato
  const selectedInverter = inverter?.selectedId
    ? inverter.datasheets.find((d) => d.id === inverter.selectedId)
    : null;

  const payload = {
    simulation_results: {
      annual_irradiance: annualIrradiance,
      annual_energy_kwh: annualEnergyKWh,
      peak_power_kw: peakPowerKW,
      num_panels: totalPanels,
      co2_avoided_kg: co2Avoided,
      improvement_pct: improvementPct,
    },
    project_info: (() => {
      const effBuildingAz = ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360;
      let tilt = project.tilt;
      let azimuth = effBuildingAz;
      if (!building.importedMesh && (building.roofType === 'gable' || building.roofType === 'hip')) {
        const surfaces = computeRoofSurfaces(building, effBuildingAz);
        const dominant = surfaces.reduce((a, b) => a.weight >= b.weight ? a : b);
        tilt = dominant.tilt;
        azimuth = dominant.azimuth;
      }
      return {
        latitude: project.latitude,
        longitude: project.longitude,
        tilt,
        azimuth,
        panel_type: `Monocristallino ${panelSpecs.power}W`,
      };
    })(),
    monthly_irradiance: solar.irradiance?.monthly_totals || null,
    panel_specs: {
      constructor: panelSpecs.constructor || '',
      model: panelSpecs.model || '',
      power: panelSpecs.power || 0,
      efficiency: panelSpecs.efficiency || 0,
      width: panelSpecs.width || 0,
      height: panelSpecs.height || 0,
      temp_coefficient: panelSpecs.temp_coefficient || 0,
      warranty_years: panelSpecs.warranty_years || 0,
      weight_kg: selectedPanel?.weight_kg || null,
      degradation_pct: selectedPanel?.degradation_pct || panelSpecs.degradation_pct || null,
      voc_v: selectedPanel?.voc_v || null,
      isc_a: selectedPanel?.isc_a || null,
      vmpp_v: selectedPanel?.vmpp_v || null,
      impp_a: selectedPanel?.impp_a || null,
    },
    panels_layout: panels.map((p, idx) => ({
      x: p.x,
      z: p.z,
      orientation: p.orientation || 'portrait',
      string_id: p.string_id ?? null,
    })),
    kpi: {
      total_panels: totalPanels,
      peak_power_kw: peakPowerKW,
      annual_energy_kwh: annualEnergyKWh,
      specific_yield: specificYield,
    },
    building_width: building?.width || 10,
    building_depth: building?.depth || 10,
  };

  // Building info
  if (building) {
    payload.building_info = {
      roof_type: building.roofType || 'flat',
      roof_angle: building.roofAngle || 0,
      ridge_height: building.ridgeHeight || 0,
      width: building.width || 10,
      depth: building.depth || 10,
      height: building.height || 3,
      model_rotation_y: building.modelRotationY || 0,
    };
  }

  // Obstacles
  if (building?.obstacles?.length > 0) {
    payload.obstacles = building.obstacles.map((o) => ({
      type: o.type || 'box',
      position: o.position || [0, 0, 0],
      dimensions: o.dimensions || [1, 1, 1],
    }));
  }

  // Inverter specs
  if (selectedInverter) {
    payload.inverter_specs = {
      constructor: selectedInverter.constructor || '',
      model: selectedInverter.model || '',
      power_kw: selectedInverter.power_kw || 0,
      max_dc_power_kw: selectedInverter.max_dc_power_kw || 0,
      mppt_channels: selectedInverter.mppt_channels || 1,
      mppt_voltage_min_v: selectedInverter.mppt_voltage_min_v || 0,
      mppt_voltage_max_v: selectedInverter.mppt_voltage_max_v || 0,
      efficiency_pct: selectedInverter.efficiency_pct || 0,
    };
  }

  // Stringing
  if (stringing?.result) {
    payload.stringing = {
      panels_per_string: stringing.result.panels_per_string || 0,
      strings_per_mppt: stringing.result.strings_per_mppt || 0,
      mppt_used: stringing.result.mppt_used || 0,
      total_panels_used: stringing.result.total_panels_used || 0,
      dc_power_kw: stringing.result.dc_power_kw || 0,
      voc_max_v: stringing.result.voc_max_v || 0,
      vmpp_min_v: stringing.result.vmpp_min_v || 0,
      vmpp_max_v: stringing.result.vmpp_max_v || 0,
      dc_ac_ratio: stringing.result.dc_ac_ratio || 0,
      compatible: stringing.result.compatible ?? true,
      status: stringing.result.status || 'ok',
    };
  }

  // Economic data
  if (economic) {
    payload.economic = {
      cost_per_kwp: economic.systemCost_eur
        ? economic.systemCost_eur / (peakPowerKW || 1)
        : 1500,
      energy_price_kwh: economic.energyPrice_eur || 0.25,
      self_consumption_pct: 70,
      incentives: 0,
    };
  }

  return payload;
}

export async function downloadFile(url, payload, filename) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Export failed: ${response.status}`);
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Delay cleanup to ensure download starts
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }, 150);
}

const ExportButtons = () => {
  const state = useStore();
  const { optimization } = state;
  const { panels, result } = optimization;

  const [csvLoading, setCsvLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [error, setError] = useState(null);

  const hasData = panels.length > 0 || result != null;

  const handleExportCSV = async () => {
    setCsvLoading(true);
    setError(null);
    try {
      const payload = buildExportPayload(state);
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await downloadFile(
        `${API_BASE_URL}/export/csv`,
        payload,
        `solar_report_${today}.csv`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setCsvLoading(false);
    }
  };

  const handleExportPDF = async () => {
    setPdfLoading(true);
    setError(null);
    try {
      const payload = buildExportPayload(state);
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await downloadFile(
        `${API_BASE_URL}/export/pdf`,
        payload,
        `solar_report_${today}.pdf`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleExportHourlyCsv = async () => {
    setHourlyLoading(true);
    setError(null);
    try {
      const { project, building, optimization, solar, inverter } = state;
      const { panelSpecs, panels } = optimization;
      const totalPanels = optimization.viewMode === 'optimized' && optimization.result
        ? optimization.result.total_panels
        : panels.length;
      const selectedInverter = inverter?.selectedId
        ? inverter.datasheets.find((d) => d.id === inverter.selectedId)
        : null;
      // system_losses = solo perdite BOS (senza inverter), perché il backend
      // applica separatamente inverter_efficiency_pct per la distinzione DC/AC.
      // Se nessun inverter è selezionato, aggiungiamo 3% come stima generica.
      const bosLosses = optimization.otherBosLosses ?? 0.11;

      // Calcola annual_energy_kwh con ombre (stessa logica della dashboard)
      const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
      const allAdopted = !isOptimized && optimization.adoptedEnergyKwh != null
        && panels.length > 0 && panels.every((p) => p.source === 'adopted');
      let annualEnergyKWh;
      if (isOptimized) {
        annualEnergyKWh = optimization.result.total_energy_kwh || 0;
      } else if (allAdopted) {
        annualEnergyKWh = optimization.adoptedEnergyKwh;
      } else {
        const totalLosses = computeTotalLosses(bosLosses, inverter?.datasheets ?? [], inverter?.selectedId ?? null);
        annualEnergyKWh = computeManualEnergy(panels, panelSpecs, solar, totalLosses);
      }

      const effBuildingAz = ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360;
      let effectiveTilt = project.tilt;
      let effectiveAzimuth = effBuildingAz;
      if (!building.importedMesh && (building.roofType === 'gable' || building.roofType === 'hip')) {
        const surfaces = computeRoofSurfaces(building, effBuildingAz);
        const dominant = surfaces.reduce((a, b) => a.weight >= b.weight ? a : b);
        effectiveTilt = dominant.tilt;
        effectiveAzimuth = dominant.azimuth;
      }

      // Raggruppa pannelli per effective_tilt/effective_azimuth (per-falda)
      let panelGroups = undefined;
      const allPanels = isOptimized ? optimization.result.panels : panels;
      if (allPanels && allPanels.length > 0) {
        const groupsMap = {};
        for (const p of allPanels) {
          const t = p.effective_tilt ?? effectiveTilt;
          const a = p.effective_azimuth ?? effectiveAzimuth;
          const key = `${t.toFixed(1)}_${a.toFixed(1)}`;
          if (!groupsMap[key]) groupsMap[key] = { tilt: t, azimuth: a, count: 0 };
          groupsMap[key].count++;
        }
        const groups = Object.values(groupsMap);
        if (groups.length > 1) {
          panelGroups = groups;
        }
      }

      const payload = {
        latitude: project.latitude,
        longitude: project.longitude,
        tilt: effectiveTilt,
        azimuth: effectiveAzimuth,
        timezone: project.timezone || 'Europe/Rome',
        panel_power_w: panelSpecs.power || 400,
        efficiency: panelSpecs.efficiency || 0.2,
        temp_coefficient: panelSpecs.temp_coefficient || -0.4,
        num_panels: totalPanels || 1,
        system_losses: selectedInverter ? bosLosses : bosLosses + 0.03,
        noct_temperature: 45.0,
        year: new Date().getFullYear(),
        inverter_efficiency_pct: selectedInverter?.efficiency_pct || 100.0,
        inverter_model: selectedInverter
          ? `${selectedInverter.constructor || ''} ${selectedInverter.model || ''}`.trim()
          : '',
        inverter_power_kw: selectedInverter?.power_kw || 0.0,
        annual_energy_kwh: annualEnergyKWh > 0 ? annualEnergyKWh : null,
        panel_groups: panelGroups,
      };
      if (state.economic?.hourlyConsumption_kWh && state.economic?.consumptionMode === 'hourly') {
        payload.hourly_consumption_kwh = state.economic.hourlyConsumption_kWh;
      }
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await downloadFile(
        `${API_BASE_URL}/export/csv-hourly`,
        payload,
        `solar_hourly_${today}.csv`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setHourlyLoading(false);
    }
  };

  if (!hasData) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExportCSV}
        disabled={csvLoading}
        className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-medium
          bg-slate-800/50 border border-slate-700 text-slate-300 hover:bg-slate-700/50 hover:text-white
          disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {csvLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        CSV
      </button>
      <button
        onClick={handleExportPDF}
        disabled={pdfLoading}
        className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-medium
          bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300
          disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        Report PDF
      </button>
      <button
        onClick={handleExportHourlyCsv}
        disabled={hourlyLoading}
        className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-medium
          bg-teal-500/10 border border-teal-500/20 text-teal-400 hover:bg-teal-500/20 hover:text-teal-300
          disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        title="8760 righe — dati orari annuali"
      >
        {hourlyLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        Dati orari CSV
      </button>
      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
};

export default ExportButtons;
