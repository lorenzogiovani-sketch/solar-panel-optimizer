import React, { useMemo } from 'react';
import { Text, Line, Ring } from '@react-three/drei';
import * as THREE from 'three';

// Coordinate system: Right-handed, Y-up
// -Z = North (azimuth 0°), +Z = South (azimuth 180°)
// +X = East (azimuth 90°), -X = West (azimuth 270°)

const DIRECTIONS = [
    { label: 'N', position: [0, 0, -1], color: '#dc2626', bold: true },  // -Z = North
    { label: 'S', position: [0, 0, 1], color: '#64748b', bold: true },   // +Z = South
    { label: 'E', position: [1, 0, 0], color: '#64748b', bold: true },   // +X = East
    { label: 'W', position: [-1, 0, 0], color: '#64748b', bold: true },  // -X = West
];

const CompassRose = ({ radius = 8, y = 0.02 }) => {
    const labelDistance = radius + 1.5;
    const arrowLength = radius;
    const tickLength = radius * 0.15;

    // Points for cardinal lines
    const cardinalLines = useMemo(() => {
        return DIRECTIONS.map(d => ({
            ...d,
            start: [d.position[0] * tickLength, y, d.position[2] * tickLength],
            end: [d.position[0] * arrowLength, y, d.position[2] * arrowLength],
        }));
    }, [arrowLength, tickLength, y]);

    // Intercardinal tick marks (NE, NW, SE, SW)
    const diag = Math.SQRT1_2;
    const intercardinalLines = useMemo(() => {
        const dirs = [
            [diag, -diag],  // NE: +X (East), -Z (North)
            [-diag, -diag], // NW: -X (West), -Z (North)
            [diag, diag],   // SE: +X (East), +Z (South)
            [-diag, diag],  // SW: -X (West), +Z (South)
        ];
        const shortLen = radius * 0.6;
        const innerLen = tickLength;
        return dirs.map(([x, z]) => ({
            start: [x * innerLen, y, z * innerLen],
            end: [x * shortLen, y, z * shortLen],
        }));
    }, [radius, tickLength, y]);

    // Ring circle points
    const ringPoints = useMemo(() => {
        const segments = 64;
        const pts = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            pts.push([
                Math.cos(angle) * radius,
                y,
                Math.sin(angle) * radius,
            ]);
        }
        return pts;
    }, [radius, y]);

    // Inner ring
    const innerRingPoints = useMemo(() => {
        const segments = 64;
        const innerR = radius * 0.3;
        const pts = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            pts.push([
                Math.cos(angle) * innerR,
                y,
                Math.sin(angle) * innerR,
            ]);
        }
        return pts;
    }, [radius, y]);

    // North arrow triangle points
    // After rotation by -π/2 around X, 2D Y maps to 3D -Z
    // So positive Y in the shape will point to -Z (North)
    const arrowSize = 0.8;
    const arrowTip = arrowLength + 0.5;
    const northArrowShape = useMemo(() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, arrowTip);  // Tip points to +Y in 2D → -Z in 3D (North)
        shape.lineTo(-arrowSize * 0.4, arrowLength - arrowSize * 0.3);
        shape.lineTo(arrowSize * 0.4, arrowLength - arrowSize * 0.3);
        shape.closePath();
        return shape;
    }, [arrowLength, arrowSize, arrowTip]);

    return (
        <group>
            {/* Outer ring */}
            <Line
                points={ringPoints}
                color="#94a3b8"
                lineWidth={1.5}
                transparent
                opacity={0.6}
            />

            {/* Inner ring */}
            <Line
                points={innerRingPoints}
                color="#cbd5e1"
                lineWidth={1}
                transparent
                opacity={0.4}
            />

            {/* Cardinal direction lines */}
            {cardinalLines.map((line) => (
                <Line
                    key={line.label}
                    points={[line.start, line.end]}
                    color={line.bold ? '#dc2626' : '#94a3b8'}
                    lineWidth={line.bold ? 2.5 : 1.5}
                    transparent
                    opacity={line.bold ? 0.8 : 0.5}
                />
            ))}

            {/* Intercardinal tick marks */}
            {intercardinalLines.map((line, i) => (
                <Line
                    key={`ic-${i}`}
                    points={[line.start, line.end]}
                    color="#cbd5e1"
                    lineWidth={1}
                    transparent
                    opacity={0.4}
                />
            ))}

            {/* North arrow (triangle) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y + 0.01, 0]}>
                <shapeGeometry args={[northArrowShape]} />
                <meshBasicMaterial color="#dc2626" transparent opacity={0.7} side={THREE.DoubleSide} />
            </mesh>

            {/* Direction labels */}
            {DIRECTIONS.map((d) => (
                <Text
                    key={d.label}
                    position={[
                        d.position[0] * labelDistance,
                        y + 0.05,
                        d.position[2] * labelDistance,
                    ]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    fontSize={d.bold ? 1.4 : 1.0}
                    color={d.color}
                    anchorX="center"
                    anchorY="middle"
                    fontWeight={d.bold ? 'bold' : 'normal'}
                >
                    {d.label}
                </Text>
            ))}
        </group>
    );
};

export default React.memo(CompassRose);
