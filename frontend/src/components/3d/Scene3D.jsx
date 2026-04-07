import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky, Grid, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import useStore from '../../store/useStore';
import { calculateBuildingRotation } from '../../utils/coordinates';
import Building from './Building';
import ObstacleDragger from './ObstacleDragger';
import ImportedModel from './ImportedModel';
import SunPath from './SunPath';
import SunLight from './SunLight';
import ShadowHeatmap from './ShadowHeatmap';
import ShadowLegend from '../dashboard/ShadowLegend';
import CompassRose from './CompassRose';
import PanelPlacer from './PanelPlacer';
import OptimizedPanels from './OptimizedPanels';
import InstallationZone from './InstallationZone';
import MeasureTool from './MeasureTool';
import { LayoutGrid, Sparkles, Pencil, Ruler, Sun, Layers, Lock, Unlock } from 'lucide-react';
import ErrorBoundary from '../ui/ErrorBoundary';

/* ── Piano terreno ──────────────────────────────────────────
   raycast = noop → PanelPlacer (e qualsiasi raycaster) lo ignora.
   Niente castShadow / receiveShadow → nessun artefatto ombre. */
const noopRaycast = () => { };
const Ground = React.memo(() => (
    <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        raycast={noopRaycast}
        userData={{ isGround: true }}
    >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#9cb340ff" roughness={1} />
    </mesh>
));

/* ── Cielo dinamico (drei Sky – modello Preetham) ──────────
   sunPosition derivata dalla posizione solare nello store.
   Nessuna mesh intercettabile dal raycaster. */
const DynamicSky = React.memo(() => {
    const sunPath = useStore((s) => s.solar.sunPath);
    const selectedMonth = useStore((s) => s.solar.selectedMonth);
    const selectedHour = useStore((s) => s.solar.selectedHour);
    const dailySimData = useStore((s) => s.dailySimulation.data);
    const playbackIndex = useStore((s) => s.dailySimulation.playbackIndex);

    const sunPosition = useMemo(() => {
        let az = 180, el = 45; // default: sole a sud, 45° elevazione

        // Priorità: simulazione giornaliera
        if (dailySimData?.hourly?.length > 0) {
            const idx = Math.min(playbackIndex, dailySimData.hourly.length - 1);
            const pt = dailySimData.hourly[idx];
            if (pt && pt.solar_elevation > 0) {
                az = pt.solar_azimuth;
                el = pt.solar_elevation;
            }
        } else if (sunPath) {
            const index = sunPath.timestamps.findIndex(t => {
                const d = new Date(t);
                return (d.getMonth() + 1) === selectedMonth && d.getHours() === selectedHour;
            });
            if (index !== -1 && sunPath.elevation[index] > 0) {
                az = sunPath.azimuth[index];
                el = sunPath.elevation[index];
            }
        }

        // Converti azimuth/elevation → vettore Three.js (stesso schema di SunLight)
        const azRad = (az * Math.PI) / 180;
        const elRad = (el * Math.PI) / 180;
        return [
            Math.cos(elRad) * Math.sin(azRad),
            Math.sin(elRad),
            -Math.cos(elRad) * Math.cos(azRad),
        ];
    }, [sunPath, selectedMonth, selectedHour, dailySimData, playbackIndex]);

    return (
        <Sky
            sunPosition={sunPosition}
            turbidity={8}
            rayleigh={2}
            mieCoefficient={0.005}
            mieDirectionalG={0.8}
        />
    );
});

/* ── Piano-guida semi-trasparente per quota installazione ──
   Visibile solo quando installationPlaneY è impostato manualmente. */
