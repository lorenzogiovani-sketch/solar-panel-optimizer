import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import PanelManualForm from '../optimization/PanelManualForm';

const PanelGateModal = () => {
  const { t } = useTranslation();
  const panelGateOpen = useStore((s) => s.ui.panelGateOpen);
  const datasheets = useStore((s) => s.panels.datasheets);
  const selectedIds = useStore((s) => s.panels.selectedIds);
  const selectPanelDatasheet = useStore((s) => s.selectPanelDatasheet);
  const setPanelGateOpen = useStore((s) => s.setPanelGateOpen);

  const [showAddForm, setShowAddForm] = useState(false);

  if (!panelGateOpen) return null;

  const hasSelection = selectedIds.length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      {showAddForm ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: 340, maxHeight: '80vh', overflowY: 'auto' }}
        >
          <PanelManualForm onClose={() => setShowAddForm(false)} />
        </div>
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 380,
            maxHeight: '80vh',
            background: 'var(--glass-hi)',
            border: '1px solid var(--border-hi)',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          }}
        >
          {/* Accent line */}
          <div
            style={{
              height: 2,
              background: 'linear-gradient(to right, transparent, var(--teal), transparent)',
            }}
          />

          {/* Header */}
          <div style={{ padding: '20px 20px 12px' }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'var(--teal)',
                marginBottom: 6,
              }}
            >
              {t('gate.title')}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text)',
                lineHeight: 1.3,
              }}
            >
              {t('gate.subtitle')}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text2)',
                marginTop: 4,
              }}
            >
              {t('gate.hint')}
            </div>
          </div>

          {/* Panel list */}
          <div style={{ padding: '0 20px', maxHeight: 260, overflowY: 'auto' }}>
            {datasheets.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '20px 0',
                  color: 'var(--text3)',
                  fontSize: 11,
                }}
              >
                {t('gate.no_panels')}
                <br />
                {t('gate.no_panels_hint')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {datasheets.map((ds) => {
                  const isSelected = selectedIds.includes(ds.id);
                  return (
                    <div
                      key={ds.id}
                      onClick={() => selectPanelDatasheet(ds.id)}
                      style={{
                        border: `1px solid ${isSelected ? 'rgba(184,92,53,0.4)' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(184,92,53,0.06)' : 'transparent',
                        borderRadius: 8,
                        padding: '10px 12px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--text)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {ds.constructor} {ds.model}
                        </div>
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 9,
                            color: 'var(--text2)',
                            marginTop: 2,
                          }}
                        >
                          {ds.efficiency_pct}% eff · {ds.width_m} x {ds.height_m} m
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 13,
                            fontWeight: 700,
                            color: 'var(--solar)',
                          }}
                        >
                          {ds.power_w} W
                        </span>
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 5,
                            border: `1.5px solid ${isSelected ? 'var(--teal)' : 'var(--border-hi)'}`,
                            background: isSelected ? 'var(--teal)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            color: '#fff',
                            transition: 'all 0.15s',
                          }}
                        >
                          {isSelected && '✓'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ padding: '14px 20px 18px', display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 8,
                border: '1px dashed var(--border-hi)',
                background: 'transparent',
                color: 'var(--text2)',
                fontFamily: "'Outfit', sans-serif",
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {t('gate.add_new')}
            </button>
            <button
              onClick={() => setPanelGateOpen(false)}
              disabled={!hasSelection}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 8,
                border: hasSelection
                  ? '1px solid rgba(184,92,53,0.3)'
                  : '1px solid var(--border)',
                background: hasSelection
                  ? 'linear-gradient(135deg, rgba(184,92,53,0.15), rgba(184,92,53,0.05))'
                  : 'var(--surface2)',
                color: hasSelection ? 'var(--teal)' : 'var(--text3)',
                fontFamily: "'Outfit', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                cursor: hasSelection ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
              }}
            >
              {t('gate.confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PanelGateModal;
