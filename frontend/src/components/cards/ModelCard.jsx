import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import { X, Loader2, RotateCw, CheckCircle, Trash2, PenLine, ArrowUpDown, Layers, Eye } from 'lucide-react';
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

const sliderRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  color: 'var(--text2)',
  marginBottom: 2,
};

const sliderStyle = {
  width: '100%',
  height: 3,
  borderRadius: 2,
  appearance: 'none',
  background: 'var(--surface2)',
  cursor: 'pointer',
  accentColor: 'var(--solar)',
};

const selectStyle = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  outline: 'none',
};

const ModelCard = () => {
  const fileInputRef = useRef(null);
  const building = useStore((s) => s.building);
  const setBuilding = useStore((s) => s.setBuilding);
  const setModelRotation = useStore((s) => s.setModelRotation);
  const uploadModel = useStore((s) => s.uploadModel);
  const setModelOffsetY = useStore((s) => s.setModelOffsetY);
  const setInstallationPlaneY = useStore((s) => s.setInstallationPlaneY);
  const toggleFaceSelection = useStore((s) => s.toggleFaceSelection);
  const undoLastSelection = useStore((s) => s.undoLastSelection);
  const resetDeletedFaces = useStore((s) => s.resetDeletedFaces);
  const installationZones = useStore((s) => s.optimization.installationZones);
  const activeZoneId = useStore((s) => s.optimization.activeZoneId);
  const isDrawingPolygon = useStore((s) => s.optimization.isDrawingPolygon);
  const startDrawingPolygon = useStore((s) => s.startDrawingPolygon);
  const closePolygon = useStore((s) => s.closePolygon);
  const clearPolygon = useStore((s) => s.clearPolygon);
  const removeZone = useStore((s) => s.removeZone);
  const selectZone = useStore((s) => s.selectZone);
  const clearAllZones = useStore((s) => s.clearAllZones);
  const { t } = useTranslation();

  const { importedMesh, isLoading, installationPlaneY } = building;
  const hasImportedModel = !!importedMesh;

  // Calcola bounds del mesh importato per range slider piano installazione
  const meshBounds = hasImportedModel && importedMesh?.vertices?.length
    ? (() => {
        let minY = Infinity, maxY = -Infinity;
        for (const v of importedMesh.vertices) {
          if (v[1] < minY) minY = v[1];
          if (v[1] > maxY) maxY = v[1];
        }
        return { minY, maxY };
      })()
    : null;
  const currentPlaneY = installationPlaneY;
  const activeZone = installationZones.find((z) => z.id === activeZoneId);
  const activeVertices = activeZone?.vertices || [];
  const finalizedZones = installationZones.filter((z) => z.vertices.length >= 3);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (['obj', 'stl'].includes(ext)) {
      uploadModel(file);
    } else {
      alert(t('building.format_error'));
    }
    e.target.value = '';
  };

  const handleRemoveModel = () => {
    useStore.setState((s) => ({
      building: { ...s.building, importedMesh: null },
    }));
  };

  const handleDimensionChange = (e) => {
    const { name, value } = e.target;
    setBuilding({ [name]: parseFloat(value) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Sezione 1: Importa Modello 3D ── */}
      <p style={sectionTitle}>{t('building.import_title')}</p>
      <hr style={separator} />

      {isLoading ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--glass)',
        }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} color="var(--text2)" />
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('building.loading')}</span>
        </div>
      ) : importedMesh ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderRadius: 8,
          border: '1px solid rgba(184,92,53,0.3)',
          background: 'rgba(184,92,53,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>📦</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {importedMesh.filename}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {t('building.vertices_count', { count: importedMesh.vertex_count?.toLocaleString() })}
              </div>
            </div>
          </div>
          <button
            onClick={handleRemoveModel}
            style={{
              background: 'none', border: 'none', padding: 2,
              cursor: 'pointer', color: 'var(--text3)', display: 'flex', flexShrink: 0,
            }}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              border: '1px dashed var(--border-hi)',
              borderRadius: 8,
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: 'transparent',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <span style={{ fontSize: 16 }}>📂</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t('building.import_btn')}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('building.drop_hint')}</div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".obj,.stl"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </>
      )}

      {/* ── Sezione Modifica Mesh (solo modello importato) ── */}
      {hasImportedModel && (
        <div style={{
          marginTop: 12,
          overflow: 'hidden',
        }}>
          <p style={sectionTitle}>{t('building.edit_mesh')}</p>
          <hr style={separator} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Slider offset verticale */}
            <div>
              <div style={sliderRow}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ArrowUpDown size={10} color="var(--solar)" />
                  {t('building.ground_height')} <InfoTooltip textKey="tooltips.ground_height" />
                </span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.modelOffsetY} m</span>
              </div>
              <input
                type="range" min="-10" max="10" step="0.1"
                value={building.modelOffsetY}
                onChange={(e) => setModelOffsetY(parseFloat(e.target.value))}
                style={{ ...sliderStyle, accentColor: 'var(--solar)' }}
              />
            </div>

            {/* Slider quota piano installazione */}
            {meshBounds && (
              <div>
                <div style={sliderRow}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Layers size={10} color="var(--teal)" />
                    {t('building.install_plane_height')} <InfoTooltip textKey="building.install_plane_hint" />
                  </span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                    {currentPlaneY.toFixed(2)} m
                  </span>
                </div>
                <input
                  type="range"
                  min={meshBounds.minY}
                  max={meshBounds.maxY + 1.0}
                  step="0.05"
                  value={currentPlaneY}
                  onChange={(e) => setInstallationPlaneY(parseFloat(e.target.value))}
                  style={{ ...sliderStyle, accentColor: 'var(--teal)' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <input
                    type="number"
                    min={meshBounds.minY}
                    max={meshBounds.maxY + 1.0}
                    step="0.05"
                    value={currentPlaneY.toFixed(2)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setInstallationPlaneY(v);
                    }}
                    style={{
                      width: 70, padding: '3px 6px', fontSize: 11, borderRadius: 4,
                      border: '1px solid var(--border)', background: 'var(--surface)',
                      color: 'var(--text)', outline: 'none', textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>m</span>
                </div>
              </div>
            )}

            <button
              onClick={toggleFaceSelection}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: 500,
                cursor: 'pointer',
                background: building.isSelectingFaces ? 'rgba(248,113,113,0.25)' : 'rgba(248,113,113,0.10)',
                color: building.isSelectingFaces ? '#FCA5A5' : '#F87171',
                border: building.isSelectingFaces ? '1px solid rgba(248,113,113,0.4)' : '1px solid rgba(248,113,113,0.25)',
                transition: 'all 0.2s',
              }}
            >
              <Trash2 size={13} />
              {building.isSelectingFaces ? t('building.exit_selection') : t('building.select_faces')}
            </button>

            {building.isSelectingFaces && (
              <div style={{ fontSize: 11, color: '#C94030', textAlign: 'center', opacity: 0.8 }}>
                {t('building.select_hint')}
              </div>
            )}

            {building.deletedFaces.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
                  {t('building.faces_removed', { count: building.deletedFaces.length })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  <button
                    onClick={undoLastSelection}
                    disabled={building.deletionHistory?.length === 0}
                    style={{
                      padding: '4px 0', borderRadius: 4, border: '1px solid var(--border)',
                      fontSize: 11, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text2)',
                      opacity: building.deletionHistory?.length === 0 ? 0.4 : 1,
                    }}
                  >
                    {t('building.cancel')}
                  </button>
                  <button
                    onClick={resetDeletedFaces}
                    style={{
                      padding: '4px 0', borderRadius: 4,
                      border: '1px solid rgba(201,64,48,0.3)',
                      fontSize: 11, cursor: 'pointer',
                      background: 'rgba(201,64,48,0.08)', color: '#C94030',
                    }}
                  >
                    {t('building.restore')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sezione 2: Parametri Edificio (solo parametrico) ── */}
      <div style={{
        maxHeight: hasImportedModel ? 0 : 600,
        overflow: 'hidden',
        transition: 'max-height 0.35s ease, opacity 0.25s ease',
        opacity: hasImportedModel ? 0 : 1,
        marginTop: hasImportedModel ? 0 : 12,
      }}>
        <p style={sectionTitle}>{t('building.params_title')}</p>
        <hr style={separator} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Larghezza */}
          <div>
            <div style={sliderRow}>
              <span>{t('building.width')} <InfoTooltip textKey="tooltips.building_width" /></span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.width} m</span>
            </div>
            <input
              type="range" name="width" min="5" max="30" step="0.5"
              value={building.width} onChange={handleDimensionChange}
              style={sliderStyle}
            />
          </div>

          {/* Profondità */}
          <div>
            <div style={sliderRow}>
              <span>{t('building.depth')} <InfoTooltip textKey="tooltips.building_depth" /></span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.depth} m</span>
            </div>
            <input
              type="range" name="depth" min="5" max="30" step="0.5"
              value={building.depth} onChange={handleDimensionChange}
              style={sliderStyle}
            />
          </div>

          {/* Altezza */}
          <div>
            <div style={sliderRow}>
              <span>{t('building.height')} <InfoTooltip textKey="tooltips.building_height" /></span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.height} m</span>
            </div>
            <input
              type="range" name="height" min="3" max="15" step="0.5"
              value={building.height} onChange={handleDimensionChange}
              style={sliderStyle}
            />
          </div>

          {/* Tipo tetto */}
          <div>
            <div style={{ ...sliderRow, marginBottom: 4 }}>
              <span>{t('building.roof_type')} <InfoTooltip textKey="tooltips.roof_type" /></span>
            </div>
            <select
              name="roofType"
              value={building.roofType}
              onChange={(e) => setBuilding({ roofType: e.target.value })}
              style={selectStyle}
            >
              <option value="flat">{t('building.roof_flat')}</option>
              <option value="gable">{t('building.roof_gable')}</option>
              <option value="hip">{t('building.roof_hip')}</option>
            </select>
          </div>

          {/* Inclinazione tetto (gable) */}
          {building.roofType === 'gable' && (
            <div>
              <div style={sliderRow}>
                <span>{t('building.roof_angle')} <InfoTooltip textKey="tooltips.roof_angle" /></span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.roofAngle}°</span>
              </div>
              <input
                type="range" name="roofAngle" min="0" max="60" step="1"
                value={building.roofAngle} onChange={handleDimensionChange}
                style={sliderStyle}
              />
            </div>
          )}

          {/* Parametri tetto hip */}
          {building.roofType === 'hip' && (
            <>
              <div>
                <div style={sliderRow}>
                  <span>{t('building.ridge_height')} <InfoTooltip textKey="tooltips.ridge_height" /></span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.ridgeHeight} m</span>
                </div>
                <input
                  type="range" name="ridgeHeight" min="1" max="10" step="0.5"
                  value={building.ridgeHeight} onChange={handleDimensionChange}
                  style={sliderStyle}
                />
              </div>
              <div>
                <div style={sliderRow}>
                  <span>{t('building.ridge_length')} <InfoTooltip textKey="tooltips.ridge_length" /></span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.ridgeLength} m</span>
                </div>
                <input
                  type="range" name="ridgeLength" min="0" max={Math.max(0, building.width - 1)} step="0.5"
                  value={building.ridgeLength} onChange={handleDimensionChange}
                  style={sliderStyle}
                />
              </div>
            </>
          )}

        </div>
      </div>

      {/* ── Orientamento (sempre visibile) ── */}
      <div style={{ marginTop: 12 }}>
        <p style={sectionTitle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <RotateCw size={10} color="var(--accent)" />
            {t('building.orientation')}
          </span>
        </p>
        <hr style={separator} />
        <div>
          <div style={sliderRow}>
            <span>{t('building.rotation')} <InfoTooltip textKey="tooltips.rotation" /></span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{building.modelRotationY}°</span>
          </div>
          <input
            type="range" min="0" max="360" step="1"
            value={building.modelRotationY}
            onChange={(e) => setModelRotation(parseFloat(e.target.value))}
            style={{ ...sliderStyle, accentColor: 'var(--accent)' }}
          />
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 8, color: 'var(--text3)', marginTop: 2,
          }}>
            <span>0° N</span>
            <span>90° E</span>
            <span>180° S</span>
            <span>270° W</span>
            <span>360° N</span>
          </div>
        </div>
      </div>

      {/* ── Sezione Area di Installazione ── */}
      <div style={{ marginTop: 12 }}>
        <p style={sectionTitle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PenLine size={10} color="var(--accent)" />
            {t('building.install_area')}
          </span>
        </p>
        <hr style={separator} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Zone finalizzate */}
          {finalizedZones.map((zone) => (
            <div
              key={zone.id}
              onClick={() => selectZone(zone.id === activeZoneId ? null : zone.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 8px', borderRadius: 8,
                border: `1px solid ${zone.id === activeZoneId ? 'rgba(217,119,87,0.4)' : 'var(--border)'}`,
                background: zone.id === activeZoneId ? 'rgba(217,119,87,0.08)' : 'var(--glass)',
                cursor: 'pointer', transition: 'border-color 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={13} color="var(--teal)" />
                <span style={{ fontSize: 11, color: 'var(--text1)', fontWeight: 500 }}>{zone.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>{t('building.zone_vertices', { count: zone.vertices.length })}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeZone(zone.id); }}
                style={{
                  background: 'none', border: 'none', padding: 2,
                  cursor: 'pointer', color: 'var(--text3)', display: 'flex',
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {/* Disegno in corso */}
          {isDrawingPolygon && (
            <div style={{
              padding: 10, borderRadius: 8,
              border: '1px solid rgba(217,119,87,0.3)',
              background: 'var(--glass)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
                  {t('building.drawing')}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface)', padding: '1px 6px', borderRadius: 99 }}>
                  {t('building.zone_vertices', { count: activeVertices.length })}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  onClick={closePolygon}
                  disabled={activeVertices.length < 3}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    padding: '5px 0', borderRadius: 6, border: 'none', fontSize: 11,
                    cursor: activeVertices.length >= 3 ? 'pointer' : 'not-allowed',
                    background: activeVertices.length >= 3 ? 'var(--teal)' : 'var(--surface2)',
                    color: activeVertices.length >= 3 ? '#fff' : 'var(--text3)',
                    fontWeight: 500,
                  }}
                >
                  <CheckCircle size={13} /> {t('building.close_polygon')}
                </button>
                <button
                  onClick={clearPolygon}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    padding: '5px 0', borderRadius: 6,
                    border: '1px solid var(--border)', fontSize: 11,
                    cursor: 'pointer', background: 'var(--surface)',
                    color: 'var(--text2)', fontWeight: 500,
                  }}
                >
                  <X size={13} /> {t('building.cancel_drawing')}
                </button>
              </div>
            </div>
          )}

          {/* Pulsante Disegna area */}
          {!isDrawingPolygon && (
            <button
              onClick={startDrawingPolygon}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '7px 0', borderRadius: 8, border: 'none',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: 'var(--accent)', color: '#fff', transition: 'opacity 0.2s',
              }}
            >
              <PenLine size={14} /> {t('building.draw_area')}
            </button>
          )}

          {/* Rimuovi tutte */}
          {finalizedZones.length > 1 && !isDrawingPolygon && (
            <button
              onClick={clearAllZones}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '5px 0', borderRadius: 6,
                border: '1px solid rgba(201,64,48,0.3)', fontSize: 12,
                cursor: 'pointer', background: 'rgba(201,64,48,0.08)',
                color: '#C94030', fontWeight: 500,
              }}
            >
              <Trash2 size={12} /> {t('building.remove_all_zones')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModelCard;