const InstallationPlaneGuide = React.memo(() => {
    const installationPlaneY = useStore((s) => s.building.installationPlaneY);
    const importedMesh = useStore((s) => s.building.importedMesh);

    const dims = useMemo(() => {
        if (!importedMesh?.vertices?.length) return null;
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const v of importedMesh.vertices) {
            if (v[0] < minX) minX = v[0];
            if (v[0] > maxX) maxX = v[0];
            if (v[2] < minZ) minZ = v[2];
            if (v[2] > maxZ) maxZ = v[2];
        }
        return {
            w: (maxX - minX) + 4,
            d: (maxZ - minZ) + 4,
        };
    }, [importedMesh]);

    if (!dims) return null;

    return (
        <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, installationPlaneY, 0]}
            renderOrder={5}
        >
            <planeGeometry args={[dims.w, dims.d]} />
            <meshBasicMaterial
                color="#2DD4BF"
                transparent
                opacity={0.15}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
});

const SceneContent = () => {
    // Selettori granulari — solo i dati necessari per evitare re-render inutili
    const buildingWidth = useStore((s) => s.building.width);
    const buildingDepth = useStore((s) => s.building.depth);
    const buildingHeight = useStore((s) => s.building.height);
    const buildingRoofType = useStore((s) => s.building.roofType);
    const buildingRoofAngle = useStore((s) => s.building.roofAngle);
    const buildingRidgeHeight = useStore((s) => s.building.ridgeHeight);
    const buildingRidgeLength = useStore((s) => s.building.ridgeLength);
    const importedMesh = useStore((s) => s.building.importedMesh);
    const modelRotationY = useStore((s) => s.building.modelRotationY);

    const viewMode = useStore((s) => s.optimization.viewMode);
    const optimizationResult = useStore((s) => s.optimization.result);

    const projectAzimuth = useStore((s) => s.project.azimuth);
    const showSunPath = useStore((s) => s.solar.showSunPath);
    const showShadowHeatmap = useStore((s) => s.solar.showShadowHeatmap);

    const activeTab = useStore((s) => s.ui.activeTab);
    const sceneLocked = useStore((s) => s.ui.sceneLocked);
    const dragDisabled = sceneLocked || !['model', 'obstacles'].includes(activeTab);

    const buildingGroupRef = useRef();
    const axesHelper = useMemo(() => new THREE.AxesHelper(2), []);

    const buildingRotationY = useMemo(() => {
        return calculateBuildingRotation(projectAzimuth, modelRotationY || 0);
    }, [projectAzimuth, modelRotationY]);

    return (
        <>
            {/* Luci */}
            <ambientLight intensity={0.6} />
            <hemisphereLight skyColor="#87CEEB" groundColor="#444444" intensity={0.4} />
            <directionalLight
                position={[10, 20, 10]}
                intensity={1.0}
                color="#FFF4E0"
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-near={0.5}
                shadow-camera-far={100}
                shadow-camera-left={-30}
                shadow-camera-right={30}
                shadow-camera-top={30}
                shadow-camera-bottom={-30}
                shadow-bias={-0.001}
            />
            {/* Dynamic SunLight overrides when solar data is available */}
            <SunLight />

            {/* Cielo dinamico */}
            <DynamicSky />

            {/* Helpers - spazio mondo */}
            <Grid args={[50, 50]} cellColor="rgba(160, 105, 55, 0.2)" sectionColor="rgba(160, 105, 55, 0.35)" fadeDistance={30} />
            <primitive object={axesHelper} position={[0, 0.01, 0]} />
            <Ground />

            {/* Rosa dei Venti - spazio mondo */}
            <CompassRose />

            {/* Sun Path - spazio mondo */}
            {showSunPath && <SunPath />}

            {/* Measure Tool - spazio mondo */}
            <MeasureTool />

            {/* Gruppo edificio — ruota con l'azimuth */}
            <group ref={buildingGroupRef} rotation={[0, buildingRotationY, 0]}>
                {importedMesh ? (
                    <ImportedModel data={importedMesh} />
                ) : (
                    <Building
                        width={buildingWidth}
                        depth={buildingDepth}
                        height={buildingHeight}
                        roofType={buildingRoofType}
                        roofAngle={buildingRoofAngle}
                        ridgeHeight={buildingRidgeHeight}
                        ridgeLength={buildingRidgeLength}
                    />
                )}

                {/* Obstacles with drag & drop (disabled outside model/obstacles tabs or when locked) */}
                <ObstacleDragger buildingGroupRef={buildingGroupRef} disabled={dragDisabled} />

                {/* Installation Plane Guide (manual Y override) */}
                <InstallationPlaneGuide />

                {/* Shadow Heatmap on Roof */}
                {showShadowHeatmap && <ShadowHeatmap />}

                {/* Installation Polygon Zone */}
                <InstallationZone buildingGroupRef={buildingGroupRef} />

                {/* Panels: Manual layout (PanelPlacer) or Optimized layout */}
                {viewMode === 'optimized' && optimizationResult ? (
                    <OptimizedPanels />
                ) : (
                    <PanelPlacer buildingGroupRef={buildingGroupRef} />
                )}
            </group>
        </>
    )
}


