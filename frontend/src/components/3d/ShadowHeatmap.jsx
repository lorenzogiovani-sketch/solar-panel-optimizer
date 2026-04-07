import React, { useMemo } from 'react';
import useStore from '../../store/useStore';
import * as THREE from 'three';

// Genera la griglia wireframe per visualizzare i confini delle celle
function GridOverlay({ gridWidth, gridHeight, cols, rows, position, rotation, geometry }) {
    const lineSegments = useMemo(() => {
        const points = [];
        const cellW = gridWidth / cols;
        const cellH = gridHeight / rows;
        const halfW = gridWidth / 2;
        const halfH = gridHeight / 2;

        // Linee verticali
        for (let i = 0; i <= cols; i++) {
            const x = -halfW + i * cellW;
            points.push(new THREE.Vector3(x, -halfH, 0));
            points.push(new THREE.Vector3(x, halfH, 0));
        }
        // Linee orizzontali
        for (let j = 0; j <= rows; j++) {
            const y = -halfH + j * cellH;
            points.push(new THREE.Vector3(-halfW, y, 0));
            points.push(new THREE.Vector3(halfW, y, 0));
        }

        const geo = new THREE.BufferGeometry().setFromPoints(points);
        return geo;
    }, [gridWidth, gridHeight, cols, rows]);

    if (geometry) {
        // For gable roofs: project grid lines onto the sloped geometry
        return <GableGridOverlay geometry={geometry} cols={cols} rows={rows} />;
    }

    return (
        <lineSegments
            rotation={rotation}
            position={position}
        >
            <primitive object={lineSegments} attach="geometry" />
            <lineBasicMaterial color="#1e293b" opacity={0.4} transparent linewidth={1} />
        </lineSegments>
    );
}

// Grid overlay projected onto gable roof slopes
function GableGridOverlay({ geometry, cols, rows }) {
    const gridGeo = useMemo(() => {
        if (!geometry) return null;

        const posAttr = geometry.getAttribute('position');
        const uvAttr = geometry.getAttribute('uv');
        const index = geometry.getIndex();
        if (!posAttr || !uvAttr || !index) return null;

        const points = [];

        // Sample lines in UV space and map to 3D positions on the surface
        // Vertical lines (constant U)
        for (let i = 0; i <= cols; i++) {
            const u = i / cols;
            const samples = 20;
            for (let s = 0; s < samples; s++) {
                const v1 = s / samples;
                const v2 = (s + 1) / samples;
                const p1 = uvTo3D(u, v1, posAttr, uvAttr, index);
                const p2 = uvTo3D(u, v2, posAttr, uvAttr, index);
                if (p1 && p2) {
                    points.push(p1, p2);
                }
            }
        }
        // Horizontal lines (constant V)
        for (let j = 0; j <= rows; j++) {
            const v = j / rows;
            const samples = 20;
            for (let s = 0; s < samples; s++) {
                const u1 = s / samples;
                const u2 = (s + 1) / samples;
                const p1 = uvTo3D(u1, v, posAttr, uvAttr, index);
                const p2 = uvTo3D(u2, v, posAttr, uvAttr, index);
                if (p1 && p2) {
                    points.push(p1, p2);
                }
            }
        }

        if (points.length === 0) return null;
        return new THREE.BufferGeometry().setFromPoints(points);
    }, [geometry, cols, rows]);

    if (!gridGeo) return null;

    return (
        <lineSegments>
            <primitive object={gridGeo} attach="geometry" />
            <lineBasicMaterial color="#1e293b" opacity={0.4} transparent linewidth={1} />
        </lineSegments>
    );
}

