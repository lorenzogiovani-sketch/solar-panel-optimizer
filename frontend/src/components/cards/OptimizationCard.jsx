import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import ComputationTimer from '../layout/ComputationTimer';
import InfoTooltip from '../layout/InfoTooltip';
import { computeTotalLosses } from '../../utils/energy';

/* ── style helpers ── */
const sectionTitle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--text2)',
  margin: 0,
  padding: 0,
};

const separator = {
  border: 'none',
  borderTop: '1px solid var(--border)',
  margin: '10px 0 8px',
};

const inputStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
  color: 'var(--text1)',
  outline: 'none',
  boxSizing: 'border-box',
};

const ACCENT_MANUAL = '#B85C35';
const ACCENT_ALGO = '#D97757';

const OptimizationCard = () => {
  const { t } = useTranslation();

  const panels = useStore((s) => s.panels);
  const optimization = useStore((s) => s.optimization);
  const selectPanelDatasheet = useStore((s) => s.selectPanelDatasheet);
  const runMultiPanelOptimization = useStore((s) => s.runMultiPanelOptimization);
  const runOptimization = useStore((s) => s.runOptimization);
  const pollOptimizationStatus = useStore((s) => s.pollOptimizationStatus);
  const fetchInverters = useStore((s) => s.fetchInverters);
  const selectInverter = useStore((s) => s.selectInverter);
  const [mode, setMode] = useState('algorithm');
  const pollingRef = useRef(null);

  const accent = mode === 'manual' ? ACCENT_MANUAL : ACCENT_ALGO;

  // Auto-polling quando il job è running
  const startPolling = useCallback((jobId) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const data = await pollOptimizationStatus();
      if (data && (data.status === 'completed' || data.status === 'error')) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 2000);
  }, [pollOptimizationStatus]);

  useEffect(() => {
    if (optimization.status === 'running' && optimization.jobId && !pollingRef.current) {
      startPolling(optimization.jobId);
    }
  }, [optimization.status, optimization.jobId, startPolling]);

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  useEffect(() => {
    if (inverter.datasheets.length === 0) fetchInverters();
  }, []);

  const setState = useStore.setState;
  const setOpt = (params) => setState((s) => ({ optimization: { ...s.optimization, ...params } }));

  const solar = useStore((s) => s.solar);
  const inverter = useStore((s) => s.inverter);

  const selectedInverter = inverter.datasheets.find((i) => i.id === inverter.selectedId) || null;
  const totalSystemLossesPct = computeTotalLosses(
    optimization.otherBosLosses ?? 0.11,
    inverter.datasheets,
    inverter.selectedId
  ) * 100;

  const isRunning = optimization.status === 'running';
  const isError = optimization.status === 'error';

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* ── Toggle Manuale / Algoritmo ── */}
        <div style={{
          display: 'flex',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          marginBottom: 10,
        }}>
          {[
            { key: 'manual', label: t('optimization.tab_manual'), color: ACCENT_MANUAL },
            { key: 'algorithm', label: t('optimization.tab_algorithm'), color: ACCENT_ALGO },
          ].map((tab) => {
            const active = mode === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setMode(tab.key)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  border: 'none',
                  background: active ? `${tab.color}18` : 'transparent',
                  color: active ? tab.color : 'var(--text3)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  borderBottom: active ? `2px solid ${tab.color}` : '2px solid transparent',
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Sezione Catalogo Pannelli (comune) ── */}
        <p style={sectionTitle}>{t('optimization.catalog_title')}</p>
        <hr style={separator} />

        <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {panels.datasheets.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
              {t('optimization.no_panels')}
            </span>
          )}
          {panels.datasheets.map((p) => {
            const selected = panels.selectedIds.includes(p.id);
            return (
              <div
                key={p.id}
                onClick={() => selectPanelDatasheet(p.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: `1px solid ${selected ? accent : 'var(--border)'}`,
                  background: selected ? `${accent}14` : 'var(--glass)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `1.5px solid ${selected ? accent : 'var(--text3)'}`,
                    background: selected ? accent : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 11,
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {selected && '✓'}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.model || p.constructor}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {p.power_w}W · {p.width_m}×{p.height_m}m
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Selettore Inverter ── */}
        <p style={{ ...sectionTitle, marginTop: 12 }}>{t('optimization.select_inverter')}</p>
        <hr style={separator} />

        <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {inverter.datasheets.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
              {t('optimization.no_inverter_selected')}
            </span>
          )}
          {inverter.datasheets.map((inv) => {
            const selected = inverter.selectedId === inv.id;
            return (
              <div
                key={inv.id}
                onClick={() => selectInverter(inv.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: `1px solid ${selected ? accent : 'var(--border)'}`,
                  background: selected ? `${accent}14` : 'var(--glass)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `1.5px solid ${selected ? accent : 'var(--text3)'}`,
                    background: selected ? accent : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 11,
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {selected && '✓'}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {inv.model || inv.constructor}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {inv.power_kw} kW · η {inv.efficiency_pct}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Modalità MANUALE ── */}
        {mode === 'manual' && (
          <>
            <p style={{ ...sectionTitle, marginTop: 12 }}>{t('optimization.manual_title')}</p>
            <hr style={separator} />
            <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
              {t('optimization.manual_hint')}
            </span>

          </>
        )}

        {/* ── Modalità ALGORITMO ── */}
        {mode === 'algorithm' && (
          <>
            {/* Confronto Pannelli */}
            <p style={{ ...sectionTitle, marginTop: 12 }}>{t('optimization.compare_title')}</p>
            <hr style={separator} />
            <button
              onClick={() => panels.selectedIds.length >= 2 ? runMultiPanelOptimization() : null}
              disabled={panels.datasheets.length < 2 || panels.isRunningMulti}
              style={{
                width: '100%',
                padding: '6px 0',
                borderRadius: 6,
                border: `1px solid ${panels.datasheets.length < 2 ? 'var(--border)' : ACCENT_ALGO}`,
                background: 'transparent',
                color: panels.datasheets.length < 2 ? 'var(--text3)' : ACCENT_ALGO,
                fontSize: 12,
                fontWeight: 600,
                cursor: panels.datasheets.length < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              {panels.isRunningMulti ? `⏳ ${t('optimization.comparing')}` : t('optimization.compare_btn')}
            </button>

            {/* Link al confronto dettagliato nei Risultati */}
            {panels.multiResults && panels.multiResults.length > 0 && (
              <button
                onClick={() => useStore.getState().setActiveTab('results')}
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'rgba(79,156,249,0.06)',
                  color: '#4F9CF9',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {t('optimization.see_comparison')}
              </button>
            )}

            {/* Parametri Sistema */}
            <p style={{ ...sectionTitle, marginTop: 12 }}>{t('optimization.system_params')}</p>
            <hr style={separator} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>{t('optimization.max_power')} <InfoTooltip textKey="tooltips.max_peak_power" /></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={1}
                    max={50}
                    step={0.5}
                    value={optimization.maxPeakPower}
                    onChange={(e) => setOpt({ maxPeakPower: parseFloat(e.target.value) })}
                    style={{ flex: 1, accentColor: ACCENT_ALGO }}
                  />
                  <span style={{
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: ACCENT_ALGO,
                    minWidth: 44,
                    textAlign: 'right',
                  }}>
                    {optimization.maxPeakPower.toFixed(1)}
                  </span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4, display: 'block' }}>
                  {t('optimization.bos_losses_label')} <InfoTooltip textKey="tooltips.system_efficiency" />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={5}
                    max={30}
                    step={1}
                    value={Math.round((optimization.otherBosLosses ?? 0.11) * 100)}
                    onChange={(e) => setOpt({ otherBosLosses: parseInt(e.target.value) / 100 })}
                    style={{ flex: 1, accentColor: ACCENT_ALGO }}
                  />
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: ACCENT_ALGO, minWidth: 36, textAlign: 'right' }}>
                    {Math.round((optimization.otherBosLosses ?? 0.11) * 100)}%
                  </span>
                </div>
                <div style={{ marginTop: 4, padding: '5px 8px', borderRadius: 6, background: 'var(--glass)', border: '1px solid var(--border)', fontSize: 10, lineHeight: 1.7 }}>
                  {selectedInverter ? (
                    <div style={{ color: 'var(--text2)' }}>
                      {selectedInverter.model || selectedInverter.constructor}: η={selectedInverter.efficiency_pct.toFixed(1)}% → {((1 - selectedInverter.efficiency_pct / 100) * 100).toFixed(1)}% {t('optimization.inv_loss')}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text3)', fontStyle: 'italic' }}>{t('optimization.inverter_generic')}</div>
                  )}
                  <div style={{ color: 'var(--text2)' }}>{t('optimization.other_bos')}: {Math.round((optimization.otherBosLosses ?? 0.11) * 100)}%</div>
                  <div style={{ fontWeight: 600, color: 'var(--solar, #FFB547)' }}>{t('optimization.total_losses')}: {totalSystemLossesPct.toFixed(1)}%</div>
                </div>
              </div>
            </div>

            {/* Messaggio errore */}
            {isError && optimization.errorMessage && (
              <div style={{
                marginTop: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'rgba(201,64,48,0.1)',
                border: '1px solid var(--red, #C94030)',
                fontSize: 11,
                color: 'var(--red, #C94030)',
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}>
                {optimization.errorMessage}
              </div>
            )}

            {/* Pulsante avvia ottimizzazione */}
            <button
              onClick={() => runOptimization()}
              disabled={isRunning || panels.selectedIds.length === 0}
              title={!solar.shadows?.shadow_grid ? t('optimization.compute_shadows_first') : ''}
              style={{
                marginTop: 10,
                width: '100%',
                padding: 8,
                borderRadius: 6,
                border: 'none',
                background: isRunning ? 'var(--surface2)' : ACCENT_ALGO,
                color: isRunning ? 'var(--text2)' : '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: isRunning || panels.selectedIds.length === 0 ? 'not-allowed' : 'pointer',
                opacity: panels.selectedIds.length === 0 && !isRunning ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            >
              {isRunning ? `⟳ ${t('optimization.optimizing')}` : `▶ ${t('optimization.start_btn')}`}
            </button>
            <div style={{ marginTop: 4, minHeight: 16, display: 'flex', justifyContent: 'center' }}>
              <ComputationTimer
                startTime={optimization.startTime}
                isRunning={isRunning}
                computationTime={optimization.computationTime}
                estimatedRemaining={optimization.estimatedRemaining}
                accentColor={ACCENT_ALGO}
              />
            </div>
            {panels.selectedIds.length === 0 && !isRunning && (
              <span style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginTop: 2 }}>
                {t('optimization.select_panel_first')}
              </span>
            )}
          </>
        )}
      </div>

    </>
  );
};

export default OptimizationCard;
