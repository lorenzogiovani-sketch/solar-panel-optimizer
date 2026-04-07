import { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';

const InfoTooltip = ({ textKey }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: 'top' });
  const iconRef = useRef(null);
  const popupRef = useRef(null);

  const reposition = useCallback(() => {
    if (!iconRef.current || !popupRef.current) return;
    const iconRect = iconRef.current.getBoundingClientRect();
    const popupRect = popupRef.current.getBoundingClientRect();

    let placement = 'top';
    let top = iconRect.top - popupRect.height - 6;
    if (top < 8) {
      placement = 'bottom';
      top = iconRect.bottom + 6;
    }

    // Center horizontally on the icon, clamp to viewport
    let left = iconRect.left + iconRect.width / 2 - popupRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popupRect.width - 8));

    setCoords({ top, left, placement });
  }, []);

  useEffect(() => {
    if (visible) reposition();
  }, [visible, reposition]);

  // Close on outside click (mobile)
  useEffect(() => {
    if (!visible) return;
    const handleClick = (e) => {
      if (iconRef.current?.contains(e.target) || popupRef.current?.contains(e.target)) return;
      setVisible(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [visible]);

  const text = t(textKey);

  const popupStyle = {
    position: 'fixed',
    top: coords.top,
    left: coords.left,
    background: 'rgba(15, 20, 35, 0.95)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--text2, #b0b8c8)',
    maxWidth: 260,
    minWidth: 160,
    zIndex: 10000,
    pointerEvents: 'none',
    whiteSpace: 'normal',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  };

  const arrowLeft = iconRef.current
    ? iconRef.current.getBoundingClientRect().left + iconRef.current.getBoundingClientRect().width / 2 - coords.left
    : '50%';

  const arrowStyle = {
    position: 'absolute',
    left: arrowLeft,
    transform: 'translateX(-50%)',
    width: 0,
    height: 0,
    ...(coords.placement === 'top'
      ? {
          bottom: -5,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '5px solid rgba(15, 20, 35, 0.95)',
        }
      : {
          top: -5,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderBottom: '5px solid rgba(15, 20, 35, 0.95)',
        }),
  };

  return (
    <span
      ref={iconRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help', marginLeft: 3, verticalAlign: 'middle' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={(e) => { e.stopPropagation(); setVisible((v) => !v); }}
    >
      <Info size={11} color="var(--text3, #666)" style={{ opacity: 0.7 }} />
      {visible && ReactDOM.createPortal(
        <div ref={popupRef} style={popupStyle}>
          <div style={arrowStyle} />
          {text}
        </div>,
        document.body
      )}
    </span>
  );
};

export default InfoTooltip;
