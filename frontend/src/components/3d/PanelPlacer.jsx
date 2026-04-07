import React, { useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../../store/useStore';
import SolarPanel from './SolarPanel';
import { computeEffectiveTiltAzimuth } from '../../utils/roofGeometry';

const SNAP_STEP = 0.1; // passo snap-to-grid in metri per le frecce direzionali

// ─── Utility AABB ──────────────────────────────────────────

/**
 * Controlla se due rettangoli AABB [min_x, min_z, max_x, max_z] si sovrappongono.
 */
function rectsOverlap(r1, r2) {
    return !(r1[2] <= r2[0] || r2[2] <= r1[0] || r1[3] <= r2[1] || r2[3] <= r1[1]);
}

/**
 * Calcola il bounding rect di un pannello dato il centro (x, z) e le dimensioni.
 */
function panelRect(x, z, w, h) {
    return [x - w / 2, z - h / 2, x + w / 2, z + h / 2];
}

/**
 * Calcola AABB [min_x, min_z, max_x, max_z] di un ostacolo sul tetto.
 * Ritorna null per ostacoli a terra (tree, building).
 */
function obstacleRect(obstacle) {
    const [ox, , oz] = obstacle.position;
    const [ow, , od] = obstacle.dimensions || [1, 1, 1];

    if (obstacle.type === 'tree' || obstacle.type === 'building') {
        return null;
    }
    if (obstacle.type === 'cylinder') {
        const radius = ow / 2;
        return [ox - radius, oz - radius, ox + radius, oz + radius];
    }
    return [ox - ow / 2, oz - od / 2, ox + ow / 2, oz + od / 2];
}

// ─── Collision checks ──────────────────────────────────────

const MIN_DIST = 0.1;
const ROOF_MARGIN = 0.3;

function checkObstacleCollision(px, pz, pw, ph, obstacles) {
    const inflated = panelRect(px, pz, pw + MIN_DIST, ph + MIN_DIST);
    for (const obs of obstacles) {
        const obsR = obstacleRect(obs);
        if (obsR && rectsOverlap(inflated, obsR)) return true;
    }
    return false;
}

function checkPanelOverlap(px, pz, pw, ph, panels, excludeId) {
    const inflated = panelRect(px, pz, pw + MIN_DIST, ph + MIN_DIST);
    return panels.some((p) => {
        if (p.id === excludeId) return false;
        const ew = p.dimensions?.width || pw;
        const eh = p.dimensions?.height || ph;
        const existingRect = panelRect(p.position[0], p.position[2], ew + MIN_DIST, eh + MIN_DIST);
        return rectsOverlap(inflated, existingRect);
    });
}

function checkBoundary(px, pz, pw, ph, building) {
    const halfW = (building.width || 12) / 2 - ROOF_MARGIN;
    const halfD = (building.depth || 10) / 2 - ROOF_MARGIN;
    const r = panelRect(px, pz, pw, ph);
    return r[0] < -halfW || r[2] > halfW || r[1] < -halfD || r[3] > halfD;
}

function lookupIrradianceFactor(x, z, solar) {
    const shadowGrid = solar.shadows?.shadow_grid || null;
    const gridBounds = solar.shadows?.grid_bounds || null;
    if (!shadowGrid || !gridBounds) return 1.0;

    const rows = shadowGrid.length;
    const cols = shadowGrid[0].length;
    const col = Math.round(((x - gridBounds.min_x) / (gridBounds.max_x - gridBounds.min_x)) * (cols - 1));
    const row = Math.round(((z - gridBounds.min_z) / (gridBounds.max_z - gridBounds.min_z)) * (rows - 1));
    const clampedRow = Math.max(0, Math.min(rows - 1, row));
    const clampedCol = Math.max(0, Math.min(cols - 1, col));
    return Math.max(0, 1.0 - shadowGrid[clampedRow][clampedCol]);
}

// ─── Helper: risali la gerarchia per trovare panelId ───────

function findPanelInHit(hit) {
    let obj = hit.object;
    while (obj) {
        if (obj.userData?.isPanel && obj.userData?.panelId != null) {
            return obj.userData.panelId;
        }
        obj = obj.parent;
    }
    return null;
}

// ─── Calcola rotazione pannello dalla normale del tetto ────

function computeRotationFromNormal(faceNormal, hitObject, buildingGroupRef) {
    const normal = faceNormal.clone().transformDirection(hitObject.matrixWorld).normalize();
    if (buildingGroupRef?.current) {
        const groupQuatInverse = buildingGroupRef.current.quaternion.clone().invert();
        normal.applyQuaternion(groupQuatInverse);
    }
    const up = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    return [euler.x, euler.y, euler.z];
}

/**
 * Verifica che una nuova posizione sia valida (no collisioni, no fuori boundary).
 */
function isPositionValid(px, pz, pw, ph, panels, panelId, building) {
    if (checkBoundary(px, pz, pw, ph, building)) return false;
    if (checkPanelOverlap(px, pz, pw, ph, panels, panelId)) return false;
    if (checkObstacleCollision(px, pz, pw, ph, building.obstacles)) return false;
    return true;
}

// ─── Componente PanelPlacer ────────────────────────────────

const PanelPlacer = ({ buildingGroupRef }) => {
    const {
        optimization,
        addPanel,
        removePanel,
        updatePanel,
        setOptimization,
        togglePanelRotation,
        solar,
    } = useStore();
    const building = useStore((state) => state.building);
    const projectAzimuth = useStore((state) => state.project.azimuth);
    const modelRotationY = useStore((state) => state.building.modelRotationY);
    const effectiveBuildingAzimuth = ((projectAzimuth + (modelRotationY || 0)) % 360 + 360) % 360;

    const activeTab = useStore((state) => state.ui.activeTab);
    const isOptimizationActive = activeTab === 'optimization';

    const { raycaster, scene, camera, gl } = useThree();

    // ─── Helper coordinate ───────────────────────────────

    const worldToLocal = useCallback((worldVec) => {
        const local = worldVec.clone();
        if (buildingGroupRef?.current) {
            buildingGroupRef.current.worldToLocal(local);
        }
        return local;
    }, [buildingGroupRef]);

    const getNormalizedMouse = useCallback((e) => {
        const rect = gl.domElement.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
        };
    }, [gl]);

    // ─── Double-click: piazza nuovo pannello ─────────────

    useEffect(() => {
        if (!isOptimizationActive) return;

        const handleDblClick = (e) => {
            if (e.button !== 0) return;
            if (building.isSelectingFaces || optimization.isDrawingPolygon) return;

            const mouse = getNormalizedMouse(e);
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(scene.children, true);

            for (const hit of intersects) {
                if (findPanelInHit(hit) != null) return;

                if (hit.object.userData?.isRoof) {
                    const face = hit.face;
                    if (!face) return;

                    // Offset 0.025m lungo la normale della faccia per evitare z-fighting
                    const normalWorld = face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                    const offsetPoint = hit.point.clone().addScaledVector(normalWorld, 0.025);
                    const localPoint = worldToLocal(offsetPoint);

                    // Per modelli importati: forza Y al piano di installazione e rotazione orizzontale
                    // Leggi stato fresco dallo store per evitare closure stale
                    const currentBuilding = useStore.getState().building;

                    let rotation;
                    if (currentBuilding.importedMesh) {
                        localPoint.y = currentBuilding.installationPlaneY;
                        rotation = [-Math.PI / 2, 0, 0];
                    } else {
                        rotation = computeRotationFromNormal(face.normal, hit.object, buildingGroupRef);
                    }

                    const pw = optimization.panelSpecs.width;
                    const ph = optimization.panelSpecs.height;

                    if (!isPositionValid(localPoint.x, localPoint.z, pw, ph, optimization.panels, null, building)) {
                        return;
                    }

                    const irradianceFactor = lookupIrradianceFactor(localPoint.x, localPoint.z, solar);

                    // Calcola tilt/azimuth effettivi per questo pannello (usati nel calcolo energia per-falda)
                    const eta = computeEffectiveTiltAzimuth(localPoint.x, localPoint.z, building, effectiveBuildingAzimuth);

                    addPanel({
                        position: [localPoint.x, localPoint.y, localPoint.z],
                        rotation,
                        dimensions: { ...optimization.panelSpecs },
                        type: optimization.panelType,
                        irradiance_factor: irradianceFactor,
                        effective_tilt: eta.tilt,
                        effective_azimuth: eta.azimuth,
                        face: eta.face,
                    });
                    return;
                }
            }
        };

        const domEl = gl.domElement;
        domEl.addEventListener('dblclick', handleDblClick);
        return () => domEl.removeEventListener('dblclick', handleDblClick);
    }, [isOptimizationActive, optimization, addPanel, raycaster, scene, camera, gl, building, solar, worldToLocal, buildingGroupRef, getNormalizedMouse, projectAzimuth]);

    // ─── Keyboard: frecce per spostare, R per ruotare ────

    useEffect(() => {
        if (!isOptimizationActive) return;

        const handleKeyDown = (e) => {
            // Ignora se l'utente sta scrivendo in un campo di input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            const state = useStore.getState();
            const selectedId = state.optimization.selectedPanelId;
            if (!selectedId) return;

            const panel = state.optimization.panels.find((p) => p.id === selectedId);
            if (!panel) return;

            const pw = panel.dimensions?.width || state.optimization.panelSpecs.width;
            const ph = panel.dimensions?.height || state.optimization.panelSpecs.height;

            // ── Rotazione con R ──
            if (e.key === 'r' || e.key === 'R') {
                const newW = panel.dimensions?.height || state.optimization.panelSpecs.height;
                const newH = panel.dimensions?.width || state.optimization.panelSpecs.width;

                if (!isPositionValid(panel.position[0], panel.position[2], newW, newH, state.optimization.panels, selectedId, state.building)) {
                    return;
                }

                togglePanelRotation(selectedId);
                e.preventDefault();
                return;
            }

            // ── Spostamento con frecce direzionali ──
            const step = SNAP_STEP;
            let dx = 0;
            let dz = 0;

            switch (e.key) {
                case 'ArrowLeft':  dx = -step; break;
                case 'ArrowRight': dx = +step; break;
                case 'ArrowUp':    dz = -step; break; // -Z = avanti (Nord)
                case 'ArrowDown':  dz = +step; break; // +Z = indietro (Sud)
                default: return; // Non è un tasto freccia
            }

            e.preventDefault(); // Previeni scroll della pagina

            const newX = panel.position[0] + dx;
            const newZ = panel.position[2] + dz;

            // Verifica collisioni alla nuova posizione
            if (!isPositionValid(newX, newZ, pw, ph, state.optimization.panels, selectedId, state.building)) {
                return; // Posizione non valida, non spostare
            }

            // Aggiorna posizione e ricalcola irradiance
            const irradianceFactor = lookupIrradianceFactor(newX, newZ, state.solar);
            updatePanel(selectedId, {
                position: [newX, panel.position[1], newZ],
                irradiance_factor: irradianceFactor,
            });
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOptimizationActive, updatePanel, togglePanelRotation]);

    // ─── Click handler per selezione pannelli ────────────

    const handlePanelClick = (e, id) => {
        if (!isOptimizationActive) return;
        e.stopPropagation();

        if (e.shiftKey) {
            removePanel(id);
        } else {
            setOptimization({ selectedPanelId: id });
        }
    };

    // ─── Render ──────────────────────────────────────────

    if (!isOptimizationActive && optimization.panels.length === 0) return null;

    return (
        <group>
            {optimization.panels.map((panel) => (
                <group key={panel.id} userData={{ isPanel: true, panelId: panel.id }}>
                    <SolarPanel
                        position={panel.position}
                        rotation={panel.rotation}
                        dimensions={panel.dimensions}
                        isSelected={panel.id === optimization.selectedPanelId}
                        onClick={(e) => handlePanelClick(e, panel.id)}
                        variant={panel.source === 'adopted' ? 'adopted' : 'manual'}
                    />
                </group>
            ))}
        </group>
    );
};

export default React.memo(PanelPlacer);
