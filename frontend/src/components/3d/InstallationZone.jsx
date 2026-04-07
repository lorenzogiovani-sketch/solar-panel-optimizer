import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import useStore from '../../store/useStore';

const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3(0, -1, 0);

// Collect meshes that belong to the actual building/model (excluding InstallationZone UI).
function collectBuildingMeshes(group, excludeSet) {
    const meshes = [];
    group.traverse((obj) => {
        if (obj.isMesh && !excludeSet.has(obj)) {
            meshes.push(obj);
        }
    });
    return meshes;
}

// ── Sub-component: renders a single finalized zone polygon ──
const ZonePolygon = ({ zone, isActive, maxRoofY }) => {
    const vertices = zone.vertices;

    const polygonGeometry = useMemo(() => {
        if (vertices.length < 3) return null;
        const contour = vertices.map((p) => new THREE.Vector2(p.x, p.z));
        const faces = THREE.ShapeUtils.triangulateShape(contour, []);
        if (faces.length === 0) return null;

        const positions = new Float32Array(vertices.length * 3);
        vertices.forEach((p, i) => {
            positions[i * 3] = p.x;
            positions[i * 3 + 1] = (p.y ?? maxRoofY) + 0.02;
            positions[i * 3 + 2] = p.z;
        });

        const indices = new Uint16Array(faces.flat());
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setIndex(new THREE.BufferAttribute(indices, 1));
        geom.computeVertexNormals();
        return geom;
    }, [vertices, maxRoofY]);

    const closedLinePoints = useMemo(() => {
        if (vertices.length < 3) return null;
        const pts = vertices.map((p) => [p.x, (p.y ?? maxRoofY) + 0.03, p.z]);
        pts.push(pts[0]);
        return pts;
    }, [vertices, maxRoofY]);

    if (!polygonGeometry) return null;

    return (
        <group>
            <mesh geometry={polygonGeometry} renderOrder={10}>
                <meshBasicMaterial
                    color="#D97757"
                    opacity={isActive ? 0.25 : 0.15}
                    transparent
                    side={THREE.DoubleSide}
                    depthTest={false}
                />
            </mesh>
            {closedLinePoints && (
                <Line
                    points={closedLinePoints}
                    color={isActive ? '#D97757' : '#B85C35'}
                    lineWidth={isActive ? 3 : 2}
                    depthTest={false}
                    renderOrder={15}
                />
            )}
        </group>
    );
};

