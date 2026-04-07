import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import { computeManualEnergy } from '../../utils/energy';
import { computeRoofSurfaces } from '../../utils/roofGeometry';
import { parseNumericInput, parseIntInput } from '../../utils/inputUtils';
import ComputationTimer from '../layout/ComputationTimer';
import InfoTooltip from '../layout/InfoTooltip';
import { computeTotalLosses } from '../../utils/energy';
import StringingCard from './StringingCard';
import { buildExportPayload, downloadFile } from '../dashboard/ExportButtons';
import { API_BASE_URL } from '../../utils/api';
import PowerSurface3D from '../dashboard/PowerSurface3D';
import { MONTHLY_DISTRIBUTION, MONTH_COLORS } from '../../utils/constants';
import {
  BarChart, Bar, Cell, LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const ACCENT = '#8B5E3C';
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const sLabel = { fontSize: 9, fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text3)', margin: 0 };
const inputStyle = {
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
  fontFamily: "'JetBrains Mono', monospace",
  color: 'var(--text1)',
  outline: 'none',
  width: '100%',
};

const ResultsCard = ({ onClose }) => {
  const { t } = useTranslation();
  const MONTH_LABELS = t('common.months_short', { returnObjects: true });
  const { optimization, solar, panels, dailySimulation, setDailySimulation, fetchDailySimulation, setCurrentDay, setViewMode, economic, setEconomicParams, fetchEconomics, inverter, applyMultiResult, generateAnnualSurface, resetSurface } = useStore();
  const state = useStore.getState();
  const [showEconomics, setShowEconomics] = useState(true);
  const [surfaceExpanded, setSurfaceExpanded] = useState(true);
  const [selectedCurve, setSelectedCurve] = useState('power_w');

  const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
  const result = optimization.result;
  const specs = optimization.panelSpecs;

  /* ── KPI Calculations ── */
  const totalPanels = isOptimized ? (result?.total_panels || 0) : optimization.panels.length;
  const peakPowerKW = isOptimized
    ? (result?.total_power_kw ?? (totalPanels * specs.power) / 1000)
    : (totalPanels * specs.power) / 1000;

  // Compute effective irradiance based on actual panel placement
  // When panels are on a specific face (e.g. south-facing), use that face's irradiance
  // instead of the building-wide weighted average
  const annualIrradiance = useMemo(() => {
    const perSurface = solar.irradiance?.per_surface;
    const panels = isOptimized ? result?.panels : optimization.panels;
    if (!perSurface || !panels || panels.length === 0) {
      return solar.irradiance?.annual_total || 1700;
    }
    // Build face → irradiance map
    const faceIrrMap = {};
    for (const s of perSurface) faceIrrMap[s.face] = s.annual_total;
    // Match each panel to its face's irradiance via effective_azimuth
    let totalIrr = 0;
    let count = 0;
    for (const p of panels) {
      const az = p.effective_azimuth ?? p.effectiveAzimuth;
      const tilt = p.effective_tilt ?? p.effectiveTilt;
      if (az == null) { totalIrr += solar.irradiance?.annual_total || 1700; count++; continue; }
      // Find best matching surface
      let bestFace = null;
      let bestDist = Infinity;
      for (const s of perSurface) {
        const d = Math.abs(s.azimuth - az) + Math.abs(s.tilt - (tilt ?? 0));
        if (d < bestDist) { bestDist = d; bestFace = s.face; }
      }
      totalIrr += bestFace ? (faceIrrMap[bestFace] ?? solar.irradiance.annual_total) : solar.irradiance.annual_total;
      count++;
    }
    return count > 0 ? totalIrr / count : (solar.irradiance?.annual_total || 1700);
  }, [solar.irradiance, isOptimized, result?.panels, optimization.panels]);

  const allAdopted = !isOptimized && optimization.adoptedEnergyKwh != null
    && optimization.panels.length > 0
    && optimization.panels.every((p) => p.source === 'adopted');
  const annualEnergyKWh = isOptimized
    ? (result?.total_energy_kwh || 0)
    : allAdopted
      ? optimization.adoptedEnergyKwh
      : computeManualEnergy(
          optimization.panels,
          specs,
          solar,
          computeTotalLosses(optimization.otherBosLosses ?? 0.11, inverter?.datasheets ?? [], inverter?.selectedId ?? null)
        );

  const specificYield = peakPowerKW > 0 ? annualEnergyKWh / peakPowerKW : 0;
  /* ── Monthly data ── */
  const monthlyData = MONTH_LABELS.map((label, i) => ({
    name: label,
    kwh: Math.round(annualEnergyKWh * MONTHLY_DISTRIBUTION[i]),
    fill: MONTH_COLORS[i],
  }));

  /* ── Daily simulation data ── */
  const hourlyData = dailySimulation.data?.hourly?.filter((h) => h.solar_elevation > 0) || [];

  /* ── Export ── */
  const [hourlyLoading, setHourlyLoading] = useState(false);

  const handleExportPDF = async () => {
    try {
      const payload = buildExportPayload(state);
      await downloadFile(`${API_BASE_URL}/export/pdf`, payload, 'solar_report.pdf');
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleExportHourlyCsv = async () => {
    setHourlyLoading(true);
    try {
      const { project, building, optimization: opt, inverter: inv } = state;
      const { panelSpecs: ps, panels: pnls } = opt;
      const np = opt.viewMode === 'optimized' && opt.result ? opt.result.total_panels : pnls.length;
      const selectedInverter = inv?.selectedId
        ? inv.datasheets.find((d) => d.id === inv.selectedId)
        : null;
      // system_losses = solo perdite BOS (senza inverter), perché il backend
      // applica separatamente inverter_efficiency_pct per la distinzione DC/AC.
      // Se nessun inverter è selezionato, aggiungiamo 3% come stima generica.
      const bosLosses = opt.otherBosLosses ?? 0.11;
      const effBuildingAz = ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360;
      let effectiveTilt = project.tilt;
      let effectiveAzimuth = effBuildingAz;
      if (!building.importedMesh && (building.roofType === 'gable' || building.roofType === 'hip')) {
        const surfaces = computeRoofSurfaces(building, effBuildingAz);
        const dominant = surfaces.reduce((a, b) => a.weight >= b.weight ? a : b);
        effectiveTilt = dominant.tilt;
        effectiveAzimuth = dominant.azimuth;
      }
      const payload = {
        latitude: project.latitude,
        longitude: project.longitude,
        tilt: effectiveTilt,
        azimuth: effectiveAzimuth,
        timezone: project.timezone || 'Europe/Rome',
        panel_power_w: ps.power || 400,
        efficiency: ps.efficiency || 0.2,
        temp_coefficient: ps.temp_coefficient || -0.4,
        num_panels: np || 1,
        system_losses: selectedInverter ? bosLosses : bosLosses + 0.03,
        noct_temperature: 45.0,
        year: new Date().getFullYear(),
        inverter_efficiency_pct: selectedInverter?.efficiency_pct || 100.0,
        inverter_model: selectedInverter
          ? `${selectedInverter.constructor || ''} ${selectedInverter.model || ''}`.trim()
          : '',
        inverter_power_kw: selectedInverter?.power_kw || 0.0,
        // annualEnergyKWh è già calcolato sopra con ombre incluse
        annual_energy_kwh: annualEnergyKWh > 0 ? annualEnergyKWh : null,
      };
      // Includi profilo consumo orario nel CSV se caricato
      if (economic?.hourlyConsumption_kWh && economic?.consumptionMode === 'hourly') {
        payload.hourly_consumption_kwh = economic.hourlyConsumption_kWh;
      }
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await downloadFile(`${API_BASE_URL}/export/csv-hourly`, payload, `solar_hourly_${today}.csv`);
    } catch (err) {
      console.error('Hourly CSV export failed:', err);
    } finally {
      setHourlyLoading(false);
    }
  };

  /* ── Multi-panel comparison ── */
  const multiResults = panels.multiResults;

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '5%',
        right: '5%',
        maxHeight: '70vh',
        overflowY: 'auto',
        borderRadius: 16,
        background: 'var(--glass-hi)',
        border: '1px solid var(--border-hi)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 24px 80px rgba(100,60,20,0.2)',
        zIndex: 200,
        animation: 'results-reveal 0.4s cubic-bezier(0.4,0,0.2,1) forwards',
        fontFamily: "'Outfit', sans-serif",
        padding: 24,
      }}
    >
      <style>{`
        @keyframes results-reveal {
          from { opacity: 0; transform: translateY(-20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📊</span> {t('results.heading')}
        </h2>
        <button
          onClick={onClose}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            width: 32,
            height: 32,
            cursor: 'pointer',
            color: 'var(--text2)',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* No data state */}
      {totalPanels === 0 && !result && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text3)' }}>
          <p style={{ fontSize: 13, margin: 0 }}>{t('results.no_result')}</p>
          <p style={{ fontSize: 11, margin: '8px 0 0', color: 'var(--text3)' }}>
            {t('results.no_result_hint')}
          </p>
        </div>
      )}

      {/* Main grid */}
      {(totalPanels > 0 || result) && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 1fr', gap: 20 }}>
          {/* ── Colonna 1: KPI ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={sLabel}>{t('results.kpi_title')}</p>
            <KpiRow label={<><span>{t('results.installed_power')}</span><InfoTooltip textKey="tooltips.installed_power" /></>} value={peakPowerKW.toFixed(2)} unit="kWp" accent={ACCENT} />
            <KpiRow label={<><span>{t('results.panel_count')}</span><InfoTooltip textKey="tooltips.panel_count" /></>} value={totalPanels} unit="" accent="#B85C35" />
            <KpiRow label={<><span>{t('results.annual_production')}</span><InfoTooltip textKey="tooltips.annual_production" /></>} value={Math.round(annualEnergyKWh).toLocaleString()} unit="kWh" accent="#E08C1A" />
            <KpiRow label={<><span>{t('results.specific_yield')}</span><InfoTooltip textKey="tooltips.specific_yield" /></>} value={Math.round(specificYield)} unit="kWh/kWp" accent="#D97757" />

            {result?.improvement_pct > 0 && (
              <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(184,92,53,0.08)', border: '1px solid rgba(184,92,53,0.2)', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: '#B85C35', fontWeight: 600 }}>
                  {t('results.improvement', { pct: result.improvement_pct.toFixed(1) })}
                </span>
              </div>
            )}
          </div>

          {/* ── Colonna 2: Produzione Mensile ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ ...sLabel, display: 'flex', alignItems: 'center', gap: 4 }}>{t('results.monthly_title')}<InfoTooltip textKey="tooltips.monthly_production_chart" /></p>
            <div style={{ flex: 1, minHeight: 180 }}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(160,105,55,0.15)" />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text1)' }}
                    formatter={(v) => [`${v} kWh`, t('results.production_tooltip')]}
                  />
                  <Bar dataKey="kwh" radius={[3, 3, 0, 0]}>
                    {monthlyData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Multi-panel comparison — full section */}
            {multiResults && multiResults.length > 0 && (
              <ComparisonSection
                multiResults={multiResults}
                applyMultiResult={applyMultiResult}
                t={t}
                sLabel={sLabel}
                monthLabels={MONTH_LABELS}
              />
            )}

            {/* Irradianza Mensile */}
            {solar.irradiance?.monthly_totals && (() => {
              const irradianceData = MONTH_LABELS.map((label, i) => ({
                name: label,
                kwh_m2: solar.irradiance.monthly_totals[MONTH_NAMES_EN[i]] ?? 0,
              }));
              return (
                <>
                  <p style={{ ...sLabel, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>{t('results.irradiance_title')}<InfoTooltip textKey="tooltips.monthly_irradiance_chart" /></p>
                  <div style={{ minHeight: 180 }}>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={irradianceData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(160,105,55,0.15)" />
                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} label={{ value: 'kWh/m²', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: 'var(--text3)' }, offset: 20 }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text1)' }}
                          formatter={(v) => [`${v.toFixed(1)} kWh/m²`, t('results.irradiance_tooltip')]}
                        />
                        <Bar dataKey="kwh_m2" radius={[3, 3, 0, 0]}>
                          {irradianceData.map((_, i) => (
                            <Cell key={i} fill="#E08C1A" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              );
            })()}
          </div>

          {/* ── Colonna 3: Simulazione Giornaliera ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ ...sLabel, display: 'flex', alignItems: 'center', gap: 4 }}>{t('results.daily_title')}<InfoTooltip textKey="tooltips.daily_simulation_chart" /></p>

            {/* Selettore mese/giorno */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={dailySimulation.simMonth}
                onChange={(e) => setDailySimulation({ simMonth: parseInt(e.target.value) })}
                style={{
                  flex: 1,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: 'var(--text1)',
                  outline: 'none',
                }}
              >
                {MONTH_LABELS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={31}
                value={dailySimulation.simDay}
                onChange={(e) => setDailySimulation({ simDay: parseIntInput(e.target.value) })}
                style={{
                  width: 48,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: 'var(--text1)',
                  outline: 'none',
                  textAlign: 'center',
                }}
              />
              <button
                onClick={fetchDailySimulation}
                disabled={dailySimulation.isLoading}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #E08C1A',
                  background: 'rgba(224,140,26,0.08)',
                  color: '#E08C1A',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: dailySimulation.isLoading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {dailySimulation.isLoading ? '⏳' : `↻ ${t('results.refresh')}`}
              </button>
              <button
                onClick={setCurrentDay}
                disabled={dailySimulation.isLoading}
                title={t('simulation.current_day')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #4F9CF9',
                  background: 'rgba(79,156,249,0.08)',
                  color: '#4F9CF9',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: dailySimulation.isLoading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                📅 {t('simulation.current_day')}
              </button>
            </div>

            {hourlyData.length > 0 ? (
              <div style={{ flex: 1, minHeight: 180 }}>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={hourlyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(160,105,55,0.15)" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text1)' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload || {};
                        return (
                          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 10, color: 'var(--text1)', lineHeight: 1.7 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                            <div style={{ color: '#FFB547' }}>{t('results.ideal_power')}: {Math.round(d.power_clearsky_w ?? 0)} W</div>
                            <div style={{ color: '#FF8C00' }}>{t('results.after_thermal')}: {Math.round(d.power_ideal_w ?? 0)} W</div>
                            <div style={{ color: '#2DD4BF' }}>{t('results.actual_power')}: {Math.round(d.power_w ?? 0)} W</div>
                            <div style={{ color: 'var(--text3)', marginTop: 2 }}>{t('results.thermal_losses')}: {(d.temp_loss_pct ?? 0).toFixed(1)}%</div>
                            <div style={{ color: 'var(--text3)' }}>{t('results.shading_losses')}: {(d.shading_loss_pct ?? 0).toFixed(1)}%</div>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="power_clearsky_w" fill="rgba(255,181,71,0.15)" stroke="#FFB547" strokeWidth={1.5} dot={false} name={t('results.ideal_power')} />
                    <Line type="monotone" dataKey="power_ideal_w" stroke="#FF8C00" strokeDasharray="6 3" strokeWidth={1.5} dot={false} name={t('results.after_thermal')} />
                    <Area type="monotone" dataKey="power_w" fill="rgba(45,212,191,0.3)" stroke="#2DD4BF" strokeWidth={2} dot={false} name={t('results.actual_power')} />
                    <Legend iconType="line" wrapperStyle={{ fontSize: 9, color: 'var(--text3)' }} />
                  </ComposedChart>
                </ResponsiveContainer>
                {dailySimulation.data && (() => {
                  const thermalLossMean = hourlyData.length > 0
                    ? hourlyData.reduce((s, h) => s + (h.temp_loss_pct ?? 0), 0) / hourlyData.length
                    : 0;
                  const shadingLossMean = hourlyData.length > 0
                    ? hourlyData.reduce((s, h) => s + (h.shading_loss_pct ?? 0), 0) / hourlyData.length
                    : 0;
                  return (
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                      <MiniStat label={t('results.production_label')} value={`${dailySimulation.data.daily_kwh?.toFixed(2)} kWh`} />
                      <MiniStat label={t('results.peak_label')} value={`${Math.round(dailySimulation.data.peak_power_w || 0)} W`} />
                      <MiniStat label={t('results.sun_hours')} value={`${dailySimulation.data.sunshine_hours?.toFixed(1)}h`} />
                      <MiniStat label={t('results.thermal_losses')} value={`${thermalLossMean.toFixed(1)}%`} />
                      <MiniStat label={t('results.shading_losses')} value={`${shadingLossMean.toFixed(1)}%`} />
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 160, gap: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t('results.no_daily')}</span>
                {dailySimulation.error && (
                  <span style={{ fontSize: 10, color: '#F87171', maxWidth: 280, textAlign: 'center' }}>{dailySimulation.error}</span>
                )}
                <button
                  onClick={fetchDailySimulation}
                  disabled={dailySimulation.isLoading}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid #E08C1A',
                    background: 'rgba(224,140,26,0.08)',
                    color: '#E08C1A',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: dailySimulation.isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {dailySimulation.isLoading ? `⏳ ${t('results.simulating')}` : `☀ ${t('results.start_daily')}`}
                </button>
                <ComputationTimer
                  startTime={dailySimulation.startTime}
                  isRunning={dailySimulation.isLoading}
                  computationTime={dailySimulation.computationTime}
                  accentColor="#E08C1A"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mappa Annuale Potenza 3D ── */}
      {(totalPanels > 0 || result) && (
        <div style={{ marginTop: 12 }}>
          <div
            onClick={() => setSurfaceExpanded(!surfaceExpanded)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: surfaceExpanded ? 10 : 0 }}
          >
            <p style={{ ...sLabel, margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              {t('results.annual_surface_title')}
              <InfoTooltip textKey="tooltips.annual_surface" />
            </p>
            <span style={{ fontSize: 10, color: 'var(--text3)', transition: 'transform 0.3s', transform: surfaceExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>
          {surfaceExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!dailySimulation.surfaceData && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={generateAnnualSurface}
                    disabled={dailySimulation.surfaceStatus === 'running'}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid #A78BFA',
                      background: 'rgba(167,139,250,0.08)',
                      color: '#A78BFA',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: dailySimulation.surfaceStatus === 'running' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {dailySimulation.surfaceStatus === 'running' ? `${t('results.surface_generating')}` : t('results.generate_surface')}
                  </button>
                  {dailySimulation.surfaceStatus === 'running' && (
                    <span style={{ fontSize: 10, color: '#A78BFA' }}>{t('results.surface_generating')}</span>
                  )}
                  {dailySimulation.surfaceError && (
                    <span style={{ fontSize: 10, color: '#F87171' }}>{dailySimulation.surfaceError}</span>
                  )}
                </div>
              )}
              {dailySimulation.surfaceData && (
                <>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    {[
                      { key: 'power_w', label: t('results.actual_power') },
                      { key: 'power_ideal_w', label: t('results.after_thermal') },
                      { key: 'power_clearsky_w', label: t('results.ideal_power') },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setSelectedCurve(key)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 4,
                          border: `1px solid ${selectedCurve === key ? '#A78BFA' : 'var(--border)'}`,
                          background: selectedCurve === key ? 'rgba(167,139,250,0.15)' : 'transparent',
                          color: selectedCurve === key ? '#A78BFA' : 'var(--text3)',
                          fontSize: 9,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <PowerSurface3D data={dailySimulation.surfaceData} curveType={selectedCurve} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Analisi Economica ── */}
      {(totalPanels > 0 || result) && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: showEconomics ? 14 : 0 }}
            onClick={() => setShowEconomics((v) => !v)}
          >
            <p style={{ ...sLabel, margin: 0 }}>{t('results.economic_title')}</p>
            <span style={{ fontSize: 10, color: 'var(--text3)', transition: 'transform 0.3s', transform: showEconomics ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>

          {showEconomics && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Selettore modalità consumo */}
              <ConsumptionModeSelector
                economic={economic}
                setEconomicParams={setEconomicParams}
                inputStyle={inputStyle}
              />

              {/* Riga tariffe e costo impianto */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 110px', minWidth: 90 }}>
                  <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('results.tariff')}</label>
                  <input type="number" step={0.01} min={0.01} value={economic.energyPrice_eur}
                    onChange={(e) => setEconomicParams({ energyPrice_eur: parseNumericInput(e.target.value) })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: '0 1 110px', minWidth: 90 }}>
                  <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('results.feed_in_tariff')}</label>
                  <input type="number" step={0.01} min={0} value={economic.feedInTariff_eur}
                    onChange={(e) => setEconomicParams({ feedInTariff_eur: parseNumericInput(e.target.value) })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: '0 1 120px', minWidth: 100 }}>
                  <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('results.system_cost')}</label>
                  <input type="number" step={100} min={0}
                    value={economic.systemCost_eur ?? ''}
                    placeholder={t('results.optional')}
                    onChange={(e) => setEconomicParams({ systemCost_eur: e.target.value ? Number(e.target.value) : null })}
                    style={inputStyle}
                  />
                </div>
                <button
                  onClick={fetchEconomics}
                  disabled={economic.isLoading}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid #2DD4BF',
                    background: 'rgba(45,212,191,0.08)', color: '#2DD4BF',
                    fontSize: 11, fontWeight: 600, cursor: economic.isLoading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  {economic.isLoading ? '...' : t('results.calculate')}
                </button>
              </div>

              {/* KPI economici — riga orizzontale a tutta larghezza */}
              {economic.result && (
                <div style={{ display: 'grid', gridTemplateColumns: economic.result.payback_years != null ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 10 }}>
                  <KpiRow label={<><span>{t('results.bill_savings')}</span><InfoTooltip textKey="tooltips.annual_savings" /></>} value={`${economic.result.total_savings_eur.toFixed(0)}`} unit="EUR/anno" accent="#2DD4BF" />
                  <KpiRow label={<><span>{t('results.feed_in_revenue')}</span><InfoTooltip textKey="tooltips.grid_feed_in" /></>} value={`${economic.result.total_revenue_eur.toFixed(0)}`} unit="EUR/anno" accent="#4F9CF9" />
                  <KpiRow label={<><span>{t('results.self_consumption')}</span><InfoTooltip textKey="tooltips.self_consumption_rate" /></>} value={`${economic.result.self_consumption_rate_pct.toFixed(0)}`} unit="%" accent="#FFB547" />
                  {economic.result.payback_years != null && (
                    <KpiRow label={<><span>{t('results.payback')}</span><InfoTooltip textKey="tooltips.payback_period" /></>} value={`${economic.result.payback_years.toFixed(1)}`} unit={t('results.years')} accent="#A78BFA" />
                  )}
                </div>
              )}

              {/* Grafico mensile autoconsumo */}
              {economic.result && (
                <div>
                  <p style={{ ...sLabel, marginBottom: 8 }}>{t('results.energy_balance_title')}</p>
                  <div style={{ minHeight: 220 }}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={economic.result.monthly.map((m) => ({
                          name: MONTH_LABELS[m.month - 1],
                          autoconsumo: Math.round(m.self_consumed_kwh),
                          immesso: Math.round(m.fed_in_kwh),
                          da_rete: Math.round(m.grid_consumed_kwh),
                        }))}
                        margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(160,105,55,0.15)" />
                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text1)' }}
                          formatter={(v, name) => [`${v} kWh`, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <Bar dataKey="autoconsumo" stackId="a" fill="#2DD4BF" radius={[0, 0, 0, 0]} name={t('results.self_consumed')} />
                        <Bar dataKey="immesso" stackId="a" fill="#4F9CF9" radius={[3, 3, 0, 0]} name={t('results.grid_export')} />
                        <Bar dataKey="da_rete" fill="#F87171" radius={[3, 3, 0, 0]} name={t('results.grid_import')} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
                    <MiniStat label={t('results.self_sufficiency')} value={`${economic.result.self_sufficiency_rate_pct.toFixed(0)}%`} />
                    <MiniStat label={t('results.total_savings')} value={`${(economic.result.total_savings_eur + economic.result.total_revenue_eur).toFixed(0)} EUR/anno`} />
                    <MiniStat label={t('results.grid_feed')} value={`${economic.result.total_fed_in_kwh.toFixed(0)} kWh`} />
                  </div>
                </div>
              )}

              {/* ── Analisi Profilo Consumo (solo modalità oraria) ── */}
              {economic.consumptionMode === 'hourly' && economic.result?.hourly_analysis && (
                <HourlyAnalysisSection analysis={economic.result.hourly_analysis} monthlyEconomics={economic.result.monthly} />
              )}

              {/* Placeholder se non ancora calcolato */}
              {!economic.result && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80, color: 'var(--text3)', fontSize: 11 }}>
                  {t('results.configure_hint')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dimensionamento Stringhe */}
      {(totalPanels > 0 || result) && <StringingCard />}

      {/* Footer */}
      {(totalPanels > 0 || result) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleExportPDF}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text1)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ↗ {t('results.export_pdf')}
          </button>
          <button
            onClick={handleExportHourlyCsv}
            disabled={hourlyLoading}
            title={t('results.hourly_csv_desc')}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid #2DD4BF',
              background: 'rgba(45,212,191,0.08)',
              color: '#2DD4BF',
              fontSize: 11,
              fontWeight: 600,
              cursor: hourlyLoading ? 'not-allowed' : 'pointer',
              opacity: hourlyLoading ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {hourlyLoading ? '⏳' : '↓'} {t('results.hourly_csv')}
          </button>
          {result && optimization.hasManualLayout && (
            <button
              onClick={() => setViewMode(isOptimized ? 'manual' : 'optimized')}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: isOptimized ? 'none' : `1px solid ${ACCENT}`,
                background: isOptimized ? ACCENT : 'transparent',
                color: isOptimized ? '#fff' : ACCENT,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isOptimized ? `⇄ ${t('results.show_manual')}` : `⇄ ${t('results.show_optimized')}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Sub-components ── */
const KpiRow = ({ label, value, unit, accent, sub }) => (
  <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--border)' }}>
    <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 2, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
      {unit && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{unit}</span>}
    </div>
    {sub && <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
  </div>
);

const MiniStat = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 8, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    <div style={{ fontSize: 11, color: 'var(--text1)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>{value}</div>
  </div>
);

/* ── Comparison Section ── */
const COMPARISON_COLORS = ['#4F9CF9', '#FFB547', '#2DD4BF', '#A78BFA'];

const ComparisonSection = ({ multiResults, applyMultiResult, t, sLabel, monthLabels }) => {
  const validResults = multiResults.filter((r) => r.result);
  if (validResults.length === 0) return null;

  // Build row data with computed metrics
  const rows = validResults.map((r) => {
    const res = r.result;
    const ds = r.panelData;
    const nPanels = res.total_panels || 0;
    const peakKw = res.total_power_kw ?? (nPanels * (ds?.power_w || 0)) / 1000;
    const energy = res.total_energy_kwh || res.total_annual_kwh || 0;
    const yld = peakKw > 0 ? energy / peakKw : 0;
    const panelArea = (ds?.width_m || 1) * (ds?.height_m || 1.7);
    const irr = 1700; // fallback
    const theoretical = nPanels * panelArea * irr * (ds?.efficiency_pct ? ds.efficiency_pct / 100 : 0.2);
    const pr = theoretical > 0 ? (energy / theoretical) * 100 : 0;
    const weight = nPanels * (ds?.weight_kg || 0);
    return {
      panelId: r.panelId,
      label: r.label,
      power_w: ds?.power_w || 0,
      efficiency: ds?.efficiency_pct || 0,
      nPanels,
      peakKw,
      energy,
      yld,
      pr,
      weight,
      monthlyProduction: res.monthly_production || null,
    };
  });

  // Find best (max) per column
  const bestIdx = {};
  ['energy', 'yld', 'pr', 'peakKw'].forEach((key) => {
    let best = -Infinity, idx = 0;
    rows.forEach((r, i) => { if (r[key] > best) { best = r[key]; idx = i; } });
    bestIdx[key] = idx;
  });
  // For weight, best = min (lighter)
  {
    let best = Infinity, idx = 0;
    rows.forEach((r, i) => { if (r.weight > 0 && r.weight < best) { best = r.weight; idx = i; } });
    bestIdx.weight = idx;
  }

  const mono = { fontFamily: "'JetBrains Mono', monospace" };
  const cellStyle = { padding: '5px 8px', fontSize: 10, borderTop: '1px solid var(--border)' };
  const headStyle = { ...cellStyle, background: 'var(--surface2)', color: 'var(--text3)', fontWeight: 600, borderTop: 'none' };
  const bestStyle = { color: 'var(--teal, #2DD4BF)', fontWeight: 700 };

  const cols = [
    { key: 'label', header: t('results.comparison_col_panel'), align: 'left' },
    { key: 'power_w', header: t('results.comparison_col_power_w'), align: 'right' },
    { key: 'efficiency', header: t('results.comparison_col_efficiency'), align: 'right' },
    { key: 'nPanels', header: t('results.comparison_col_n_panels'), align: 'right' },
    { key: 'peakKw', header: t('results.comparison_col_peak_kw'), align: 'right', fmt: (v) => v.toFixed(2) },
    { key: 'energy', header: t('results.comparison_col_energy'), align: 'right', fmt: (v) => Math.round(v).toLocaleString() },
    { key: 'yld', header: t('results.comparison_col_yield'), align: 'right', fmt: (v) => Math.round(v) },
    { key: 'pr', header: t('results.comparison_col_pr'), align: 'right', fmt: (v) => v.toFixed(1) },
    { key: 'weight', header: t('results.comparison_col_weight'), align: 'right', fmt: (v) => Math.round(v) },
  ];

  // Monthly chart data
  const hasMonthly = rows.some((r) => r.monthlyProduction && r.monthlyProduction.length === 12);
  const monthlyChartData = hasMonthly
    ? monthLabels.map((label, i) => {
        const entry = { name: label };
        rows.forEach((r, ri) => {
          entry[`p${ri}`] = r.monthlyProduction ? Math.round(r.monthlyProduction[i]) : 0;
        });
        return entry;
      })
    : null;

  return (
    <>
      <p style={{ ...sLabel, marginTop: 12 }}>{t('results.comparison_title')}</p>

      {/* Detailed table */}
      <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'auto', fontSize: 10, marginTop: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} style={{ ...headStyle, textAlign: c.align, whiteSpace: 'nowrap' }}>{c.header}</th>
              ))}
              <th style={{ ...headStyle, textAlign: 'center', width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.panelId}>
                {cols.map((c) => {
                  const raw = row[c.key];
                  const display = c.fmt ? c.fmt(raw) : raw;
                  const isBest = bestIdx[c.key] === ri && c.key !== 'label';
                  return (
                    <td key={c.key} style={{ ...cellStyle, textAlign: c.align, ...(c.key !== 'label' ? mono : {}), ...(isBest ? bestStyle : { color: 'var(--text1)' }) }}>
                      {display}
                    </td>
                  );
                })}
                <td style={{ ...cellStyle, textAlign: 'center' }}>
                  <button
                    onClick={() => applyMultiResult(row.panelId)}
                    title={t('results.comparison_view')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                      color: 'var(--text2)', fontSize: 14, lineHeight: 1,
                    }}
                  >
                    👁
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Monthly comparative bar chart */}
      {monthlyChartData && (
        <>
          <p style={{ ...sLabel, marginTop: 12 }}>{t('results.comparison_monthly_chart')}</p>
          <div style={{ minHeight: 180, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(160,105,55,0.15)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text1)' }}
                  formatter={(v, name) => {
                    const idx = parseInt(name.replace('p', ''), 10);
                    return [`${v} kWh`, rows[idx]?.label || name];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 9 }}
                  formatter={(value) => {
                    const idx = parseInt(value.replace('p', ''), 10);
                    return rows[idx]?.label || value;
                  }}
                />
                {rows.map((_, ri) => (
                  <Bar key={ri} dataKey={`p${ri}`} fill={COMPARISON_COLORS[ri % COMPARISON_COLORS.length]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </>
  );
};

/* ── Hourly Analysis Section ── */
const DAYLIGHT_HOURS = [9, 10, 12, 13, 14, 15, 15, 14, 12, 11, 10, 9];
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const HourlyAnalysisSection = ({ analysis, monthlyEconomics }) => {
  const { t } = useTranslation();
  const MONTH_LABELS = t('common.months_short', { returnObjects: true });
  const DAY_LABELS = t('common.days_short', { returnObjects: true });

  const ha = analysis;

  // Produzione media oraria stimata (distribuzione sulle ore diurne, stessa logica del backend)
  const avgProductionProfile = useMemo(() => {
    if (!monthlyEconomics) return null;
    const hourSums = new Array(24).fill(0);
    let totalDays = 0;
    for (let m = 0; m < 12; m++) {
      const prod = monthlyEconomics[m].production_kwh;
      const days = DAYS_PER_MONTH[m];
      const daylight = DAYLIGHT_HOURS[m];
      const sunrise = 12 - Math.floor(daylight / 2);
      const sunset = sunrise + daylight;
      const prodPerHour = daylight > 0 ? prod / (days * daylight) : 0;
      for (let h = 0; h < 24; h++) {
        if (h >= sunrise && h < sunset) {
          hourSums[h] += prodPerHour * days;
        }
      }
      totalDays += days;
    }
    return hourSums.map((v) => +(v / totalDays).toFixed(3));
  }, [monthlyEconomics]);

  // Dati grafico giornaliero
  const dailyProfileData = ha.daily_profile.map((v, h) => ({
    h: `${String(h).padStart(2, '0')}:00`,
    consumo: v,
    produzione: avgProductionProfile ? avgProductionProfile[h] : 0,
  }));

  // Dati grafico settimanale
  const weeklyData = ha.weekly_profile.map((v, i) => ({
    day: DAY_LABELS[i],
    kWh: v,
  }));

  // Dati grafico mensile (consumo vs produzione)
  const monthlyCompareData = ha.monthly_totals.map((cons, i) => ({
    name: MONTH_LABELS[i],
    consumo: Math.round(cons),
    produzione: monthlyEconomics ? Math.round(monthlyEconomics[i].production_kwh) : 0,
  }));

  // Dati grafico annuale (365 punti)
  const annualData = ha.daily_totals.map((v, i) => ({ day: i + 1, kWh: +v.toFixed(1) }));

  const chartTooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text1)' };
  const gridStroke = 'rgba(160,105,55,0.15)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text3)', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {t('results.consumption_analysis_title')}
        <InfoTooltip textKey="tooltips.consumption_analysis" />
      </p>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <KpiRow label={t('results.avg_daily_consumption')} value={ha.avg_daily_kwh.toFixed(1)} unit="kWh/d" accent="#2DD4BF" />
        <KpiRow label={t('results.avg_hourly_consumption')} value={ha.avg_hourly_kwh.toFixed(2)} unit="kWh/h" accent="#4F9CF9" />
        <KpiRow label={<><span>{t('results.peak_hourly')}</span></>} value={ha.peak_hourly_kw.toFixed(2)} unit="kW" accent="#F87171" sub={ha.peak_hour_label} />
        <KpiRow label={t('results.base_load')} value={ha.base_load_kw.toFixed(2)} unit="kW" accent="#A78BFA" />
        <KpiRow label={t('results.peak_to_avg')} value={ha.peak_to_avg_ratio.toFixed(1)} unit="×" accent="#FFB547" />
      </div>

      {/* Grafico 1 — Profilo Giornaliero Medio */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', margin: '0 0 6px 0' }}>
          {t('results.daily_profile_title')}
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={dailyProfileData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="h" tick={{ fontSize: 8, fill: 'var(--text3)' }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [`${v} kWh`, name === 'consumo' ? t('results.consumption_label') : t('results.production_label')]} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(val) => val === 'consumo' ? t('results.consumption_label') : t('results.production_label')} />
            <Area type="monotone" dataKey="consumo" stroke="#2DD4BF" fill="rgba(45,212,191,0.2)" strokeWidth={2} />
            {avgProductionProfile && (
              <Area type="monotone" dataKey="produzione" stroke="#FFB547" fill="rgba(255,181,71,0.15)" strokeWidth={2} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Grafico 2 — Profilo Settimanale Medio */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', margin: '0 0 6px 0' }}>
          {t('results.weekly_profile_title')}
        </p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={weeklyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${v} kWh`, t('results.consumption_label')]} />
            <Bar dataKey="kWh" fill="#4F9CF9" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Grafico 3 — Consumo vs Produzione Mensile */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', margin: '0 0 6px 0' }}>
          {t('results.monthly_consumption_title')}
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyCompareData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [`${v} kWh`, name === 'consumo' ? t('results.consumption_label') : t('results.production_label')]} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(val) => val === 'consumo' ? t('results.consumption_label') : t('results.production_label')} />
            <Bar dataKey="consumo" fill="#F87171" radius={[3, 3, 0, 0]} />
            <Bar dataKey="produzione" fill="#FFB547" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Grafico 4 — Andamento Annuale */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', margin: '0 0 6px 0' }}>
          {t('results.annual_trend_title')}
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={annualData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="day" tick={{ fontSize: 8, fill: 'var(--text3)' }} axisLine={false} tickLine={false} interval={29} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${v} kWh`, t('results.consumption_label')]} labelFormatter={(d) => `${t('results.consumption_label')} — ${t('common.day') || 'Day'} ${d}`} />
            <Line type="monotone" dataKey="kWh" stroke="#2DD4BF" strokeWidth={1} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/* ── Consumption Mode Selector ── */
const ConsumptionModeSelector = ({ economic, setEconomicParams, inputStyle }) => {
  const { t } = useTranslation();
  const CONSUMPTION_MODES = [
    { key: 'annual', label: t('results.consumption_annual'), icon: '∑' },
    { key: 'monthly', label: t('results.consumption_monthly'), icon: '📅' },
    { key: 'hourly', label: t('results.consumption_hourly'), icon: '⏱' },
  ];
  const ML = t('common.months_short', { returnObjects: true });
  const csvMonthlyRef = useRef(null);
  const csvHourlyRef = useRef(null);
  const [csvMsg, setCsvMsg] = useState(null);

  const mode = economic.consumptionMode;

  useEffect(() => {
    if (mode === 'monthly') {
      const total = economic.monthlyConsumption_kWh.reduce((a, b) => a + b, 0);
      if (total > 0 && Math.round(total) !== economic.annualConsumption_kWh) {
        setEconomicParams({ annualConsumption_kWh: Math.round(total) });
      }
    }
  }, [mode, economic.monthlyConsumption_kWh]);

  const monthlyTotal = useMemo(
    () => economic.monthlyConsumption_kWh.reduce((a, b) => a + b, 0),
    [economic.monthlyConsumption_kWh],
  );

  const hourlyProfile = useMemo(() => {
    if (!economic.hourlyConsumption_kWh) return null;
    const avg = new Array(24).fill(0);
    for (let i = 0; i < 8760; i++) avg[i % 24] += economic.hourlyConsumption_kWh[i];
    return avg.map((v, h) => ({ h: `${String(h).padStart(2, '0')}:00`, kWh: +(v / 365).toFixed(2) }));
  }, [economic.hourlyConsumption_kWh]);

  const hourlyTotal = useMemo(
    () => economic.hourlyConsumption_kWh ? economic.hourlyConsumption_kWh.reduce((a, b) => a + b, 0) : 0,
    [economic.hourlyConsumption_kWh],
  );

  const parseCSVValues = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const sample = lines.slice(0, 5);
    const sampleText = sample.join('\n');
    const hasSemicolon = sampleText.includes(';');
    const hasTab = sampleText.includes('\t');
    // Detect comma-as-decimal: lines have at most one comma, surrounded by digits (e.g. "0,523")
    const commaIsDecimal = !hasSemicolon && !hasTab && sample.every((l) => {
      const commas = (l.match(/,/g) || []).length;
      return commas <= 1 && (commas === 0 || /^\s*\d+,\d+\s*$/.test(l));
    });
    const values = [];
    for (const line of lines) {
      let parts;
      if (hasSemicolon) {
        parts = line.split(';');
      } else if (hasTab) {
        parts = line.split('\t');
      } else if (commaIsDecimal) {
        parts = [line];
      } else {
        parts = line.split(',');
      }
      for (const p of parts) {
        const cleaned = (hasSemicolon || commaIsDecimal) ? p.trim().replace(',', '.') : p.trim();
        const n = parseFloat(cleaned);
        if (!isNaN(n) && n >= 0) values.push(n);
      }
    }
    return values;
  };

  const handleMonthlyCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const values = parseCSVValues(ev.target.result);
        if (values.length >= 12) {
          const monthly = values.slice(0, 12);
          const total = monthly.reduce((a, b) => a + b, 0);
          setEconomicParams({ monthlyConsumption_kWh: monthly, annualConsumption_kWh: Math.round(total) });
          setCsvMsg({ ok: true, text: t('results.csv_loaded', { total: total.toLocaleString() }) });
        } else {
          setCsvMsg({ ok: false, text: t('results.csv_few_values', { count: values.length }) });
        }
      } catch {
        setCsvMsg({ ok: false, text: t('results.csv_parse_error') });
      }
      setTimeout(() => setCsvMsg(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleHourlyCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const values = parseCSVValues(ev.target.result);
        if (values.length >= 8760) {
          const data = values.slice(0, 8760);
          const total = data.reduce((a, b) => a + b, 0);
          if (total < 500 || total > 100000) {
            setCsvMsg({ ok: false, text: t('results.csv_out_of_range', { total: Math.round(total) }) });
          } else {
            setEconomicParams({ hourlyConsumption_kWh: data, hourlyFileName: file.name, annualConsumption_kWh: Math.round(total) });
            setCsvMsg({ ok: true, text: t('results.csv_hourly_loaded', { name: file.name, total: Math.round(total).toLocaleString() }) });
          }
        } else {
          setCsvMsg({ ok: false, text: t('results.csv_hourly_few_rows', { count: values.length }) });
        }
      } catch {
        setCsvMsg({ ok: false, text: t('results.csv_parse_error') });
      }
      setTimeout(() => setCsvMsg(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const segBtnStyle = (active) => ({
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    padding: '5px 0', borderRadius: 6, border: 'none',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text3)',
    fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Segmented control */}
      <div style={{
        display: 'flex', borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)', background: 'rgba(79,156,249,0.08)',
      }}>
        {CONSUMPTION_MODES.map((m) => (
          <button key={m.key} style={segBtnStyle(mode === m.key)}
            onClick={() => setEconomicParams({ consumptionMode: m.key })}
          >
            <span>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>

      {/* Modalità ANNUO */}
      {mode === 'annual' && (
        <div>
          <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('results.annual_consumption')}</label>
          <input
            type="range" min={500} max={15000} step={100}
            value={economic.annualConsumption_kWh}
            onChange={(e) => setEconomicParams({ annualConsumption_kWh: Number(e.target.value) })}
            style={{ width: '100%', accentColor: '#2DD4BF' }}
          />
          <div style={{ fontSize: 11, color: 'var(--text1)', fontFamily: "'JetBrains Mono', monospace", textAlign: 'right' }}>
            {economic.annualConsumption_kWh.toLocaleString()} kWh
          </div>
        </div>
      )}

      {/* Modalità MENSILE */}
      {mode === 'monthly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {ML.map((label, i) => (
              <div key={i}>
                <label style={{ fontSize: 8, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{label}</label>
                <input
                  type="number" min={0} step={10}
                  value={economic.monthlyConsumption_kWh[i] || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const arr = [...economic.monthlyConsumption_kWh];
                    arr[i] = parseNumericInput(e.target.value);
                    setEconomicParams({ monthlyConsumption_kWh: arr });
                  }}
                  style={{ ...inputStyle, padding: '4px 6px', fontSize: 10 }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace" }}>
              {t('results.monthly_total', { total: monthlyTotal.toLocaleString() })}
            </span>
            <button
              onClick={() => csvMonthlyRef.current?.click()}
              style={{
                padding: '4px 10px', borderRadius: 6, border: '1px dashed var(--border-hi)',
                background: 'transparent', color: 'var(--text2)', fontSize: 9, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              ↑ {t('results.upload_csv')}
            </button>
            <input ref={csvMonthlyRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleMonthlyCSV} />
          </div>
          {csvMsg && (
            <div style={{ fontSize: 9, color: csvMsg.ok ? '#2DD4BF' : '#F87171', padding: '4px 0' }}>{csvMsg.text}</div>
          )}
        </div>
      )}

      {/* Modalità ORARIA */}
      {mode === 'hourly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!economic.hourlyConsumption_kWh ? (
            <div
              onClick={() => csvHourlyRef.current?.click()}
              style={{
                border: '1px dashed var(--border-hi)', borderRadius: 8, padding: '16px 12px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              <span style={{ fontSize: 20 }}>↑</span>
              <span style={{ fontSize: 10, color: 'var(--text2)' }}>{t('results.hourly_hint')}</span>
              <span style={{ fontSize: 8, color: 'var(--text3)' }}>{t('results.hourly_format')}</span>
              <span style={{ fontSize: 8, color: 'var(--text3)' }}>{t('results.hourly_format2')}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text1)' }}>{economic.hourlyFileName || t('results.profile_loaded')}</span>
                <button
                  onClick={() => setEconomicParams({ hourlyConsumption_kWh: null, hourlyFileName: null })}
                  style={{ fontSize: 9, color: '#F87171', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ✕ {t('results.remove')}
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace" }}>
                {t('results.hourly_total', { total: Math.round(hourlyTotal).toLocaleString() })}
              </div>
              {hourlyProfile && (
                <div style={{ height: 50 }}>
                  <ResponsiveContainer width="100%" height={50}>
                    <AreaChart data={hourlyProfile} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                      <Area type="monotone" dataKey="kWh" stroke="#2DD4BF" fill="rgba(45,212,191,0.2)" strokeWidth={1.5} />
                      <Tooltip
                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 9, padding: '4px 8px' }}
                        formatter={(v) => [`${v} kWh`, t('results.average')]}
                        labelFormatter={(l) => l}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <button
                onClick={() => csvHourlyRef.current?.click()}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px dashed var(--border-hi)',
                  background: 'transparent', color: 'var(--text2)', fontSize: 9, cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                ↑ {t('results.replace_csv')}
              </button>
            </div>
          )}
          <input ref={csvHourlyRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleHourlyCSV} />
          {csvMsg && (
            <div style={{ fontSize: 9, color: csvMsg.ok ? '#2DD4BF' : '#F87171', padding: '4px 0' }}>{csvMsg.text}</div>
          )}
        </div>
      )}

      {/* Totale annuale e warning discrepanza */}
      {(() => {
        const localTotal = mode === 'hourly' ? Math.round(hourlyTotal)
          : mode === 'monthly' ? Math.round(monthlyTotal)
          : economic.annualConsumption_kWh;
        const backendTotal = economic.result?.annual_consumption_kwh;
        const mismatch = backendTotal != null && localTotal > 0
          && Math.abs(backendTotal - localTotal) / localTotal > 0.01;
        return (
          <>
            <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
              {t('results.annual_total_label')}: {localTotal.toLocaleString()} kWh
            </div>
            {mismatch && (
              <div style={{ fontSize: 9, color: '#FFB547', marginTop: 2 }}>
                ⚠ {t('results.consumption_mismatch', { backend: Math.round(backendTotal).toLocaleString(), local: localTotal.toLocaleString() })}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
};

export default ResultsCard;
