import React, { useState, useRef, useEffect } from 'react';

const FloatingCard = ({ accentColor = '#D97757', icon, label, value, unit, sub, children }) => {
  const [hovered, setHovered] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (prevValueRef.current !== value && prevValueRef.current !== undefined) {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 600);
      return () => clearTimeout(t);
    }
    prevValueRef.current = value;
  }, [value]);

  const accentRgba = (opacity) => {
    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  };

  return (
    <div
      className="floating-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: hovered ? 272 : 192,
        background: hovered ? 'var(--glass-hi)' : 'var(--glass)',
        border: `1px solid ${hovered ? 'var(--border-hi)' : 'var(--border)'}`,
        borderRadius: 10,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        overflow: 'hidden',
        transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1), background 0.25s, border-color 0.25s, box-shadow 0.3s',
        boxShadow: hovered
          ? '0 0 0 1px rgba(160,105,55,0.18), 0 20px 60px rgba(100,60,20,0.18)'
          : '0 2px 12px rgba(100, 60, 20, 0.08)',
        pointerEvents: 'all',
      }}
    >
      {/* Accent line */}
      <div
        style={{
          height: 1,
          background: `linear-gradient(to right, transparent, ${accentColor}, transparent)`,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.25s',
        }}
      />

      {/* Header */}
      <div style={{ padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Icon box */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: accentRgba(0.12),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: accentColor,
          }}
        >
          {icon}
        </div>

        {/* Text block */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: '1.2px',
              textTransform: 'uppercase',
              color: 'var(--text2)',
              lineHeight: 1,
              marginBottom: 3,
            }}
          >
            {label}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text)',
                lineHeight: 1,
                borderRadius: 4,
                padding: '1px 3px',
                margin: '-1px -3px',
                background: flashing ? 'rgba(217,119,87,0.15)' : 'transparent',
                transition: flashing ? 'none' : 'background 0.6s ease-out',
              }}
            >
              {value}
            </span>
            {unit && (
              <span style={{ fontSize: 10, color: 'var(--text2)' }}>{unit}</span>
            )}
          </div>
          {sub && (
            <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>{sub}</div>
          )}
        </div>

        {/* Arrow */}
        {children && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text3)',
              transition: 'transform 0.3s',
              transform: hovered ? 'rotate(180deg)' : 'rotate(0deg)',
              flexShrink: 0,
            }}
          >
            ▾
          </div>
        )}
      </div>

      {/* Body (children) */}
      {children && (
        <div
          style={{
            maxHeight: hovered ? 640 : 0,
            opacity: hovered ? 1 : 0,
            transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
            padding: hovered ? '0 13px 13px' : '0 13px',
            overflowY: hovered ? 'auto' : 'hidden',
            overflowX: 'hidden',
          }}
          className="floating-card-body"
        >
          {children}
        </div>
      )}

      {/* Scrollbar styling */}
      <style>{`
        .floating-card-body::-webkit-scrollbar { width: 4px; }
        .floating-card-body::-webkit-scrollbar-track { background: transparent; }
        .floating-card-body::-webkit-scrollbar-thumb { background: rgba(160,105,55,0.15); border-radius: 2px; }
        .floating-card-body::-webkit-scrollbar-thumb:hover { background: rgba(160,105,55,0.3); }
      `}</style>
    </div>
  );
};

export default FloatingCard;