const LayoutToggleOverlay = () => {
    const { t } = useTranslation();
    const viewMode = useStore((s) => s.optimization.viewMode);
    const result = useStore((s) => s.optimization.result);
    const setViewMode = useStore((s) => s.setViewMode);
    const adoptOptimizedPanels = useStore((s) => s.adoptOptimizedPanels);
    const activeTab = useStore((s) => s.ui.activeTab);

    // Only show on optimization tab when result exists
    if (activeTab !== 'optimization' || !result) return null;

    const btnBase = {
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 6,
        fontSize: 11, fontWeight: 500, cursor: 'pointer',
        border: '1px solid transparent', transition: 'all 0.2s',
        fontFamily: "'Outfit', sans-serif",
    };

    return (
        <div style={{
            position: 'absolute', right: 16, top: 64, zIndex: 10,
            display: 'flex', gap: 4,
            background: 'var(--glass)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            borderRadius: 8, padding: 4, border: '1px solid var(--border)',
            boxShadow: '0 2px 12px rgba(100,60,20,0.08)',
        }}>
            <button
                onClick={() => setViewMode('manual')}
                style={{
                    ...btnBase,
                    background: viewMode === 'manual' ? 'rgba(217,119,87,0.12)' : 'transparent',
                    borderColor: viewMode === 'manual' ? 'rgba(217,119,87,0.3)' : 'transparent',
                    color: viewMode === 'manual' ? 'var(--accent)' : 'var(--text2)',
                }}
            >
                <LayoutGrid size={12} />
                {t('scene.manual')}
            </button>
            <button
                onClick={() => setViewMode('optimized')}
                style={{
                    ...btnBase,
                    background: viewMode === 'optimized' ? 'rgba(184,92,53,0.12)' : 'transparent',
                    borderColor: viewMode === 'optimized' ? 'rgba(184,92,53,0.3)' : 'transparent',
                    color: viewMode === 'optimized' ? 'var(--teal)' : 'var(--text2)',
                }}
            >
                <Sparkles size={12} />
                {t('scene.optimized')}
            </button>
            {viewMode === 'optimized' && (
                <button
                    onClick={() => {
                        if (confirm(t('scene.convert_confirm'))) {
                            adoptOptimizedPanels();
                        }
                    }}
                    style={{
                        ...btnBase,
                        color: 'var(--violet)',
                        borderColor: 'transparent',
                    }}
                >
                    <Pencil size={12} />
                    {t('scene.edit_layout')}
                </button>
            )}
        </div>
    );
};

