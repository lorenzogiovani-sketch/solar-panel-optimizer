import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

const Building = ({ width = 10, depth = 10, height = 6, roofType = 'flat', roofAngle = 15, ridgeHeight = 3, ridgeLength = 8 }) => {

    // Calcolo altezza tetto per Gable (triangolo isoscele)
    // Colmo lungo X (Est-Ovest), span lungo Z (depth), falde verso Nord/Sud
    const roofHeight = useMemo(() => {
        if (roofType === 'flat') return 0;
        const angleRad = (roofAngle * Math.PI) / 180;
        return (depth / 2) * Math.tan(angleRad);
    }, [depth, roofAngle, roofType]);

    // Geometria estrusa per il tetto Gable: triangolo in YZ estruso lungo X (width)
    const gableGeometry = useMemo(() => {
        if (roofType !== 'gable' || roofHeight <= 0) return null;

        // Triangolo nel piano ZY (span = depth, altezza = roofHeight)
        const shape = new THREE.Shape();
        shape.moveTo(-depth / 2, 0);
        shape.lineTo(depth / 2, 0);
        shape.lineTo(0, roofHeight);
        shape.closePath();

        const extrudeSettings = {
            depth: width,
            bevelEnabled: false,
        };

        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        // Centra lungo asse di estrusione
        geom.translate(0, 0, -width / 2);
        // Ruota 90° attorno a Y così il colmo corre lungo X e le falde guardano ±Z
        geom.rotateY(Math.PI / 2);
        return geom;
    }, [width, depth, roofHeight, roofType]);

    // Geometria a piramide / padiglione (Hip Roof)
    const hipGeometry = useMemo(() => {
        if (roofType !== 'hip') return null;

        // Base rectangle: (-w/2, -d/2) to (w/2, d/2) at height 0
        // Ridge line: (-rl/2, 0) to (rl/2, 0) at height rh

        // Clamping the ridge length to not exceed the building width
        const clampedRidgeLength = Math.min(ridgeLength, width);
        const hw = width / 2;
        const hd = depth / 2;
        const hrl = clampedRidgeLength / 2;
        const rh = ridgeHeight;

        // I vertici:
        // 0: South-West base (-hw, 0, hd)
        // 1: South-East base (hw, 0, hd)
        // 2: North-East base (hw, 0, -hd)
        // 3: North-West base (-hw, 0, -hd)
        // 4: West Ridge (-hrl, rh, 0)
        // 5: East Ridge (hrl, rh, 0)

        const vertices = new Float32Array([
            // South Face (CCW) -> 0, 1, 5, 4
            -hw, 0, hd,   // 0
            hw, 0, hd,   // 1
            hrl, rh, 0,  // 5

            -hw, 0, hd,   // 0
            hrl, rh, 0,  // 5
            -hrl, rh, 0,  // 4

            // East Face (CCW) -> 1, 2, 5
            hw, 0, hd,   // 1
            hw, 0, -hd,  // 2
            hrl, rh, 0,  // 5

            // North Face (CCW) -> 2, 3, 4, 5
            hw, 0, -hd,  // 2
            -hw, 0, -hd,  // 3
            -hrl, rh, 0,  // 4

            hw, 0, -hd,  // 2
            -hrl, rh, 0,  // 4
            hrl, rh, 0,  // 5

            // West Face (CCW) -> 3, 0, 4
            -hw, 0, -hd,  // 3
            -hw, 0, hd,   // 0
            -hrl, rh, 0,  // 4

            // Bottom Face (CCW, facing down) -> 0, 3, 2, 1
            -hw, 0, hd,   // 0
            -hw, 0, -hd,  // 3
            hw, 0, -hd,  // 2

            -hw, 0, hd,   // 0
            hw, 0, -hd,  // 2
            hw, 0, hd    // 1
        ]);

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geom.computeVertexNormals();

        return geom;
    }, [width, depth, ridgeHeight, ridgeLength, roofType]);

    return (
        <group position={[0, height / 2, 0]}>
            {/* Base Edificio (Body) */}
            <mesh castShadow receiveShadow position={[0, 0, 0]}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#D4C5A9" roughness={0.7} />
                <Edges color="#8B7355" />
            </mesh>

            {/* Tetto Piatto */}
            {roofType === 'flat' && (
                <mesh position={[0, height / 2 + 0.1, 0]} castShadow receiveShadow userData={{ isRoof: true }}>
                    <boxGeometry args={[width + 0.2, 0.2, depth + 0.2]} />
                    <meshStandardMaterial color="#C8B090" roughness={0.8} />
                    <Edges color="#8B7355" />
                </mesh>
            )}

            {/* Tetto Gable */}
            {roofType === 'gable' && gableGeometry && (
                <mesh
                    geometry={gableGeometry}
                    position={[0, height / 2, 0]}
                    castShadow
                    receiveShadow
                    userData={{ isRoof: true }}
                >
                    <meshStandardMaterial color="#C8B090" roughness={0.8} />
                    <Edges color="#8B7355" />
                </mesh>
            )}

            {/* Tetto Hip */}
            {roofType === 'hip' && hipGeometry && (
                <mesh
                    geometry={hipGeometry}
                    position={[0, height / 2, 0]}
                    castShadow
                    receiveShadow
                    userData={{ isRoof: true }}
                >
                    <meshStandardMaterial color="#C8B090" roughness={0.8} />
                    <Edges color="#8B7355" />
                </mesh>
            )}

        </group>
    );
};

export default React.memo(Building);
