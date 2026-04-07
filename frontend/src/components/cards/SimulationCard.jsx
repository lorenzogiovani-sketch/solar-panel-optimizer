import React from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import ComputationTimer from '../layout/ComputationTimer';
import InfoTooltip from '../layout/InfoTooltip';
import { parseNumericInput, parseIntInput } from '../../utils/inputUtils';

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

const ACCENT = '#E08C1A';

const SimulationCard = () => {
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const solar = useStore((s) => s.solar);
  const setSolar = useStore((s) => s.setSolar);
  const fetchShadows = useStore((s) => s.fetchShadows);

  const ANALYSIS_OPTIONS = [
    { value: 'annual', label: t('simulation.annual') },
    { value: 'monthly', label: t('simulation.monthly') },
    { value: 'instant', label: t('simulation.instant') },
  ];

  const RESOLUTION_OPTIONS = [
    { value: 'bassa', label: t('simulation.res_low') },
    { value: 'media', label: t('simulation.res_medium') },
  ];

  const monthsShort = t('common.months_short', { returnObjects: true });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Sezione 1: Posizione Geografica ── */}
      <p style={sectionTitle}>{t('simulation.geo_position')}</p>
      <hr style={separator} />
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>{t('simulation.latitude')} <InfoTooltip textKey="tooltips.latitude" /></label>
          <input
            type="number"
            step="0.1"
            value={project.latitude}
            onChange={(e) => setProject({ latitude: parseNumericInput(e.target.value) })}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>{t('simulation.longitude')} <InfoTooltip textKey="tooltips.longitude" /></label>
          <input
            type="number"
            step="0.1"
            value={project.longitude}
            onChange={(e) => setProject({ longitude: parseNumericInput(e.target.value) })}
            style={inputStyle}
          />
        </div>
      </div>

      {/* ── Sezione 2: Modalità Analisi Ombre ── */}
      <p style={{ ...sectionTitle, marginTop: 12 }}>{t('simulation.analysis_mode')} <InfoTooltip textKey="tooltips.analysis_mode" /></p>
      <hr style={separator} />
      <select
        value={solar.analysisMode}
        onChange={(e) => setSolar({ analysisMode: e.target.value })}
        style={{
          ...inputStyle,
          cursor: 'pointer',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
          paddingRight: 24,
        }}
      >
        {ANALYSIS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Controlli modalità Mensile */}
      {solar.analysisMode === 'monthly' && (
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{t('simulation.analysis_month')}</label>
          <select
            value={solar.analysisMonth || 6}
            onChange={(e) => setSolar({ analysisMonth: parseInt(e.target.value) })}
            style={{
              ...inputStyle,
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
              paddingRight: 24,
            }}
          >
            {monthsShort.map((m, i) => (
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Controlli modalità Istantanea */}
      {solar.analysisMode === 'instant' && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: 'var(--text2)',
          }}>
            {t('simulation.datetime_title')}
          </div>

          {/* Riga Mese + Giorno */}
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{t('simulation.month')}</label>
              <select
                value={solar.analysisMonth || 6}
                onChange={(e) => setSolar({ analysisMonth: parseInt(e.target.value) })}
                style={{
                  ...inputStyle,
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 8px center',
                  paddingRight: 24,
                  fontSize: 11,
                }}
              >
                {monthsShort.map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{t('simulation.day')}</label>
              <input
                type="number"
                min={1}
                max={31}
                value={solar.analysisDay || 15}
                onChange={(e) => setSolar({ analysisDay: parseIntInput(e.target.value) })}
                style={{ ...inputStyle, fontSize: 11 }}
              />
            </div>
          </div>

          {/* Ora */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{t('simulation.hour')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min={5}
                max={21}
                step={0.5}
                value={solar.analysisHour || 12}
                onChange={(e) => setSolar({ analysisHour: parseFloat(e.target.value) })}
                style={{
                  flex: 1,
                  height: 4,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  background: 'var(--surface3)',
                  borderRadius: 2,
                  outline: 'none',
                  cursor: 'pointer',
                  accentColor: ACCENT,
                }}
              />
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 700,
                color: ACCENT,
                minWidth: 42,
                textAlign: 'center',
              }}>
                {String(Math.floor(solar.analysisHour || 12)).padStart(2,'0')}:
                {String(Math.round(((solar.analysisHour || 12) % 1) * 60)).padStart(2,'0')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Sezione 3: Risoluzione Calcolo Ombre ── */}
      <p style={{ ...sectionTitle, marginTop: 12 }}>{t('simulation.resolution')} <InfoTooltip textKey="tooltips.shadow_resolution" /></p>
      <hr style={separator} />
      <div style={{ display: 'flex', gap: 4 }}>
        {RESOLUTION_OPTIONS.map((res) => {
          const isActive = solar.shadowResolution === res.value;
          return (
            <button
              key={res.value}
              onClick={() => setSolar({ shadowResolution: res.value })}
              style={{
                flex: 1,
                padding: '5px 0',
                borderRadius: 6,
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                background: isActive ? 'var(--accent)' : 'var(--surface)',
                color: isActive ? '#fff' : 'var(--text2)',
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                textTransform: 'capitalize',
                transition: 'all 0.2s',
              }}
            >
              {res.label}
            </button>
          );
        })}
      </div>

      {/* ── Sezione 4: Pulsante Azione ── */}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={fetchShadows}
          disabled={solar.isLoading}
          style={{
            width: '100%',
            padding: 8,
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: solar.isLoading ? 'not-allowed' : 'pointer',
            opacity: solar.isLoading ? 0.7 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {solar.isLoading ? `⏳ ${t('simulation.computing')}` : t('simulation.compute_shadows')}
        </button>
        <div style={{ marginTop: 4, minHeight: 16, display: 'flex', justifyContent: 'center' }}>
          <ComputationTimer
            startTime={solar.startTime}
            isRunning={solar.isLoading}
            computationTime={solar.computationTime}
            accentColor={ACCENT}
          />
        </div>
      </div>
    </div>
  );
};

export default SimulationCard;