const BoxSelectionOverlay = () => {
    const isSelectingFaces = useStore((s) => s.building.isSelectingFaces);
    const setSelectionRect = useStore((s) => s.setSelectionRect);

    const [dragStart, setDragStart] = useState(null);
    const [dragEnd, setDragEnd] = useState(null);
    const containerRef = useRef();

    const getRelativeCoords = useCallback((e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }, []);

    const handlePointerDown = useCallback((e) => {
        if (e.button !== 0) return; // solo click sinistro
        e.preventDefault();
        const coords = getRelativeCoords(e);
        setDragStart(coords);
        setDragEnd(coords);
        containerRef.current?.setPointerCapture(e.pointerId);
    }, [getRelativeCoords]);

    const handlePointerMove = useCallback((e) => {
        if (!dragStart) return;
        setDragEnd(getRelativeCoords(e));
    }, [dragStart, getRelativeCoords]);

    const handlePointerUp = useCallback((e) => {
        if (!dragStart) return;
        const end = getRelativeCoords(e);
        containerRef.current?.releasePointerCapture(e.pointerId);

        const dx = Math.abs(end.x - dragStart.x);
        const dy = Math.abs(end.y - dragStart.y);

        // Ignora selezioni troppo piccole (< 10px)
        if (dx > 10 && dy > 10) {
            setSelectionRect({
                x1: dragStart.x,
                y1: dragStart.y,
                x2: end.x,
                y2: end.y,
            });
        }

        setDragStart(null);
        setDragEnd(null);
    }, [dragStart, getRelativeCoords, setSelectionRect]);

    if (!isSelectingFaces) return null;

    // Calcola il rettangolo di selezione per il rendering CSS
    const rectStyle = dragStart && dragEnd ? {
        left: Math.min(dragStart.x, dragEnd.x),
        top: Math.min(dragStart.y, dragEnd.y),
        width: Math.abs(dragEnd.x - dragStart.x),
        height: Math.abs(dragEnd.y - dragStart.y),
    } : null;

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 z-20"
            style={{ cursor: 'crosshair' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {rectStyle && rectStyle.width > 2 && rectStyle.height > 2 && (
                <div
                    className="absolute border-2 border-rose-500 bg-rose-500/15 pointer-events-none"
                    style={rectStyle}
                />
            )}
        </div>
    );
};

const MeasureToolOverlay = () => {
    const { t } = useTranslation();
    const measureMode = useStore((s) => s.ui.measureMode);
    const toggleMeasureMode = useStore((s) => s.toggleMeasureMode);
    const clearMeasurements = useStore((s) => s.clearMeasurements);
    const measureCount = useStore((s) => s.ui.measurements.length);

    return (
        <div className="absolute bottom-4 left-4 z-10 flex gap-2">
            <button
                onClick={toggleMeasureMode}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all
                    ${measureMode
                        ? 'bg-orange-600/30 text-orange-400 border border-orange-500/30'
                        : 'bg-slate-900/70 text-slate-400 hover:text-white border border-slate-700'
                    }`}
                title={t('scene.measure_tool')}
            >
                <Ruler size={14} />
                {t('scene.measure_tool')}
            </button>
            {measureCount > 0 && (
                <button
                    onClick={clearMeasurements}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                        bg-slate-900/70 text-slate-400 hover:text-red-400 border border-slate-700 transition-all"
                    title={t('scene.clear_measures', { count: measureCount })}
                >
                    {t('scene.clear_measures', { count: measureCount })}
                </button>
            )}
        </div>
    );
};

const SunPathToggle = () => {
    const { t } = useTranslation();
    const showSunPath = useStore((s) => s.solar.showSunPath);
    const toggleSunPath = useStore((s) => s.toggleSunPath);

    return (
        <button
            onClick={toggleSunPath}
            style={{
                position: 'absolute',
                top: 66,
                right: 16,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'var(--glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: `1px solid ${showSunPath ? 'rgba(224,140,26,0.4)' : 'var(--border)'}`,
                color: showSunPath ? 'var(--solar)' : 'var(--text2)',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'Outfit', sans-serif",
                cursor: 'pointer',
                transition: 'all 0.2s',
                pointerEvents: 'all',
            }}
        >
            <Sun size={13} />
            {t('scene.sun_path')}
            <span style={{
                fontSize: 8,
                fontWeight: 700,
                padding: '1px 4px',
                borderRadius: 3,
                background: showSunPath ? 'rgba(224,140,26,0.2)' : 'rgba(160,105,55,0.06)',
                color: showSunPath ? 'var(--solar)' : 'var(--text3)',
            }}>
                {showSunPath ? 'ON' : 'OFF'}
            </span>
        </button>
    );
};

const ShadowHeatmapToggle = () => {
    const { t } = useTranslation();
    const showShadowHeatmap = useStore((s) => s.solar.showShadowHeatmap);
    const toggleShadowHeatmap = useStore((s) => s.toggleShadowHeatmap);
    const hasShadows = useStore((s) => !!s.solar.shadows);

    if (!hasShadows) return null;

    return (
        <button
            onClick={toggleShadowHeatmap}
            style={{
                position: 'absolute',
                top: 106,
                right: 16,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'var(--glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: `1px solid ${showShadowHeatmap ? 'rgba(45,212,191,0.4)' : 'var(--border)'}`,
                color: showShadowHeatmap ? 'var(--teal)' : 'var(--text2)',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'Outfit', sans-serif",
                cursor: 'pointer',
                transition: 'all 0.2s',
                pointerEvents: 'all',
            }}
        >
            <Layers size={13} />
            {t('scene.shadow_heatmap')}
            <span style={{
                fontSize: 8,
                fontWeight: 700,
                padding: '1px 4px',
                borderRadius: 3,
                background: showShadowHeatmap ? 'rgba(45,212,191,0.2)' : 'rgba(45,212,191,0.06)',
                color: showShadowHeatmap ? 'var(--teal)' : 'var(--text3)',
            }}>
                {showShadowHeatmap ? 'ON' : 'OFF'}
            </span>
        </button>
    );
};

const SceneLockToggle = () => {
    const { t } = useTranslation();
    const sceneLocked = useStore((s) => s.ui.sceneLocked);
    const toggleSceneLock = useStore((s) => s.toggleSceneLock);
    const activeTab = useStore((s) => s.ui.activeTab);

    // Show only on model/obstacles tabs where drag is relevant
    if (!['model', 'obstacles'].includes(activeTab)) return null;

    return (
        <button
            onClick={toggleSceneLock}
            style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'var(--glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: `1px solid ${sceneLocked ? 'rgba(248,113,113,0.4)' : 'var(--border)'}`,
                color: sceneLocked ? 'var(--red)' : 'var(--text2)',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'Outfit', sans-serif",
                cursor: 'pointer',
                transition: 'all 0.2s',
                pointerEvents: 'all',
            }}
            title={sceneLocked ? t('scene.locked') : t('scene.unlocked')}
        >
            {sceneLocked ? <Lock size={13} /> : <Unlock size={13} />}
            {t('scene.lock_btn')}
        </button>
    );
};

/* ── Costanti posizione iniziale telecamera ─────────────── */
const INITIAL_CAMERA_POS = new THREE.Vector3(20, 15, 20);
const INITIAL_TARGET = new THREE.Vector3(0, 0, 0);

/* ── Reset telecamera con Cmd+H / Ctrl+H ────────────────── */
const CameraResetHandler = () => {
    const { camera, controls } = useThree();
    const isResetting = useRef(false);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
                e.preventDefault();
                isResetting.current = true;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useFrame(() => {
        if (!isResetting.current || !controls) return;
        camera.position.lerp(INITIAL_CAMERA_POS, 0.1);
        controls.target.lerp(INITIAL_TARGET, 0.1);
        controls.update();
        if (
            camera.position.distanceTo(INITIAL_CAMERA_POS) < 0.05 &&
            controls.target.distanceTo(INITIAL_TARGET) < 0.05
        ) {
            camera.position.copy(INITIAL_CAMERA_POS);
            controls.target.copy(INITIAL_TARGET);
            controls.update();
            isResetting.current = false;
        }
    });

    return null;
};

/* ── Vista dall'alto con T (top-down view) ─────────────── */
const CameraNavigationHandler = () => {
    const { camera, controls } = useThree();
    const isTransitioning = useRef(false);
    const targetPos = useRef(new THREE.Vector3());
    const targetLookAt = useRef(new THREE.Vector3());

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.key.toLowerCase() === 't') {
                e.preventDefault();
                const currentTarget = controls?.target || new THREE.Vector3(0, 0, 0);
                targetLookAt.current.copy(currentTarget);
                targetPos.current.set(currentTarget.x, 40, currentTarget.z + 0.01);
                isTransitioning.current = true;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [controls]);

    useFrame(() => {
        if (!isTransitioning.current || !controls) return;
        camera.position.lerp(targetPos.current, 0.1);
        controls.target.lerp(targetLookAt.current, 0.1);
        controls.update();
        if (
            camera.position.distanceTo(targetPos.current) < 0.05 &&
            controls.target.distanceTo(targetLookAt.current) < 0.05
        ) {
            camera.position.copy(targetPos.current);
            controls.target.copy(targetLookAt.current);
            controls.update();
            isTransitioning.current = false;
        }
    });

    return null;
};

const Scene3D = () => {
    const { t } = useTranslation();
    const isSelectingFaces = useStore((s) => s.building.isSelectingFaces);
    const isDrawingPolygon = useStore((s) => s.optimization.isDrawingPolygon);
    const measureMode = useStore((s) => s.ui.measureMode);
    const hasShadows = useStore((s) => !!s.solar.shadows);
    const showShadowHeatmap = useStore((s) => s.solar.showShadowHeatmap);

    return (
        <div className={`w-full h-full bg-slate-100 relative rounded-lg overflow-hidden shadow-inner${isDrawingPolygon || measureMode ? ' cursor-crosshair' : ''}`}>
            <ErrorBoundary fallbackMessage="Errore nel rendering 3D. Prova a ricaricare.">
                <Canvas
                    shadows="soft"
                    camera={{ position: [20, 15, 20], fov: 50 }}
                    className="w-full h-full"
                >
                    <color attach="background" args={['#B0D4F1']} />

                    {/* Fog per profondità — azzurro coerente col cielo */}
                    <fog attach="fog" args={['#B0D4F1', 40, 120]} />

                    <PerformanceMonitor />

                    <SceneContent />

                    <CameraResetHandler />
                    <CameraNavigationHandler />

                    <OrbitControls
                        makeDefault
                        minPolarAngle={0}
                        maxPolarAngle={Math.PI / 2 - 0.05}
                        maxDistance={60}
                        enabled={!isSelectingFaces}
                        enableRotate={!isDrawingPolygon}
                    />
                </Canvas>
            </ErrorBoundary>

            {/* Box Selection Overlay — intercetta mouse quando in modalità selezione */}
            <BoxSelectionOverlay />

            {/* Overlay Info */}
            <div className="absolute left-4 bg-white/90 p-2 rounded shadow text-xs text-slate-600 pointer-events-none" style={{ top: 66 }}>
                {measureMode ? (
                    <>
                        <p className="text-orange-500 font-medium">{t('scene.measure_mode')}</p>
                        <p>{t('scene.measure_click')}</p>
                        <p>{t('scene.measure_esc')}</p>
                        <p>{t('scene.measure_del')}</p>
                    </>
                ) : isSelectingFaces ? (
                    <>
                        <p className="text-rose-600 font-medium">{t('scene.selection_mode')}</p>
                        <p>{t('scene.selection_hint')}</p>
                    </>
                ) : isDrawingPolygon ? (
                    <>
                        <p className="text-amber-600 font-medium">{t('scene.draw_zone')}</p>
                        <p>{t('scene.draw_click')}</p>
                        <p>{t('scene.draw_dblclick')}</p>
                        <p>{t('scene.controls_scroll')}</p>
                    </>
                ) : (
                    <>
                        <p>{t('scene.controls_left')}</p>
                        <p>{t('scene.controls_right')}</p>
                        <p>{t('scene.controls_zoom')}</p>
                        <p>{t('scene.reset_camera')}</p>
                    </>
                )}
            </div>

            {/* Sun Path Toggle */}
            <SunPathToggle />

            {/* Shadow Heatmap Toggle */}
            <ShadowHeatmapToggle />

            {/* Layout Toggle (manual vs optimized) */}
            <LayoutToggleOverlay />

            {/* Measure Tool Toggle */}
            <MeasureToolOverlay />

            {/* Scene Lock Toggle */}
            <SceneLockToggle />

            {/* Shadow Legend Overlay — only when shadow data exists */}
            {hasShadows && showShadowHeatmap && <ShadowLegend />}
        </div>
    );
};

export default Scene3D;
