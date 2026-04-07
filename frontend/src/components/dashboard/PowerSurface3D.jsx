import React, { useMemo, useState, useRef, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';

const MONTH_DAY_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MONTH_LABEL_DAYS = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

function colorFromPoa(poa, maxPoa) {
  const t = maxPoa > 0 ? Math.min(poa / maxPoa, 1) : 0;
  // blu → ciano → verde → giallo → rosso
  let r, g, b;
  if (t < 0.25) {
    const s = t / 0.25;
    r = 0; g = s; b = 1;
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = 0; g = 1; b = 1 - s;
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = s; g = 1; b = 0;
  } else {
    const s = (t - 0.75) / 0.25;
    r = 1; g = 1 - s; b = 0;
  }
  return [r, g, b];
}

function SurfaceMesh({ data, curveType, maxPower, maxPoa, onHover }) {
  const meshRef = useRef();

  const geometry = useMemo(() => {
    const nDays = data.days.length;
    const nHours = 24;
    const scaleX = 0.9;
    const scaleY = 200 / (maxPower || 1);
    const scaleZ = 8;

    const positions = new Float32Array(nDays * nHours * 3);
    const colors = new Float32Array(nDays * nHours * 3);

    for (let d = 0; d < nDays; d++) {
      const day = data.days[d];
      for (let h = 0; h < nHours; h++) {
        const idx = d * nHours + h;
        const pt = day.hours[h];
        const power = pt[curveType] || 0;
        const poa = pt.poa_global || 0;

        positions[idx * 3] = d * scaleX;
        positions[idx * 3 + 1] = power * scaleY;
        positions[idx * 3 + 2] = h * scaleZ;

        const [r, g, b] = colorFromPoa(poa, maxPoa);
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
      }
    }

    // Indici: 2 triangoli per cella
    const indices = [];
    for (let d = 0; d < nDays - 1; d++) {
      for (let h = 0; h < nHours - 1; h++) {
        const a = d * nHours + h;
        const b = a + 1;
        const c = (d + 1) * nHours + h;
        const dd = c + 1;
        indices.push(a, b, c);
        indices.push(b, dd, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }, [data, curveType, maxPower, maxPoa]);

  // Raycast hover
  const handlePointerMove = useCallback((e) => {
    e.stopPropagation();
    if (!e.face) return;
    const nHours = 24;
    const scaleX = 0.9;
    const scaleZ = 8;
    const pt = e.point;
    const dayIdx = Math.round(pt.x / scaleX);
    const hourIdx = Math.round(pt.z / scaleZ);
    const nDays = data.days.length;
    if (dayIdx >= 0 && dayIdx < nDays && hourIdx >= 0 && hourIdx < nHours) {
      const day = data.days[dayIdx];
      const hp = day.hours[hourIdx];
      onHover({
        date: day.date,
        dayOfYear: day.day_of_year,
        hour: hourIdx,
        power: hp[curveType] || 0,
        poa: hp.poa_global || 0,
        screenPos: [e.clientX, e.clientY],
      });
    }
  }, [data, curveType, onHover]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => onHover(null)}
    >
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function Axes({ nDays, maxPower, maxPoa }) {
  const { t } = useTranslation();
  const MONTH_ABBR = t('common.months_short', { returnObjects: true });
  const scaleX = 0.9;
  const scaleZ = 8;
  const yMax = 200;
  const xMax = nDays * scaleX;
  const zMax = 23 * scaleZ;

  return (
    <group>
      {/* X axis (giorni) */}
      <Line points={[[0, 0, 0], [xMax, 0, 0]]} color="#666" lineWidth={1} />
      {/* Y axis (potenza) */}
      <Line points={[[0, 0, 0], [0, yMax, 0]]} color="#666" lineWidth={1} />
      {/* Z axis (ore) */}
      <Line points={[[0, 0, 0], [0, 0, zMax]]} color="#666" lineWidth={1} />

      {/* Label assi */}
      <Html position={[xMax / 2, -15, 0]} center style={{ fontSize: 10, color: '#999', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        {t('results.surface_day')}
      </Html>
      <Html position={[-15, yMax / 2, 0]} center style={{ fontSize: 10, color: '#999', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        kW
      </Html>
      <Html position={[0, -15, zMax / 2]} center style={{ fontSize: 10, color: '#999', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        {t('results.surface_hour')}
      </Html>

      {/* Label mesi sull'asse X */}
      {MONTH_ABBR.map((label, i) => (
        <Html
          key={i}
          position={[MONTH_LABEL_DAYS[i] * scaleX, -8, -5]}
          center
          style={{ fontSize: 8, color: '#888', whiteSpace: 'nowrap', pointerEvents: 'none' }}
        >
          {label}
        </Html>
      ))}

      {/* Label ore sull'asse Z (ogni 3 ore) */}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
        <Html
          key={h}
          position={[-8, -5, h * scaleZ]}
          center
          style={{ fontSize: 8, color: '#888', whiteSpace: 'nowrap', pointerEvents: 'none' }}
        >
          {`${h}:00`}
        </Html>
      ))}
    </group>
  );
}

function ColorLegend({ maxPoa }) {
  const { t } = useTranslation();
  const steps = 5;
  const items = [];
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const [r, g, b] = colorFromPoa(frac * maxPoa, maxPoa);
    items.push({
      color: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
      label: `${Math.round(frac * maxPoa)}`,
    });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--text3)', marginTop: 4 }}>
      <span>{t('results.surface_irradiance')} (W/m²):</span>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ width: 12, height: 8, background: it.color, borderRadius: 2 }} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

const PowerSurface3D = ({ data, curveType = 'power_w' }) => {
  const { t } = useTranslation();
  const [hoverInfo, setHoverInfo] = useState(null);

  const maxPower = data?.max_power_w || 1;
  const maxPoa = data?.max_poa || 1;
  const nDays = data?.days?.length || 365;

  if (!data || !data.days) return null;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        width: '100%',
        height: 510,
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--surface2)',
      }}>
        <Canvas
          camera={{ position: [280, 180, 200], fov: 50 }}
          style={{ background: 'transparent' }}
          gl={{ alpha: true }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[100, 200, 100]} intensity={0.8} />
          <SurfaceMesh
            data={data}
            curveType={curveType}
            maxPower={maxPower}
            maxPoa={maxPoa}
            onHover={setHoverInfo}
          />
          <Axes nDays={nDays} maxPower={maxPower} maxPoa={maxPoa} />
          <OrbitControls enableDamping dampingFactor={0.1} />
        </Canvas>
      </div>
      {/* Tooltip esterno al Canvas */}
      {hoverInfo && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 10,
          color: 'var(--text1)',
          lineHeight: 1.7,
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div style={{ fontWeight: 600 }}>{hoverInfo.date}</div>
          <div>{t('results.surface_hour')}: {hoverInfo.hour}:00</div>
          <div>{t('results.surface_power')}: {(hoverInfo.power / 1000).toFixed(2)} kW</div>
          <div>{t('results.surface_irradiance')}: {hoverInfo.poa.toFixed(0)} W/m²</div>
        </div>
      )}
      <ColorLegend maxPoa={maxPoa} />
    </div>
  );
};

export default PowerSurface3D;