// Map a UV coordinate to 3D position on a triangulated mesh
function uvTo3D(u, v, posAttr, uvAttr, index) {
    const triCount = index.count / 3;
    for (let t = 0; t < triCount; t++) {
        const i0 = index.getX(t * 3);
        const i1 = index.getX(t * 3 + 1);
        const i2 = index.getX(t * 3 + 2);

        const u0 = uvAttr.getX(i0), v0 = uvAttr.getY(i0);
        const u1 = uvAttr.getX(i1), v1 = uvAttr.getY(i1);
        const u2 = uvAttr.getX(i2), v2 = uvAttr.getY(i2);

        const bary = barycentricUV(u, v, u0, v0, u1, v1, u2, v2);
        if (bary) {
            const [a, b, c] = bary;
            const px = posAttr.getX(i0) * a + posAttr.getX(i1) * b + posAttr.getX(i2) * c;
            const py = posAttr.getY(i0) * a + posAttr.getY(i1) * b + posAttr.getY(i2) * c;
            const pz = posAttr.getZ(i0) * a + posAttr.getZ(i1) * b + posAttr.getZ(i2) * c;
            return new THREE.Vector3(px, py, pz);
        }
    }
    return null;
}

function barycentricUV(u, v, u0, v0, u1, v1, u2, v2) {
    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
    if (Math.abs(denom) < 1e-10) return null;
    const a = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / denom;
    const b = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / denom;
    const c = 1 - a - b;
    const eps = -0.001;
    if (a >= eps && b >= eps && c >= eps) return [a, b, c];
    return null;
}


