import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import {
  OBSTACLE_DEFAULTS,
  OBSTACLE_TYPE_OPTIONS,
  FOLIAGE_TYPE_OPTIONS,
  TREE_TRANSMISSIVITY,
  TREE_SHAPE_OPTIONS,
} from '../../utils/obstacleDefaults';
import { computeRoofSurfaceAtPoint } from '../../utils/roofGeometry';
import { parseNumericInput } from '../../utils/inputUtils';
import { ChevronDown, ChevronUp, Trash2, Plus } from 'lucide-react';
import InfoTooltip from '../layout/InfoTooltip';

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
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 8px',
  color: 'var(--text)',
  fontSize: 11,
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle = {
  ...inputStyle,
  padding: '5px 8px',
  cursor: 'pointer',
};

const labelStyle = {
  fontSize: 11,
  color: 'var(--text3)',
  display: 'block',
  marginBottom: 2,
};

const EMOJI_MAP = {
  chimney: '\u{1F3E0}',
  dormer: '\u{1F3E0}',
  antenna: '\u{1F4E1}',
  tree: '\u{1F332}',
  box: '\u{1F4E6}',
  cylinder: '\u2B24',
  building: '\u{1F3E2}',
};

const ObstaclesCard = () => {
  const { t } = useTranslation();
  const building = useStore((s) => s.building);
  const addObstacle = useStore((s) => s.addObstacle);
  const removeObstacle = useStore((s) => s.removeObstacle);
  const updateObstacle = useStore((s) => s.updateObstacle);

  const [newObstacleType, setNewObstacleType] = useState('chimney');
  const [newDimensions, setNewDimensions] = useState({ ...OBSTACLE_DEFAULTS.chimney });
  const [expandedObstacleId, setExpandedObstacleId] = useState(null);

  // Sincronizza i default quando cambia il tipo selezionato
  useEffect(() => {
    const defaults = OBSTACLE_DEFAULTS[newObstacleType];
    if (defaults) setNewDimensions({ ...defaults });
  }, [newObstacleType]);

  const handleAddObstacle = () => {
    const defaults = OBSTACLE_DEFAULTS[newObstacleType];
    if (!defaults) return;
    const isGround = defaults.placement === 'ground';

    let position, rotation;
    if (isGround) {
      position = [3, 0, 3];
      rotation = [0, 0, 0];
    } else {
      const surf = computeRoofSurfaceAtPoint(0, 0, building);
      position = [0, surf.y, 0];
      rotation = [...surf.normalEuler];
    }

    const obstacle = {
      type: newDimensions.type || defaults.type,
      name: newObstacleType,
      dimensions: (newDimensions.dimensions || defaults.dimensions).map((d, i) => Number(d) || defaults.dimensions[i] || 1),
      position,
      rotation,
      tiltAngle: 0,
    };

    if (newObstacleType === 'tree') {
      obstacle.trunkHeight = Number(newDimensions.trunkHeight) || defaults.trunkHeight;
      obstacle.canopyRadius = Number(newDimensions.canopyRadius) || defaults.canopyRadius;
      obstacle.treeShape = newDimensions.treeShape ?? defaults.treeShape;
      obstacle.foliageType = newDimensions.foliageType ?? defaults.foliageType;
      obstacle.transmissivity = [...(newDimensions.transmissivity || defaults.transmissivity)];
    }

    addObstacle(obstacle);
  };

  const handleObstacleDimChange = (obsId, field, value) => {
    const numVal = parseNumericInput(value);
    const obs = building.obstacles.find((o) => o.id === obsId);
    if (!obs) return;

    if (field === 'trunkHeight' || field === 'canopyRadius') {
      updateObstacle(obsId, { [field]: numVal });
    } else if (field === 'w' || field === 'h' || field === 'd') {
      const dims = [...obs.dimensions];
      if (field === 'w') dims[0] = numVal;
      if (field === 'h') dims[1] = numVal;
      if (field === 'd') dims[2] = numVal;
      updateObstacle(obsId, { dimensions: dims });
    }
  };

  const getLabel = (obs) => {
    const entry = OBSTACLE_DEFAULTS[obs.name];
    return entry ? t(entry.labelKey) : obs.name || obs.type;
  };

  const getEmoji = (obs) => EMOJI_MAP[obs.name] || EMOJI_MAP[obs.type] || '\u{1F4E6}';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Sezione 1: Aggiungi Ostacolo ── */}
      <p style={sectionTitle}>{t('obstacles.add_title')} <InfoTooltip textKey="tooltips.obstacle_type" /></p>
      <hr style={separator} />

      {/* Tipo + Pulsante Aggiungi */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <select
          value={newObstacleType}
          onChange={(e) => setNewObstacleType(e.target.value)}
          style={{ ...selectStyle, flex: 1 }}
        >
          {OBSTACLE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
        <button
          onClick={handleAddObstacle}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Pre-configurazione dimensioni */}
      <div
        style={{
          background: 'var(--glass)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          marginBottom: 12,
        }}
      >
        <p style={{ ...sectionTitle, marginBottom: 6 }}>{t('obstacles.default_dims')}</p>

        {newObstacleType === 'tree' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <label style={labelStyle}>{t('obstacles.trunk_height_m')} <InfoTooltip textKey="tooltips.trunk_height" /></label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={newDimensions.trunkHeight ?? 4}
                  onChange={(e) =>
                    setNewDimensions((d) => ({ ...d, trunkHeight: parseNumericInput(e.target.value) }))
                  }
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('obstacles.crown_radius_m')} <InfoTooltip textKey="tooltips.canopy_radius" /></label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={newDimensions.canopyRadius ?? 3}
                  onChange={(e) =>
                    setNewDimensions((d) => ({ ...d, canopyRadius: parseNumericInput(e.target.value) }))
                  }
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <label style={labelStyle}>{t('obstacles.crown_shape')} <InfoTooltip textKey="tooltips.tree_shape" /></label>
                <select
                  value={newDimensions.treeShape ?? 'cone'}
                  onChange={(e) =>
                    setNewDimensions((d) => ({ ...d, treeShape: e.target.value }))
                  }
                  style={selectStyle}
                >
                  {TREE_SHAPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('obstacles.foliage_type')} <InfoTooltip textKey="tooltips.foliage_type" /></label>
                <select
                  value={newDimensions.foliageType ?? 'deciduous'}
                  onChange={(e) => {
                    const ft = e.target.value;
                    setNewDimensions((d) => ({
                      ...d,
                      foliageType: ft,
                      transmissivity: [...TREE_TRANSMISSIVITY[ft]],
                    }));
                  }}
                  style={selectStyle}
                >
                  {FOLIAGE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <div>
              <label style={labelStyle}>{t('obstacles.width_m')}</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={newDimensions.dimensions?.[0] ?? 1}
                onChange={(e) =>
                  setNewDimensions((d) => {
                    const dims = [...(d.dimensions || [1, 1, 1])];
                    dims[0] = parseNumericInput(e.target.value);
                    return { ...d, dimensions: dims };
                  })
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('obstacles.height_m')}</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={newDimensions.dimensions?.[1] ?? 1}
                onChange={(e) =>
                  setNewDimensions((d) => {
                    const dims = [...(d.dimensions || [1, 1, 1])];
                    dims[1] = parseNumericInput(e.target.value);
                    return { ...d, dimensions: dims };
                  })
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('obstacles.depth_m')}</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={newDimensions.dimensions?.[2] ?? 1}
                onChange={(e) =>
                  setNewDimensions((d) => {
                    const dims = [...(d.dimensions || [1, 1, 1])];
                    dims[2] = parseNumericInput(e.target.value);
                    return { ...d, dimensions: dims };
                  })
                }
                style={inputStyle}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Sezione 2: Lista Ostacoli ── */}
      <p style={sectionTitle}>{t('obstacles.list_title')}</p>
      <hr style={separator} />
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {building.obstacles.length === 0 ? (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text3)',
              fontStyle: 'italic',
              textAlign: 'center',
              padding: '8px 0',
            }}
          >
            {t('obstacles.empty')}
          </span>
        ) : (
          building.obstacles.map((obs) => {
            const isExpanded = expandedObstacleId === obs.id;
            const isTree = obs.type === 'tree' || obs.name === 'tree';
            const isCylindrical = isTree || obs.type === 'cylinder' || obs.type === 'antenna';
            const isRoofObstacle = !isTree && obs.type !== 'building';
            const showTiltSlider = obs.type !== 'building';

            return (
              <div
                key={obs.id}
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  fontSize: 11,
                }}
              >
                {/* Riga principale — click per espandere */}
                <div
                  onClick={() => setExpandedObstacleId(isExpanded ? null : obs.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    {isExpanded ? (
                      <ChevronUp size={12} style={{ color: 'var(--text3)', flexShrink: 0 }} />
                    ) : (
                      <ChevronDown size={12} style={{ color: 'var(--text3)', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{getEmoji(obs)}</span>
                    <span
                      style={{
                        color: 'var(--text1)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {getLabel(obs)}
                    </span>
                    <span
                      style={{
                        fontSize: 8,
                        color: 'var(--text3)',
                        whiteSpace: 'nowrap',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {isTree
                        ? `T${(Number(obs.trunkHeight) || 0).toFixed(1)} C${(Number(obs.canopyRadius) || 0).toFixed(1)}m`
                        : `${(Number(obs.dimensions[0]) || 0).toFixed(1)}×${(Number(obs.dimensions[2]) || 0).toFixed(1)}×${(Number(obs.dimensions[1]) || 0).toFixed(1)}m`}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeObstacle(obs.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text3)',
                      fontSize: 13,
                      padding: '0 2px',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Pannello espanso — modifica dimensioni + rotazione */}
                {isExpanded && (
                  <div
                    style={{
                      padding: '6px 8px 8px',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {isTree ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <div>
                            <label style={labelStyle}>{t('obstacles.trunk_height')} <InfoTooltip textKey="tooltips.trunk_height" /></label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={obs.trunkHeight ?? 2}
                              onChange={(e) =>
                                handleObstacleDimChange(obs.id, 'trunkHeight', e.target.value)
                              }
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>{t('obstacles.crown_radius')} <InfoTooltip textKey="tooltips.canopy_radius" /></label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={obs.canopyRadius ?? 2}
                              onChange={(e) =>
                                handleObstacleDimChange(obs.id, 'canopyRadius', e.target.value)
                              }
                              style={inputStyle}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <div>
                            <label style={labelStyle}>{t('obstacles.crown_shape')} <InfoTooltip textKey="tooltips.tree_shape" /></label>
                            <select
                              value={obs.treeShape ?? 'cone'}
                              onChange={(e) => updateObstacle(obs.id, { treeShape: e.target.value })}
                              style={selectStyle}
                            >
                              {TREE_SHAPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {t(opt.labelKey)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>{t('obstacles.foliage_type')} <InfoTooltip textKey="tooltips.foliage_type" /></label>
                            <select
                              value={obs.foliageType ?? 'deciduous'}
                              onChange={(e) => {
                                const ft = e.target.value;
                                updateObstacle(obs.id, {
                                  foliageType: ft,
                                  transmissivity: [...TREE_TRANSMISSIVITY[ft]],
                                });
                              }}
                              style={selectStyle}
                            >
                              {FOLIAGE_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {t(opt.labelKey)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                        <div>
                          <label style={labelStyle}>{t('obstacles.width_short')}</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={obs.dimensions[0]}
                            onChange={(e) => handleObstacleDimChange(obs.id, 'w', e.target.value)}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>{t('obstacles.height_short')}</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={obs.dimensions[1]}
                            onChange={(e) => handleObstacleDimChange(obs.id, 'h', e.target.value)}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>{t('obstacles.depth_short')}</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={obs.dimensions[2]}
                            onChange={(e) => handleObstacleDimChange(obs.id, 'd', e.target.value)}
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    )}

                    {/* Rotazione Y */}
                    <div>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', marginBottom: 2,
                      }}>
                        <label style={labelStyle}>
                          {t(isCylindrical ? 'obstacles.rotation_symmetric' : 'obstacles.rotation_y')} <InfoTooltip textKey="tooltips.rotation_y" />
                        </label>
                        <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                          {Math.round((obs.rotation?.[1] ?? 0) * 180 / Math.PI)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="355"
                        step="5"
                        value={Math.round((obs.rotation?.[1] ?? 0) * 180 / Math.PI)}
                        onChange={(e) => {
                          const deg = parseFloat(e.target.value);
                          const rad = deg * Math.PI / 180;
                          const rot = [...(obs.rotation || [0, 0, 0])];
                          rot[1] = rad;
                          updateObstacle(obs.id, { rotation: rot });
                        }}
                        style={{
                          width: '100%', height: 3, borderRadius: 2,
                          appearance: 'none', background: 'var(--surface2)',
                          cursor: 'pointer', accentColor: 'var(--accent)',
                        }}
                      />
                    </div>

                    {/* Inclinazione (tilt) — per ostacoli da tetto e alberi */}
                    {showTiltSlider && (
                      <div>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', marginBottom: 2,
                        }}>
                          <label style={labelStyle}>{t('obstacles.tilt_angle')}</label>
                          <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                            {obs.tiltAngle ?? 0}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min="-45"
                          max="45"
                          step="1"
                          value={obs.tiltAngle ?? 0}
                          onChange={(e) =>
                            updateObstacle(obs.id, { tiltAngle: parseInt(e.target.value) })
                          }
                          style={{
                            width: '100%', height: 3, borderRadius: 2,
                            appearance: 'none', background: 'var(--surface2)',
                            cursor: 'pointer', accentColor: 'var(--accent)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Sezione 3: Posizionamento ── */}
      <p style={{ ...sectionTitle, marginTop: 12 }}>{t('obstacles.placement')}</p>
      <hr style={separator} />
      <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0, lineHeight: 1.5 }}>
        {t('obstacles.drag_hint')}
      </p>
    </div>
  );
};

export default ObstaclesCard;
