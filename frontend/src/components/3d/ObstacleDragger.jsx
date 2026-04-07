import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useCursor, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import useStore from '../../store/useStore';
import Obstacle from './Obstacle';

// Tipi di ostacolo che vivono a terra (non sul tetto)
const GROUND_TYPES = ['tree', 'building'];

const isGroundObstacle = (type) => GROUND_TYPES.includes(type);

/* ── Indicatore distanza ostacolo → edificio ─────────────── */
const DragDistanceIndicator = ({ dragDistanceRef }) => {
    const lineRef = useRef();
    const groupRef = useRef();
    const [visible, setVisible] = useState(false);
    const [label, setLabel] = useState('');
    const [midpoint, setMidpoint] = useState([0, 0.5, 0]);
    const [points, setPoints] = useState([[0, 0, 0], [0, 0, 0]]);

    useFrame(() => {
        const data = dragDistanceRef.current;
        if (!data) {
            if (visible) setVisible(false);
            return;
        }
        if (!visible) setVisible(true);

        const from = data.from;
        const to = data.to;
        const dist = data.distance;

        setPoints([from, to]);
        setMidpoint([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 0.3, (from[2] + to[2]) / 2]);
        setLabel(dist.toFixed(2) + ' m');
    });

    if (!visible) return null;

    return (
        <group ref={groupRef}>
            <Line
                ref={lineRef}
                points={points}
                color="#D97757"
                lineWidth={2}
                dashed
                dashSize={0.15}
                gapSize={0.1}
            />
            {/* Sfere endpoint */}
            <mesh position={points[0]}>
                <sphereGeometry args={[0.06, 8, 8]} />
                <meshBasicMaterial color="#D97757" />
            </mesh>
            <mesh position={points[1]}>
                <sphereGeometry args={[0.06, 8, 8]} />
                <meshBasicMaterial color="#D97757" />
            </mesh>
            {/* Label distanza */}
            <Html position={midpoint} center style={{ pointerEvents: 'none' }}>
                <div style={{
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    padding: '2px 6px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                }}>
                    {label}
                </div>
            </Html>
        </group>
    );
};

const ObstacleDragger = ({ buildingGroupRef, disabled = false }) => {
    const obstacles = useStore((s) => s.building.obstacles);
    const updateObstacle = useStore((s) => s.updateObstacle);
    const buildingWidth = useStore((s) => s.building.width);
    const buildingDepth = useStore((s) => s.building.depth);
    const importedMesh = useStore((s) => s.building.importedMesh);
    const { raycaster, scene, camera, gl, controls } = useThree();

    // Ref per dati distanza (evita re-render)
    const dragDistanceRef = useRef(null);

    // Stati locali per drag e hover
    const [dragState, setDragState] = useState({
        isDragging: false,
        obstacleId: null,
        obstacleType: null,
        offset: new THREE.Vector3(),
        plane: null,
        initialPosition: null
    });
    const [hoveredId, setHoveredId] = useState(null);

    // Piano di drag per ostacoli a terra (Y=0, fisso)
    const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

    // Cursor feedback (nessun cursore speciale quando disabled)
    useCursor(hoveredId !== null && !dragState.isDragging && !disabled, 'grab');
    useCursor(dragState.isDragging, 'grabbing');

    // Disabilita OrbitControls durante drag
    useEffect(() => {
        if (controls) {
            controls.enabled = !dragState.isDragging;
        }
    }, [dragState.isDragging, controls]);

    // Helper: converte posizione locale del gruppo → mondo
    const localToWorld = (localPos) => {
        const world = new THREE.Vector3(...localPos);
        if (buildingGroupRef?.current) {
            buildingGroupRef.current.localToWorld(world);
        }
        return world;
    };

    // Helper: converte posizione mondo → locale del gruppo
    const worldToLocal = (worldVec) => {
        const local = worldVec.clone();
        if (buildingGroupRef?.current) {
            buildingGroupRef.current.worldToLocal(local);
        }
        return local;
    };

    // Helper: trova tutte le mesh del tetto nella scena
    const findRoofMeshes = () => {
        const roofMeshes = [];
        scene.traverse((obj) => {
            if (obj.isMesh && obj.userData?.isRoof) {
                roofMeshes.push(obj);
            }
        });
        return roofMeshes;
    };

    // Funzione helper per trovare ostacolo nell'intersezione
    const findObstacleInHit = (hit) => {
        let obj = hit.object;
        while (obj) {
            if (obj.userData?.isObstacle && obj.userData?.obstacleId != null) {
                return obj.userData.obstacleId;
            }
            obj = obj.parent;
        }
        return null;
    };

    // Calcola rotazione Euler per allineare un oggetto alla normale della superficie
    const normalToEuler = (normal) => {
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize());
        const euler = new THREE.Euler().setFromQuaternion(quat);
        return [euler.x, euler.y, euler.z];
    };

    // Calcola distanza dal centro ostacolo al bordo dell'edificio (coordinate locali, piano XZ)
    const computeDistanceToBuilding = (cx, cz) => {
        let halfW, halfD;
        if (importedMesh?.bounds) {
            const b = importedMesh.bounds;
            halfW = (b.max_x - b.min_x) / 2;
            halfD = (b.max_z - b.min_z) / 2;
        } else {
            halfW = buildingWidth / 2;
            halfD = buildingDepth / 2;
        }

        // Punto più vicino sul bordo del rettangolo
        const clampedX = Math.max(-halfW, Math.min(halfW, cx));
        const clampedZ = Math.max(-halfD, Math.min(halfD, cz));

        // Se il punto è dentro il rettangolo, la distanza è 0
        const dx = cx - clampedX;
        const dz = cz - clampedZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        return {
            from: [cx, 0.15, cz],
            to: [clampedX, 0.15, clampedZ],
            distance: dist,
        };
    };

    // Handler per inizio drag
    const handlePointerDown = (e) => {
        if (e.button !== 0) return; // Solo left click

        // Normalizza coordinate mouse
        const rect = gl.domElement.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera({ x, y }, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);

        // Cerca intersezione con ostacolo
        for (let hit of intersects) {
            const obstacleId = findObstacleInHit(hit);
            if (obstacleId != null) {
                const obstacle = obstacles.find(o => o.id === obstacleId);
                if (!obstacle) return;

                const isGround = isGroundObstacle(obstacle.type);

                if (isGround) {
                    // Ostacoli a terra: drag sul piano Y=0
                    const obstacleCenterWorld = localToWorld(obstacle.position);
                    const offset = new THREE.Vector3().subVectors(hit.point, obstacleCenterWorld);
                    offset.y = 0; // Ignora offset verticale

                    setDragState({
                        isDragging: true,
                        obstacleId,
                        obstacleType: obstacle.type,
                        offset,
                        plane: groundPlane,
                        initialPosition: [...obstacle.position]
                    });
                } else {
                    // Ostacoli da tetto: drag sulla superficie del tetto tramite raycast
                    const obstacleCenterWorld = localToWorld(obstacle.position);
                    const offset = new THREE.Vector3().subVectors(hit.point, obstacleCenterWorld);

                    // Usa piano orizzontale come fallback per il drag
                    const fallbackPlane = new THREE.Plane(
                        new THREE.Vector3(0, 1, 0),
                        -obstacleCenterWorld.y
                    );

                    setDragState({
                        isDragging: true,
                        obstacleId,
                        obstacleType: obstacle.type,
                        offset,
                        plane: fallbackPlane,
                        initialPosition: [...obstacle.position]
                    });
                }

                return;
            }
        }
    };

    // Handler per movimento durante drag
    const handlePointerMove = (e) => {
        if (!dragState.isDragging) {
            // Se non stiamo dragging, gestiamo hover
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera({ x, y }, camera);
            const intersects = raycaster.intersectObjects(scene.children, true);

            let foundId = null;
            for (let hit of intersects) {
                const obstacleId = findObstacleInHit(hit);
                if (obstacleId != null) {
                    foundId = obstacleId;
                    break;
                }
            }

            if (foundId !== hoveredId) {
                setHoveredId(foundId);
            }
            return;
        }

        // Durante drag, calcola nuova posizione
        const rect = gl.domElement.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera({ x, y }, camera);

        const isGround = isGroundObstacle(dragState.obstacleType);

        if (isGround) {
            // Ostacoli a terra: interseca con il piano Y=0
            const intersectPoint = new THREE.Vector3();
            const intersected = raycaster.ray.intersectPlane(groundPlane, intersectPoint);

            if (intersected) {
                const newWorldPos = new THREE.Vector3()
                    .subVectors(intersectPoint, dragState.offset);
                newWorldPos.y = 0; // Forza Y=0

                const newLocalPos = worldToLocal(newWorldPos);
                newLocalPos.y = 0; // Assicura Y=0 in locale

                updateObstacle(dragState.obstacleId, {
                    position: [newLocalPos.x, newLocalPos.y, newLocalPos.z]
                });

                // Distanza auto sempre attiva per ostacoli a terra
                dragDistanceRef.current = computeDistanceToBuilding(newLocalPos.x, newLocalPos.z);
            }
        } else {
            // Ostacoli da tetto: raycast sulla mesh del tetto
            const roofMeshes = findRoofMeshes();

            if (roofMeshes.length > 0) {
                const roofHits = raycaster.intersectObjects(roofMeshes, true);

                if (roofHits.length > 0) {
                    const roofHit = roofHits[0];
                    const newWorldPos = roofHit.point.clone();

                    // Converti mondo → locale
                    const newLocalPos = worldToLocal(newWorldPos);

                    // Calcola rotazione per allineare alla pendenza del tetto,
                    // preservando la rotazione Y impostata dall'utente
                    const faceNormal = roofHit.face.normal.clone();
                    faceNormal.transformDirection(roofHit.object.matrixWorld);
                    const surfaceRot = normalToEuler(faceNormal);

                    // Preserva la rotazione Y dell'utente (slider)
                    const obstacle = obstacles.find(o => o.id === dragState.obstacleId);
                    const userRotY = obstacle?.rotation?.[1] ?? 0;
                    const rotation = [surfaceRot[0], userRotY, surfaceRot[2]];

                    updateObstacle(dragState.obstacleId, {
                        position: [newLocalPos.x, newLocalPos.y, newLocalPos.z],
                        rotation
                    });
                    return;
                }
            }

            // Fallback: piano orizzontale (se il tetto non è colpito)
            const intersectPoint = new THREE.Vector3();
            const intersected = raycaster.ray.intersectPlane(dragState.plane, intersectPoint);

            if (intersected) {
                const newWorldPos = new THREE.Vector3()
                    .subVectors(intersectPoint, dragState.offset);
                const newLocalPos = worldToLocal(newWorldPos);

                updateObstacle(dragState.obstacleId, {
                    position: [newLocalPos.x, newLocalPos.y, newLocalPos.z]
                });
            }
        }
    };

    // Handler per fine drag
    const handlePointerUp = () => {
        if (dragState.isDragging) {
            dragDistanceRef.current = null;
            setDragState({
                isDragging: false,
                obstacleId: null,
                obstacleType: null,
                offset: new THREE.Vector3(),
                plane: null,
                initialPosition: null
            });
        }
    };

    // Registra event listeners (solo se non disabled)
    useEffect(() => {
        const domEl = gl.domElement;

        if (disabled) {
            // Quando disabilitato, registra solo hover per cursore not-allowed
            domEl.addEventListener('pointermove', handlePointerMove);
            return () => {
                domEl.removeEventListener('pointermove', handlePointerMove);
            };
        }

        domEl.addEventListener('pointerdown', handlePointerDown);
        domEl.addEventListener('pointermove', handlePointerMove);
        domEl.addEventListener('pointerup', handlePointerUp);
        domEl.addEventListener('pointerleave', handlePointerUp); // Cleanup se esce dal canvas

        return () => {
            domEl.removeEventListener('pointerdown', handlePointerDown);
            domEl.removeEventListener('pointermove', handlePointerMove);
            domEl.removeEventListener('pointerup', handlePointerUp);
            domEl.removeEventListener('pointerleave', handlePointerUp);
        };
    });

    if (!obstacles || obstacles.length === 0) {
        return null;
    }

    return (
        <group>
            {obstacles.map((obs) => (
                <Obstacle
                    key={obs.id}
                    obstacleId={obs.id}
                    type={obs.type}
                    position={obs.position}
                    dimensions={obs.dimensions}
                    rotation={obs.rotation}
                    tiltAngle={obs.tiltAngle}
                    trunkHeight={obs.trunkHeight}
                    canopyRadius={obs.canopyRadius}
                    treeShape={obs.treeShape}
                    foliageType={obs.foliageType}
                    transmissivity={obs.transmissivity}
                    isHovered={obs.id === hoveredId}
                    isDragging={obs.id === dragState.obstacleId}
                />
            ))}
            {dragState.isDragging && isGroundObstacle(dragState.obstacleType) && (
                <DragDistanceIndicator dragDistanceRef={dragDistanceRef} />
            )}
        </group>
    );
};

export default React.memo(ObstacleDragger);