const ShadowHeatmap = () => {
    const shadows = useStore((s) => s.solar.shadows);
    const shadowResolution = useStore((s) => s.solar.shadowResolution);
    const buildingRoofType = useStore((s) => s.building.roofType);
    const buildingRoofAngle = useStore((s) => s.building.roofAngle);
    const buildingDepth = useStore((s) => s.building.depth);
    const buildingHeight = useStore((s) => s.building.height);
    const buildingWidth = useStore((s) => s.building.width);
    const buildingRidgeHeight = useStore((s) => s.building.ridgeHeight);
    const buildingRidgeLength = useStore((s) => s.building.ridgeLength);
    const importedMesh = useStore((s) => s.building.importedMesh);
    const isHighRes = shadowResolution === 'media';

    // Roof height for gable roofs: colmo lungo X, span lungo Z (depth)
    const roofHeight = useMemo(() => {
        if (buildingRoofType !== 'gable') return 0;
        const angleRad = (buildingRoofAngle * Math.PI) / 180;
        return (buildingDepth / 2) * Math.tan(angleRad);
    }, [buildingRoofType, buildingRoofAngle, buildingDepth]);

    // Grid dimensions
    const gridSize = useMemo(() => {
        if (!shadows || !shadows.shadow_grid) return { rows: 0, cols: 0 };
        return {
            rows: shadows.shadow_grid.length,
            cols: shadows.shadow_grid[0]?.length || 0,
        };
    }, [shadows]);

    // Generate texture from shadow grid (NearestFilter for discrete cells)
    const texture = useMemo(() => {
        if (!shadows || !shadows.shadow_grid) return null;

        const grid = shadows.shadow_grid;
        const width = grid[0].length;
        const height = grid.length;
        const size = width * height;
        const data = new Uint8Array(4 * size);

        for (let i = 0; i < size; i++) {
            const row = Math.floor(i / width);
            const col = i % width;

            const val = grid[row][col];
            const stride = i * 4;

            // Sentinel value: -1 / NaN / null = fuori dal poligono → trasparente
            if (val == null || Number.isNaN(val) || val < 0) {
                data[stride] = 0;
                data[stride + 1] = 0;
                data[stride + 2] = 0;
                data[stride + 3] = 0;
                continue;
            }

            // Color Mapping
            // 0.0 -> Green (34, 197, 94)
            // 0.3 -> Yellow (234, 179, 8)
            // 0.7 -> Red (239, 68, 68)
            // 1.0 -> Purple (168, 85, 247)

            let r, g, b;

            if (val <= 0.3) {
                // Green to Yellow
                const t = val / 0.3;
                r = 34 + (234 - 34) * t;
                g = 197 + (179 - 197) * t;
                b = 94 + (8 - 94) * t;
            } else if (val <= 0.7) {
                // Yellow to Red
                const t = (val - 0.3) / 0.4;
                r = 234 + (239 - 234) * t;
                g = 179 + (68 - 179) * t;
                b = 8 + (68 - 8) * t;
            } else {
                // Red to Purple
                const t = (val - 0.7) / 0.3;
                r = 239 + (168 - 239) * t;
                g = 68 + (85 - 68) * t;
                b = 68 + (247 - 68) * t;
            }

            data[stride] = r;
            data[stride + 1] = g;
            data[stride + 2] = b;
            data[stride + 3] = 200; // Alpha (semi-transparent)
        }

        const tex = new THREE.DataTexture(data, width, height);
        tex.needsUpdate = true;
        // Alta risoluzione: LinearFilter per gradienti lisci
        // Bassa/media: NearestFilter per bordi netti tra celle
        const filter = isHighRes ? THREE.LinearFilter : THREE.NearestFilter;
        tex.magFilter = filter;
        tex.minFilter = filter;
        tex.flipY = true;

        return tex;
    }, [shadows, isHighRes]);

    // Custom BufferGeometry for gable roof: two inclined quads matching the slopes
    // Colmo lungo X (E-W), falde verso ±Z (Nord/Sud)
    const gableGeometry = useMemo(() => {
        if (!shadows || buildingRoofType !== 'gable' || roofHeight <= 0) return null;

        const { min_x, max_x, min_z, max_z } = shadows.grid_bounds;
        const gridD = max_z - min_z;
        const midZ = (min_z + max_z) / 2;
        const offset = 0.05; // float slightly above the roof surface
        const yBase = buildingHeight + offset;
        const yPeak = buildingHeight + roofHeight + offset;

        // 8 vertices: 4 per slope (duplicated at ridge for independent face normals)
        const positions = new Float32Array([
            // South slope (z: min_z → midZ)
            min_x, yBase, min_z,    // 0: south-left-base
            max_x, yBase, min_z,    // 1: south-right-base
            max_x, yPeak, midZ,     // 2: right-peak
            min_x, yPeak, midZ,     // 3: left-peak
            // North slope (z: midZ → max_z)
            min_x, yPeak, midZ,     // 4: left-peak
            max_x, yPeak, midZ,     // 5: right-peak
            max_x, yBase, max_z,    // 6: north-right-base
            min_x, yBase, max_z,    // 7: north-left-base
        ]);

        // UV: top-down orthographic projection
        // With flipY=true: V=0 maps to z=max_z (north), V=1 maps to z=min_z (south)
        const vSouth = 1;
        const vMid = gridD > 0 ? 1 - (midZ - min_z) / gridD : 0.5;
        const vNorth = 0;

        const uvs = new Float32Array([
            // South slope
            0, vSouth,    // 0: left, z=min_z
            1, vSouth,    // 1: right, z=min_z
            1, vMid,      // 2: right, z=midZ
            0, vMid,      // 3: left, z=midZ
            // North slope
            0, vMid,      // 4: left, z=midZ
            1, vMid,      // 5: right, z=midZ
            1, vNorth,    // 6: right, z=max_z
            0, vNorth,    // 7: left, z=max_z
        ]);

        // CCW winding for outward-facing normals
        const indices = [
            0, 2, 1, 0, 3, 2,   // South slope (normal: up + south)
            4, 6, 5, 4, 7, 6,   // North slope (normal: up + north)
        ];

        const geom = new THREE.BufferGeometry();
        geom.setIndex(indices);
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geom.computeVertexNormals();
        return geom;
    }, [shadows, buildingRoofType, buildingHeight, buildingDepth, roofHeight]);

    // Custom BufferGeometry for hip roof: 4 inclined faces matching the slopes
    const hipGeometry = useMemo(() => {
        if (!shadows || buildingRoofType !== 'hip') return null;

        const { min_x, max_x, min_z, max_z } = shadows.grid_bounds;
        const gridW = max_x - min_x;
        const gridD = max_z - min_z;
        if (gridW <= 0 || gridD <= 0) return null;

        const offset = 0.05;
        const yBase = buildingHeight + offset;
        const rh = buildingRidgeHeight || 3;
        const rl = Math.min(buildingRidgeLength || 8, buildingWidth);
        const yPeak = buildingHeight + rh + offset;

        // Ridge endpoints (centred on grid)
        const cx = (min_x + max_x) / 2;
        const cz = (min_z + max_z) / 2;
        const hrl = rl / 2;

        // 6 unique vertices
        // Base corners
        const SW = [min_x, yBase, max_z]; // 0 south-west
        const SE = [max_x, yBase, max_z]; // 1 south-east
        const NE = [max_x, yBase, min_z]; // 2 north-east
        const NW = [min_x, yBase, min_z]; // 3 north-west
        // Ridge ends
        const RW = [cx - hrl, yPeak, cz]; // 4 west ridge
        const RE = [cx + hrl, yPeak, cz]; // 5 east ridge

        // UV: top-down orthographic projection (u = x normalised, v = z normalised)
        // With flipY on texture: v=0 → z=max_z (south), v=1 → z=min_z (north)
        const uv = (pt) => [
            (pt[0] - min_x) / gridW,
            1 - (pt[2] - min_z) / gridD
        ];

        // Build triangles for 4 slopes (no bottom face)
        // South face: SW, SE, RE, RW  (2 triangles)
        // East face:  SE, NE, RE      (1 triangle)
        // North face: NE, NW, RW, RE  (2 triangles)
        // West face:  NW, SW, RW      (1 triangle)
        const tris = [
            // South
            [SW, SE, RE], [SW, RE, RW],
            // East
            [SE, NE, RE],
            // North
            [NE, NW, RW], [NE, RW, RE],
            // West
            [NW, SW, RW],
        ];

        const posArr = [];
        const uvArr = [];
        for (const tri of tris) {
            for (const pt of tri) {
                posArr.push(pt[0], pt[1], pt[2]);
                const [u, v] = uv(pt);
                uvArr.push(u, v);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvArr), 2));
        geom.computeVertexNormals();
        return geom;
    }, [shadows, buildingRoofType, buildingHeight, buildingRidgeHeight, buildingRidgeLength, buildingWidth]);

    if (!shadows || !texture) return null;

    // Hip roof: 4 inclined faces conforming to the roof slopes
    if (buildingRoofType === 'hip' && hipGeometry) {
        return (
            <group>
                <mesh geometry={hipGeometry}>
                    <meshBasicMaterial
                        map={texture}
                        transparent
                        opacity={0.8}
                        side={THREE.DoubleSide}
                        depthTest={false}
                        depthWrite={false}
                    />
                </mesh>
                {!isHighRes && (
                    <GableGridOverlay
                        geometry={hipGeometry}
                        cols={gridSize.cols}
                        rows={gridSize.rows}
                    />
                )}
            </group>
        );
    }

    // Gable roof: two inclined planes conforming to the roof slopes
    if (buildingRoofType === 'gable' && gableGeometry) {
        return (
            <group>
                <mesh geometry={gableGeometry}>
                    <meshBasicMaterial
                        map={texture}
                        transparent
                        opacity={0.8}
                        side={THREE.DoubleSide}
                        depthTest={false}
                        depthWrite={false}
                    />
                </mesh>
                {!isHighRes && (
                    <GableGridOverlay
                        geometry={gableGeometry}
                        cols={gridSize.cols}
                        rows={gridSize.rows}
                    />
                )}
            </group>
        );
    }

    // Flat roof: horizontal plane
    const { min_x, max_x, min_z, max_z, max_roof_y } = shadows.grid_bounds;
    const width = max_x - min_x;
    const depth = max_z - min_z;
    const centerX = (min_x + max_x) / 2;
    const centerZ = (min_z + max_z) / 2;
    // Per modelli importati usiamo max_roof_y dal backend; per parametrici buildingHeight
    const yPos = (importedMesh && max_roof_y != null ? max_roof_y : buildingHeight) + 0.1;

    return (
        <group>
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[centerX, yPos, centerZ]}
                receiveShadow={false}
            >
                <planeGeometry args={[width, depth]} />
                <meshBasicMaterial
                    map={texture}
                    transparent
                    opacity={0.8}
                    side={THREE.DoubleSide}
                    depthTest={false}
                    depthWrite={false}
                />
            </mesh>
            {!isHighRes && (
                <GridOverlay
                    gridWidth={width}
                    gridHeight={depth}
                    cols={gridSize.cols}
                    rows={gridSize.rows}
                    position={[centerX, yPos + 0.01, centerZ]}
                    rotation={[-Math.PI / 2, 0, 0]}
                />
            )}
        </group>
    );
};

export default React.memo(ShadowHeatmap);