// ── Main component ──
const InstallationZone = ({ buildingGroupRef }) => {
    const { building, optimization, addPolygonVertex, closePolygon } = useStore();
    const { isDrawingPolygon, installationZones, activeZoneId } = optimization;
    const { width, depth, height, roofType, roofAngle, ridgeHeight, ridgeLength } = building;
    const importedMesh = useStore((s) => s.building.importedMesh);
    const installationPlaneY = useStore((s) => s.building.installationPlaneY);

    const { controls, camera } = useThree();
    const [mousePos, setMousePos] = useState(null);
    const cameraSnapshot = useRef(null);
    const zoneGroupRef = useRef();

    // Derive active zone and finalized zones
    const activeZone = installationZones.find((z) => z.id === activeZoneId);
    const activeVertices = activeZone?.vertices || [];
    const finalizedZones = installationZones.filter(
        (z) => z.vertices.length >= 3 && (!isDrawingPolygon || z.id !== activeZoneId)
    );

    // Compute the maximum roof Y (for interaction plane) and plane dimensions.
    // If installationPlaneY is set, use it as override.
    const { maxRoofY, planeW, planeD } = useMemo(() => {
        if (importedMesh?.vertices?.length) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            for (const v of importedMesh.vertices) {
                if (v[0] < minX) minX = v[0];
                if (v[0] > maxX) maxX = v[0];
                if (v[1] < minY) minY = v[1];
                if (v[1] > maxY) maxY = v[1];
                if (v[2] < minZ) minZ = v[2];
                if (v[2] > maxZ) maxZ = v[2];
            }
            return {
                maxRoofY: installationPlaneY,
                planeW: (maxX - minX) + 4,
                planeD: (maxZ - minZ) + 4,
            };
        }
        let roofPeak = height;
        if (roofType === 'gable') {
            const angleRad = (roofAngle * Math.PI) / 180;
            roofPeak = height + (depth / 2) * Math.tan(angleRad);
        } else if (roofType === 'hip') {
            roofPeak = height + (ridgeHeight || 0);
        }
        return { maxRoofY: roofPeak + 0.15, planeW: width + 4, planeD: depth + 4 };
    }, [importedMesh, installationPlaneY, height, width, depth, roofType, roofAngle, ridgeHeight]);

    // Raycast downward to find the imported model surface Y at (x, z).
    const raycastModelY = useCallback((x, z) => {
        if (!buildingGroupRef?.current) return maxRoofY - 0.15;

        const excludeSet = new Set();
        if (zoneGroupRef.current) {
            zoneGroupRef.current.traverse((obj) => {
                if (obj.isMesh) excludeSet.add(obj);
            });
        }

        const targets = collectBuildingMeshes(buildingGroupRef.current, excludeSet);
        if (targets.length === 0) return maxRoofY - 0.15;

        _rayOrigin.set(x, maxRoofY + 5, z);
        _raycaster.set(_rayOrigin, _rayDir);
        const groupMatrix = buildingGroupRef.current.matrixWorld;
        _raycaster.ray.origin.applyMatrix4(groupMatrix);
        _raycaster.ray.direction.transformDirection(groupMatrix);

        const hits = _raycaster.intersectObjects(targets, false);
        if (hits.length > 0) {
            const localHit = buildingGroupRef.current.worldToLocal(hits[0].point.clone());
            return localHit.y;
        }
        return maxRoofY - 0.15;
    }, [buildingGroupRef, maxRoofY]);

    // Analytical roof Y for parametric roofs.
    const getRoofY = useCallback((x, z) => {
        if (importedMesh?.vertices?.length) {
            return maxRoofY - 0.15;
        }

        if (roofType === 'flat') return height;

        if (roofType === 'gable') {
            const angleRad = (roofAngle * Math.PI) / 180;
            const maxRH = (depth / 2) * Math.tan(angleRad);
            const absZ = Math.abs(z);
            const roofH = Math.max(0, (depth / 2 - absZ) * Math.tan(angleRad));
            return height + Math.min(roofH, maxRH);
        }

        if (roofType === 'hip') {
            const hw = width / 2;
            const hd = depth / 2;
            const rh = ridgeHeight || 0;
            const clampedRL = Math.min(ridgeLength || 0, width);
            const hrl = clampedRL / 2;

            const ySouth = hd > 0 ? rh * (hd - z) / hd : 0;
            const yNorth = hd > 0 ? rh * (hd + z) / hd : 0;

            let roofH;
            if (hrl >= hw) {
                roofH = Math.min(ySouth, yNorth);
            } else {
                const denom = hw - hrl;
                const yEast = rh * (hw - x) / denom;
                const yWest = rh * (hw + x) / denom;
                roofH = Math.min(ySouth, yNorth, yEast, yWest);
            }
            return height + Math.max(0, roofH);
        }

        return height;
    }, [importedMesh, maxRoofY, height, width, depth,
        roofType, roofAngle, ridgeHeight, ridgeLength]);

    // Camera transition to top-down when drawing starts; restore when done.
    useEffect(() => {
        if (!controls || !camera) return;

        if (isDrawingPolygon) {
            cameraSnapshot.current = {
                position: camera.position.clone(),
                target: controls.target.clone(),
            };
            camera.position.set(0, maxRoofY + 28, 0.5);
            controls.target.set(0, maxRoofY * 0.3, 0);
            controls.update();
        } else {
            if (cameraSnapshot.current) {
                camera.position.copy(cameraSnapshot.current.position);
                controls.target.copy(cameraSnapshot.current.target);
                controls.update();
                cameraSnapshot.current = null;
            }
        }

        return () => {
            if (cameraSnapshot.current && controls && camera) {
                camera.position.copy(cameraSnapshot.current.position);
                controls.target.copy(cameraSnapshot.current.target);
                controls.update();
                cameraSnapshot.current = null;
            }
        };
    }, [isDrawingPolygon, controls, camera, maxRoofY]);

    // Convert interaction-plane hit to XZ coords.
    const eventToXZ = useCallback((e) => {
        const local = e.object.worldToLocal(e.point.clone());
        return { x: local.x, z: -local.y };
    }, []);

    // Click handler: compute full {x, y, z}.
    const onPlaneClick = useCallback((e) => {
        if (!isDrawingPolygon) return;
        e.stopPropagation();
        const { x, z } = eventToXZ(e);
        const y = importedMesh?.vertices?.length
            ? raycastModelY(x, z)
            : getRoofY(x, z);
        addPolygonVertex({ x, y, z });
    }, [isDrawingPolygon, addPolygonVertex, eventToXZ, getRoofY, raycastModelY, importedMesh]);

    // Pointer move: cheap path only.
    const onPlanePointerMove = useCallback((e) => {
        if (!isDrawingPolygon) return;
        e.stopPropagation();
        const { x, z } = eventToXZ(e);
        const y = getRoofY(x, z);
        setMousePos({ x, y, z });
    }, [isDrawingPolygon, eventToXZ, getRoofY]);

    const onPlaneDoubleClick = useCallback((e) => {
        if (!isDrawingPolygon) return;
        e.stopPropagation();
        if (activeVertices.length >= 3) {
            closePolygon();
        }
    }, [isDrawingPolygon, activeVertices.length, closePolygon]);

    // --- Visualization data for active zone being drawn ---

    const linePoints = useMemo(() => {
        if (activeVertices.length < 2) return null;
        return activeVertices.map((p) => [p.x, (p.y ?? maxRoofY) + 0.03, p.z]);
    }, [activeVertices, maxRoofY]);

    const previewPoints = useMemo(() => {
        if (!mousePos || activeVertices.length === 0) return null;
        const last = activeVertices[activeVertices.length - 1];
        return [
            [last.x, (last.y ?? maxRoofY) + 0.03, last.z],
            [mousePos.x, (mousePos.y ?? maxRoofY) + 0.03, mousePos.z],
        ];
    }, [mousePos, activeVertices, maxRoofY]);

    // --- Render ---

    const hasDrawingUI = isDrawingPolygon;
    const hasFinalizedZones = finalizedZones.length > 0;

    if (!hasDrawingUI && !hasFinalizedZones) return null;

    return (
        <group ref={zoneGroupRef}>
            {/* Drawing mode for active zone */}
            {hasDrawingUI && (
                <>
                    {/* Interaction plane above roof peak */}
                    <mesh
                        rotation={[-Math.PI / 2, 0, 0]}
                        position={[0, maxRoofY, 0]}
                        onClick={onPlaneClick}
                        onPointerMove={onPlanePointerMove}
                        onDoubleClick={onPlaneDoubleClick}
                        renderOrder={10}
                    >
                        <planeGeometry args={[planeW, planeD]} />
                        <meshBasicMaterial
                            color="#D97757"
                            transparent
                            opacity={0.04}
                            side={THREE.DoubleSide}
                            depthWrite={false}
                        />
                    </mesh>

                    {/* Vertices as yellow spheres */}
                    {activeVertices.map((p, i) => (
                        <mesh
                            key={i}
                            position={[p.x, (p.y ?? maxRoofY) + 0.03, p.z]}
                            renderOrder={20}
                        >
                            <sphereGeometry args={[0.15, 16, 16]} />
                            <meshBasicMaterial color="#D97757" depthTest={false} />
                        </mesh>
                    ))}

                    {/* Lines between placed vertices */}
                    {linePoints && (
                        <Line
                            points={linePoints}
                            color="#D97757"
                            lineWidth={2}
                            depthTest={false}
                            renderOrder={20}
                        />
                    )}

                    {/* Preview line from last vertex to mouse */}
                    {previewPoints && (
                        <Line
                            points={previewPoints}
                            color="#E08C1A"
                            lineWidth={1.5}
                            dashed
                            dashSize={0.2}
                            gapSize={0.1}
                            depthTest={false}
                            renderOrder={20}
                        />
                    )}
                </>
            )}

            {/* All finalized zones */}
            {finalizedZones.map((zone) => (
                <ZonePolygon
                    key={zone.id}
                    zone={zone}
                    isActive={zone.id === activeZoneId}
                    maxRoofY={maxRoofY}
                />
            ))}
        </group>
    );
};

export default React.memo(InstallationZone);
