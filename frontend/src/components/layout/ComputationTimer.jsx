import React, { useState, useEffect } from 'react';

/**
 * Timer di calcolo che mostra il tempo trascorso in mm:ss.
 * Props:
 *  - startTime: timestamp Date.now() di inizio
 *  - isRunning: se true, aggiorna ogni secondo
 *  - computationTime: tempo backend (secondi), mostrato dopo completamento
 *  - estimatedRemaining: secondi stimati rimanenti (opzionale, per ottimizzazione)
 *  - accentColor: colore accento (default: var(--text3))
 */
const ComputationTimer = ({ startTime, isRunning, computationTime, estimatedRemaining, accentColor }) => {
  const [elapsed, setElapsed] = useState(0);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!isRunning || !startTime) {
      // Se appena completato, mostra il risultato per 8 secondi
      if (computationTime != null && elapsed > 0) {
        setShowResult(true);
        const timer = setTimeout(() => setShowResult(false), 8000);
        return () => clearTimeout(timer);
      }
      return;
    }

    setShowResult(false);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, startTime, computationTime]);

  // Reset elapsed quando cambia startTime
  useEffect(() => {
    if (startTime) setElapsed(0);
  }, [startTime]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const color = accentColor || 'var(--text3)';
  const style = {
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
    color,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    opacity: 0.85,
  };

  if (isRunning && startTime) {
    return (
      <span style={style}>
        <span style={{ animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color }} />
        {formatTime(elapsed)}
        {estimatedRemaining != null && estimatedRemaining > 0 && (
          <span style={{ color: 'var(--text3)', fontSize: 9, marginLeft: 2 }}>
            (~{formatTime(estimatedRemaining)} rim.)
          </span>
        )}
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </span>
    );
  }

  if (showResult && computationTime != null) {
    return (
      <span style={{ ...style, color: 'var(--text3)' }}>
        Calcolo: {computationTime.toFixed(1)}s
      </span>
    );
  }

  return null;
};

export default ComputationTimer;
