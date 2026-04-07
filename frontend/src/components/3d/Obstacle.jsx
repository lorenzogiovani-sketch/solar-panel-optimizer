import React from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

const Obstacle = ({
    type = 'box',
    position = [0, 0, 0],
    dimensions = [1, 1, 1],
    rotation = [0, 0, 0],
    tiltAngle = 0,
    trunkHeight = 2.0,
    canopyRadius = 2.0,
    treeShape = 'cone',
    foliageType = 'deciduous',
    transmissivity,
    isHovered = false,
    isDragging = false,
    obstacleId
}) => {
    const [width, height, depth] = dimensions.map((d) => Number(d) || 0);
    const safeTrunkHeight = Number(trunkHeight) || 0;
    const safeCanopyRadius = Number(canopyRadius) || 0;
    const radius = width / 2;
    const tiltRad = ((tiltAngle ?? 0) * Math.PI) / 180;

    const opacity = isDragging ? 0.45 : isHovered ? 0.4 : 0.35;

    if (type === 'tree') {
        // Mese corrente (0-based) per scegliere la trasmissività visiva
        const currentMonth = new Date().getMonth();
        const monthTransmissivity = transmissivity ? transmissivity[currentMonth] : 0.15;

        // Opacità chioma: più trasparente quando trasmissività alta (inverno deciduo)
        const baseCanopyOpacity = Math.max(0.15, 1.0 - monthTransmissivity);
        const canopyOpacity = baseCanopyOpacity * (isDragging ? 1.0 : isHovered ? 0.9 : 0.8);

        const trunkColor = isDragging ? "#a0522d" : isHovered ? "#b5651d" : "#8B4513";
        // Colore chioma: verde in estate, marrone-spoglio in inverno (trasmissività > 0.6)
        const isBareSeason = monthTransmissivity > 0.6;
        const canopyColor = isDragging
            ? (isBareSeason ? "#a08060" : "#32CD32")
            : isHovered
                ? (isBareSeason ? "#907050" : "#2db82d")
                : (isBareSeason ? "#8B7355" : "#228B22");
        // Geometria chioma in base a treeShape
        let canopyMesh;
        if (treeShape === 'sphere') {
            // Sfera: centro a safeTrunkHeight + safeCanopyRadius
            canopyMesh = (
                <mesh castShadow position={[0, safeTrunkHeight + safeCanopyRadius, 0]}>
                    <sphereGeometry args={[safeCanopyRadius, 16, 12]} />
                    <meshStandardMaterial color={canopyColor} roughness={0.6} />
                </mesh>
            );
        } else if (treeShape === 'umbrella') {
            // Ellissoide schiacciato: scala Y×0.5 e X/Z×1.3
            const umbrellaRx = safeCanopyRadius * 1.3;
            const umbrellaRy = safeCanopyRadius * 0.5;
            canopyMesh = (
                <mesh castShadow position={[0, safeTrunkHeight + umbrellaRy, 0]} scale={[1.3, 0.5, 1.3]}>
                    <sphereGeometry args={[safeCanopyRadius, 16, 12]} />
                    <meshStandardMaterial color={canopyColor} roughness={0.6} />
                </mesh>
            );
        } else if (treeShape === 'columnar') {
            // Cilindro stretto e alto: raggio×0.4, altezza×2.5
            const colRadius = safeCanopyRadius * 0.4;
            const colHeight = safeCanopyRadius * 2.5;
            canopyMesh = (
                <mesh castShadow position={[0, safeTrunkHeight + colHeight / 2, 0]}>
                    <cylinderGeometry args={[colRadius, colRadius, colHeight, 12]} />
                    <meshStandardMaterial color={canopyColor} roughness={0.6} />
                </mesh>
            );
        } else {
            // cone (default): cono classico
            const canopyHeight = safeCanopyRadius * 1.5;
            canopyMesh = (
                <mesh castShadow position={[0, safeTrunkHeight + canopyHeight / 2, 0]}>
                    <coneGeometry args={[safeCanopyRadius, canopyHeight, 12]} />
                    <meshStandardMaterial color={canopyColor} roughness={0.6} />
                </mesh>
            );
        }

        return (
            <group position={position} rotation={rotation} userData={{ isObstacle: true, obstacleId }}>
                <group rotation={[tiltRad, 0, 0]}>
                    {/* Tronco */}
                    <mesh castShadow position={[0, safeTrunkHeight / 2, 0]}>
                        <cylinderGeometry args={[0.15, 0.15, safeTrunkHeight, 8]} />
                        <meshStandardMaterial color={trunkColor} roughness={0.8} />
                    </mesh>
                    {/* Chioma */}
                    {canopyMesh}
                </group>
            </group>
        );
    }

    if (type === 'building') {
        const color = isDragging ? "#D4856A" : isHovered ? "#D07050" : "#C94030";
        return (
            <group position={position} rotation={rotation} userData={{ isObstacle: true, obstacleId }}>
                <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
                    <boxGeometry args={[width, height, depth]} />
                    <meshStandardMaterial
                        color={color}
                        roughness={0.5}
                        side={THREE.DoubleSide}
                    />
                    <Edges color="#8B2010" />
                </mesh>
            </group>
        );
    }

    if (type === 'chimney') {
        const color = isDragging ? "#D4856A" : isHovered ? "#D07050" : "#C94030";
        return (
            <group position={position} rotation={rotation} userData={{ isObstacle: true, obstacleId }}>
                <group rotation={[tiltRad, 0, 0]}>
                    <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
                        <boxGeometry args={[width, height, depth]} />
                        <meshStandardMaterial
                            color={color}
                            roughness={0.7}
                            side={THREE.DoubleSide}
                        />
                        <Edges color="#8B2010" />
                    </mesh>
                </group>
            </group>
        );
    }

    if (type === 'antenna') {
        const color = isDragging ? "#a0a0a0" : isHovered ? "#909090" : "#808080";
        return (
            <group position={position} rotation={rotation} userData={{ isObstacle: true, obstacleId }}>
                <group rotation={[tiltRad, 0, 0]}>
                    {/* Palo principale */}
                    <mesh castShadow position={[0, height / 2, 0]}>
                        <cylinderGeometry args={[0.05, 0.05, height, 8]} />
                        <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} />
                    </mesh>
                    {/* Traversa orizzontale (braccio antenna) */}
                    <mesh castShadow position={[0, height * 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
                        <cylinderGeometry args={[0.03, 0.03, width * 2, 6]} />
                        <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} />
                    </mesh>
                </group>
            </group>
        );
    }

    // Default: box / cylinder (ostacoli da tetto)
    const color = isDragging ? "#D4856A" : isHovered ? "#D07050" : "#C94030";

    return (
        <group position={position} rotation={rotation} userData={{ isObstacle: true, obstacleId }}>
            <group rotation={[tiltRad, 0, 0]}>
                <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
                    {type === 'cylinder' ? (
                        <cylinderGeometry args={[radius, radius, height, 16]} />
                    ) : (
                        <boxGeometry args={[width, height, depth]} />
                    )}

                    <meshStandardMaterial
                        color={color}
                        roughness={0.3}
                        side={THREE.DoubleSide}
                    />
                    <Edges color="#8B2010" />
                </mesh>
            </group>
        </group>
    );
};

export default Obstacle;
