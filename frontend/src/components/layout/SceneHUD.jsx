import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';

const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const hudBase = {
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  pointerEvents: 'all',
  transition: 'opacity 0.2s',
};

/* ─── 1. Coordinate Tag ─────────────────────────────────── */
const CoordinateTag = () => {
  const { latitude, longitude } = useStore((s) => s.project);
  const [hovered, setHovered] = useState(false);
  const [cityName, setCityName] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    setCityName('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'User-Agent': 'SolarOptimizer3D/1.0' } }
      )
        .then((r) => r.json())
        .then((data) => {
          const addr = data.address || {};
          const name = addr.city || addr.town || addr.village || addr.county || '';
          setCityName(name);
        })
        .catch(() => {});
    }, 1000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [latitude, longitude]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...hudBase,
        position: 'absolute',
        bottom: 80,
        left: 16,
        zIndex: 10,
        borderRadius: 8,
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        opacity: hovered ? 1 : 0.85,
      }}
    >
      {cityName && (
        <div style={{ fontSize: 11, color: 'var(--text1)', fontWeight: 700 }}>
          {cityName}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12 }}>📍</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--solar)',
        }}>
          {latitude.toFixed(4)}°N, {longitude.toFixed(4)}°E
        </span>
      </div>
    </div>
  );
};

/* ─── 2. Time Scrubber ──────────────────────────────────── */
const TimeScrubber = () => {
  const { t } = useTranslation();
  const MONTH_LABELS = t('common.months_short', { returnObjects: true });
  const solar = useStore((s) => s.solar);
  const setSolar = useStore((s) => s.setSolar);
  const setSolarTime = useStore((s) => s.setSolarTime);
  const isLoading = useStore((s) => s.dailySimulation.isLoading);
  const [hovered, setHovered] = useState(false);

  const hour = solar.selectedHour ?? 12;
  const month = solar.selectedMonth ?? 6;

  const hourStr = `${String(hour).padStart(2, '0')}:00`;

  const handleCurrentTime = () => {
    const now = new Date();
    setSolarTime(now.getMonth() + 1, now.getHours());
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...hudBase,
        position: 'absolute',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        borderRadius: 24,
        padding: '6px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: hovered ? 1 : 0.85,
      }}
    >
      {/* Ora */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--solar)',
        minWidth: 38,
        textAlign: 'center',
      }}>
        {hourStr}
      </span>
      <input
        type="range"
        min={5}
        max={21}
        step={1}
        value={hour}
        onChange={(e) => setSolar({ selectedHour: parseInt(e.target.value) })}
        style={{
          width: 90,
          height: 3,
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'var(--surface3)',
          borderRadius: 2,
          outline: 'none',
          cursor: 'pointer',
          accentColor: 'var(--solar)',
        }}
      />

      {/* Separatore */}
      <div style={{
        width: 1,
        height: 16,
        background: 'var(--border)',
      }} />

      {/* Mese */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--accent)',
        minWidth: 28,
        textAlign: 'center',
      }}>
        {MONTH_LABELS[month - 1]}
      </span>
      <input
        type="range"
        min={1}
        max={12}
        step={1}
        value={month}
        onChange={(e) => setSolar({ selectedMonth: parseInt(e.target.value) })}
        style={{
          width: 70,
          height: 3,
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'var(--surface3)',
          borderRadius: 2,
          outline: 'none',
          cursor: 'pointer',
          accentColor: 'var(--accent)',
        }}
      />

      {/* Separatore */}
      <div style={{
        width: 1,
        height: 16,
        background: 'var(--border)',
      }} />

      {/* Bottone Ora attuale */}
      <button
        onClick={handleCurrentTime}
        disabled={isLoading}
        title={t('simulation.current_time')}
        style={{
          padding: '3px 8px',
          borderRadius: 12,
          border: '1px solid #4F9CF9',
          background: 'rgba(79,156,249,0.1)',
          color: '#4F9CF9',
          fontSize: 9,
          fontWeight: 700,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          lineHeight: 1.2,
        }}
      >
        {t('simulation.current_time')}
      </button>
    </div>
  );
};

/* ─── Composizione ──────────────────────────────────────── */
const SceneHUD = () => {
  const showSunPath = useStore((s) => s.solar.showSunPath);

  return (
    <>
      <CoordinateTag />
      {showSunPath && <TimeScrubber />}
    </>
  );
};

export default SceneHUD;
