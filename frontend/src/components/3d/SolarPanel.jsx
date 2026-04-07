import React from 'react';
import { Edges } from '@react-three/drei';

const VARIANT_COLORS = {
    manual: { cell: '#1A3A5C', frame: '#8B7355', edge: '#6B5B3E' },           // Blu scuro realistico + cornice rame
    optimized: { cell: '#1A3A5C', frame: '#D97757', edge: '#B85C35', emissive: '#D97757', emissiveIntensity: 0.3 },  // Emissive arancione
    adopted: { cell: '#1A3A5C', frame: '#E08C1A', edge: '#B87A1A', emissive: '#E08C1A', emissiveIntensity: 0.2 },   // Emissive oro
};

const SolarPanel = ({ position, rotation, dimensions, isSelected, onClick, variant = 'manual', hasCollision = false, isDragging = false }) => {
    // Default dimensions: 1.7m x 1.0m x 0.04m
    const { width = 1.0, height = 1.7 } = dimensions || {};
    const thickness = 0.04;
    const colors = VARIANT_COLORS[variant] || VARIANT_COLORS.manual;

    // Priorità colori: collision (rosso) > selected (oro) > default
    const frameColor = hasCollision ? '#C94030' : isSelected ? '#E08C1A' : colors.frame;
    const edgeColor = hasCollision ? '#8B2010' : isSelected ? '#B87A1A' : colors.edge;
    const cellColor = hasCollision ? '#8B2010' : colors.cell;
    const cellEmissive = hasCollision ? '#000000' : (colors.emissive || '#000000');
    const cellEmissiveIntensity = hasCollision ? 0 : (colors.emissiveIntensity || 0);
    const opacity = isDragging ? 0.7 : 1.0;

    return (
        <group position={position} rotation={rotation} onClick={onClick}>
            {/* Frame / Bordo */}
            <mesh castShadow receiveShadow>
                <boxGeometry args={[width, height, thickness]} />
                <meshStandardMaterial color={frameColor} metalness={0.5} roughness={0.5} transparent={isDragging} opacity={opacity} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
                <Edges color={edgeColor} />
            </mesh>

            {/* Celle Fotovoltaiche (Superficie scura) */}
            <mesh position={[0, 0, thickness / 2 + 0.001]} receiveShadow>
                <planeGeometry args={[width - 0.05, height - 0.05]} />
                <meshPhysicalMaterial
                    color={cellColor}
                    emissive={cellEmissive}
                    emissiveIntensity={cellEmissiveIntensity}
                    metalness={0.8}
                    roughness={0.2}
                    clearcoat={1.0}
                    clearcoatRoughness={0.1}
                    transparent={isDragging}
                    opacity={opacity}
                    polygonOffset
                    polygonOffsetFactor={-2}
                    polygonOffsetUnits={-2}
                />
            </mesh>
        </group>
    );
};

export default SolarPanel;
