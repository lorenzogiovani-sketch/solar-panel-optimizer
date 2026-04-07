import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import { parseNumericInput, parseIntInput } from '../../utils/inputUtils';

const ACCENT = '#A78BFA';

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

const StringingCard = () => {
  const { t } = useTranslation();
  const {
    stringing, setStringing, calculateStringing,
    panels, inverter, optimization,
  } = useStore();
  const [showSection, setShowSection] = useState(true);

  const selectedPanel = panels.datasheets.find((d) => panels.selectedIds.includes(d.id));
  const selectedInverter = inverter.datasheets.find((d) => d.id === inverter.selectedId);

  const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
  const totalPanels = isOptimized
    ? (optimization.result?.total_panels || 0)
    : optimization.panels.length;

  const hasElectricalParams = selectedPanel?.voc_v && selectedPanel?.isc_a && selectedPanel?.vmpp_v && selectedPanel?.impp_a;
  const canCalculate = hasElectricalParams && selectedInverter && totalPanels > 0 && !stringing.isLoading;

  let disabledReason = null;
  if (!selectedPanel) disabledReason = t('stringing.no_panel');
  else if (!hasElectricalParams) disabledReason = t('stringing.no_electrical');
  else if (!selectedInverter) disabledReason = t('stringing.no_inverter');
  else if (totalPanels < 1) disabledReason = t('stringing.no_placed');

  const result = stringing.result;

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: showSection ? 14 : 0 }}
        onClick={() => setShowSection((v) => !v)}
      >
        <p style={{ ...sLabel, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>⚡</span> {t('stringing.title')}
        </p>
        <span style={{ fontSize: 10, color: 'var(--text3)', transition: 'transform 0.3s', transform: showSection ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </div>

      {showSection && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Info pannello + inverter selezionati */}
          <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
            <div style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)' }}>
              <div style={{ color: 'var(--text3)', fontSize: 8, marginBottom: 2 }}>{t('stringing.panel_label')}</div>
              <div style={{ color: 'var(--text1)' }}>
                {selectedPanel ? `${selectedPanel.constructor} ${selectedPanel.model}` : '—'}
              </div>
              {selectedPanel && (
                hasElectricalParams ? (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--text3)', marginTop: 3 }}>
                    Voc: {selectedPanel.voc_v} V · Isc: {selectedPanel.isc_a} A
                    <br />
                    Vmpp: {selectedPanel.vmpp_v} V · Impp: {selectedPanel.impp_a} A
                  </div>
                ) : (
                  <div style={{ fontSize: 9, color: '#FFB547', marginTop: 3 }}>
                    {t('stringing.missing_electrical')}
                  </div>
                )
              )}
            </div>
            <div style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)' }}>
              <div style={{ color: 'var(--text3)', fontSize: 8, marginBottom: 2 }}>{t('stringing.inverter_label')}</div>
              <div style={{ color: 'var(--text1)' }}>
                {selectedInverter ? `${selectedInverter.constructor} ${selectedInverter.model}` : '—'}
              </div>
              {selectedInverter && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--text3)', marginTop: 3 }}>
                  MPPT: {selectedInverter.mppt_channels} ch · Range: {selectedInverter.mppt_voltage_min_v}–{selectedInverter.mppt_voltage_max_v} V
                  <br />
                  Max: {selectedInverter.max_input_voltage_v} V · I_max: {selectedInverter.max_input_current_a} A/ch
                </div>
              )}
            </div>
          </div>

          {/* Riga temperature + modalità */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 90px', minWidth: 70 }}>
              <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('stringing.t_min')}</label>
              <input
                type="number" step={1} value={stringing.tMinC}
                onChange={(e) => setStringing({ tMinC: parseNumericInput(e.target.value) })}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: '0 1 90px', minWidth: 70 }}>
              <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('stringing.t_max')}</label>
              <input
                type="number" step={1} value={stringing.tMaxC}
                onChange={(e) => setStringing({ tMaxC: parseNumericInput(e.target.value) })}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: '0 1 130px' }}>
              <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('stringing.mode_label')}</label>
              <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                {['auto', 'manual'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setStringing({ mode: m })}
                    style={{
                      flex: 1, padding: '5px 0', border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: stringing.mode === m ? ACCENT : 'transparent',
                      color: stringing.mode === m ? '#fff' : 'var(--text3)',
                      transition: 'all 0.2s',
                    }}
                  >
                    {t(`stringing.mode_${m}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Campi manuali */}
          {stringing.mode === 'manual' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('stringing.panels_per_string')}</label>
                <input
                  type="number" min={1} step={1}
                  value={stringing.panelsPerString ?? ''}
                  placeholder="—"
                  onChange={(e) => setStringing({ panelsPerString: e.target.value ? parseIntInput(e.target.value) : null })}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 3 }}>{t('stringing.strings_per_mppt')}</label>
                <input
                  type="number" min={1} step={1}
                  value={stringing.stringsPerMppt ?? ''}
                  placeholder="—"
                  onChange={(e) => setStringing({ stringsPerMppt: e.target.value ? parseIntInput(e.target.value) : null })}
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {/* Pulsante calcola */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={calculateStringing}
              disabled={!canCalculate}
              title={disabledReason || ''}
              style={{
                padding: '8px 16px', borderRadius: 8,
                border: `1px solid ${canCalculate ? ACCENT : 'var(--border)'}`,
                background: canCalculate ? 'rgba(167,139,250,0.08)' : 'transparent',
                color: canCalculate ? ACCENT : 'var(--text3)',
                fontSize: 11, fontWeight: 600,
                cursor: canCalculate ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {stringing.isLoading ? '...' : t('stringing.calculate')}
            </button>
            {disabledReason && (
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>{disabledReason}</span>
            )}
          </div>

          {/* Errore */}
          {stringing.error && (
            <div style={{ fontSize: 10, color: '#F87171', padding: '4px 0' }}>{stringing.error}</div>
          )}

          {/* Risultati */}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Mini KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                <KpiMini label={t('stringing.kpi_series')} value={result.panels_per_string} accent={ACCENT} />
                <KpiMini label={t('stringing.kpi_parallel')} value={result.strings_per_mppt} accent={ACCENT} />
                <KpiMini label={t('stringing.kpi_mppt')} value={result.mppt_used} accent={ACCENT} />
                <KpiMini label={t('stringing.kpi_dc_power')} value={result.dc_power_kw.toFixed(2)} unit="kWp" accent={ACCENT} />
                <KpiMini label={t('stringing.kpi_dc_ac')} value={result.dc_ac_ratio.toFixed(2)} accent={result.dc_ac_ratio > 1.3 ? '#FFB547' : ACCENT} />
              </div>

              {/* Tabella verifiche */}
              <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', fontSize: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto auto', background: 'var(--surface2)', padding: '4px 8px', gap: 8, color: 'var(--text3)', fontWeight: 600 }}>
                  <span></span>
                  <span>{t('stringing.check_label')}</span>
                  <span style={{ textAlign: 'right' }}>{t('stringing.check_value')}</span>
                  <span style={{ textAlign: 'right' }}>{t('stringing.check_limit')}</span>
                </div>
                <CheckRow
                  ok={result.voc_max_v <= selectedInverter?.max_input_voltage_v}
                  label={t('stringing.check_voc')}
                  value={`${result.voc_max_v.toFixed(1)} V`}
                  limit={`${selectedInverter?.max_input_voltage_v} V`}
                />
                <CheckRow
                  ok={result.vmpp_min_v >= selectedInverter?.mppt_voltage_min_v && result.vmpp_max_v <= selectedInverter?.mppt_voltage_max_v}
                  label={t('stringing.check_vmpp')}
                  value={`${result.vmpp_min_v.toFixed(1)}–${result.vmpp_max_v.toFixed(1)} V`}
                  limit={`${selectedInverter?.mppt_voltage_min_v}–${selectedInverter?.mppt_voltage_max_v} V`}
                />
                <CheckRow
                  ok={result.isc_max_a <= selectedInverter?.max_input_current_a}
                  label={t('stringing.check_isc')}
                  value={`${result.isc_max_a.toFixed(2)} A`}
                  limit={`${selectedInverter?.max_input_current_a} A`}
                />
                <CheckRow
                  ok={result.dc_power_kw <= selectedInverter?.max_dc_power_kw}
                  label={t('stringing.check_power')}
                  value={`${result.dc_power_kw.toFixed(2)} kW`}
                  limit={`${selectedInverter?.max_dc_power_kw} kW`}
                />
              </div>

              {/* Pannelli inutilizzati */}
              {result.total_panels_unused > 0 && (
                <div style={{ fontSize: 10, color: '#FFB547', padding: '4px 8px', borderRadius: 6, background: 'rgba(255,181,71,0.06)', border: '1px solid rgba(255,181,71,0.15)' }}>
                  {t('stringing.unused_panels', { count: result.total_panels_unused })}
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div style={{
                  padding: '8px 10px', borderRadius: 8, fontSize: 10,
                  background: result.status === 'error' ? 'rgba(248,113,113,0.06)' : 'rgba(255,181,71,0.06)',
                  border: `1px solid ${result.status === 'error' ? 'rgba(248,113,113,0.2)' : 'rgba(255,181,71,0.2)'}`,
                  color: result.status === 'error' ? '#F87171' : '#FFB547',
                }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ marginBottom: i < result.warnings.length - 1 ? 4 : 0 }}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Placeholder */}
          {!result && !stringing.isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, color: 'var(--text3)', fontSize: 11 }}>
              {t('stringing.hint')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const KpiMini = ({ label, value, unit, accent }) => (
  <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--glass)', border: '1px solid var(--border)', textAlign: 'center' }}>
    <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
      {unit && <span style={{ fontSize: 8, color: 'var(--text3)' }}>{unit}</span>}
    </div>
  </div>
);

const CheckRow = ({ ok, label, value, limit }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '24px 1fr auto auto', padding: '4px 8px', gap: 8,
    borderTop: '1px solid var(--border)', alignItems: 'center',
  }}>
    <span style={{
      width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
      background: ok ? '#2DD4BF' : '#F87171',
    }} />
    <span style={{ color: 'var(--text1)' }}>{label}</span>
    <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: ok ? 'var(--text1)' : '#F87171' }}>{value}</span>
    <span style={{ textAlign: 'right', color: 'var(--text3)' }}>{limit}</span>
  </div>
);

export default StringingCard;
