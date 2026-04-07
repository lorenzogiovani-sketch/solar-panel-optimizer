import { useState } from 'react';

const FlashCard = ({ id, icon, title, accentColor, isActive, onClick, children }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flash-card"
      style={{
        width: isActive ? 360 : 170,
        minHeight: 48,
        maxHeight: isActive ? 600 : 48,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        background: isActive ? 'var(--glass-hi)' : 'var(--glass)',
        border: `1px solid ${isActive ? 'var(--border-hi)' : isHovered ? 'rgba(160,105,55,0.20)' : 'var(--border)'}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: isActive ? '0 20px 60px rgba(100,60,20,0.18)' : 'none',
        overflow: 'hidden',
        cursor: 'pointer',
        pointerEvents: 'all',
        transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1), max-height 0.35s cubic-bezier(0.4,0,0.2,1), background 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1)',
        fontFamily: "'Outfit', sans-serif",
        position: 'relative',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {/* Accent line top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: isActive
            ? `linear-gradient(90deg, transparent, ${accentColor}, transparent)`
            : 'transparent',
          transition: 'background 0.35s',
        }}
      />

      {/* Header — always visible */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          height: 48,
          boxSizing: 'border-box',
        }}
      >
        {typeof icon === 'string' && icon.startsWith('/')
          ? <img src={icon} alt="" style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} />
          : <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
        }
        <span
          style={{
            fontSize: 12,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? accentColor : 'var(--text2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            transition: 'color 0.2s',
          }}
        >
          {title}
        </span>
      </div>

      {/* Body — expanded content */}
      <div
        className="flash-card-body"
        style={{
          opacity: isActive ? 1 : 0,
          maxHeight: isActive ? 548 : 0,
          overflowY: isActive ? 'auto' : 'hidden',
          overflowX: 'hidden',
          transition: 'opacity 0.25s ease, max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
          padding: isActive ? '0 14px 14px' : '0 14px',
          flex: isActive ? 1 : 0,
        }}
      >
        <div onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>

      {/* Scrollbar styling */}
      <style>{`
        .flash-card-body::-webkit-scrollbar { width: 4px; }
        .flash-card-body::-webkit-scrollbar-track { background: transparent; }
        .flash-card-body::-webkit-scrollbar-thumb { background: rgba(160,105,55,0.15); border-radius: 2px; }
        .flash-card-body::-webkit-scrollbar-thumb:hover { background: rgba(160,105,55,0.3); }
      `}</style>
    </div>
  );
};

export default FlashCard;
