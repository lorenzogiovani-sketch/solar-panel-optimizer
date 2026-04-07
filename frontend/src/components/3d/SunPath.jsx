import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import * as THREE from 'three';
import { Line, Sphere, Html } from '@react-three/drei';
import { sphericalToCartesian } from '../../utils/coordinates';

const SunPath = ({ radius = 30 }) => {
    const { t } = useTranslation();
    const sunPath = useStore((s) => s.solar.sunPath);
    const selectedMonth = useStore((s) => s.solar.selectedMonth);
    const selectedHour = useStore((s) => s.solar.selectedHour);
    const dailySimData = useStore((s) => s.dailySimulation.data);
    const playbackIndex = useStore((s) => s.dailySimulation.playbackIndex);

    // Sun position: prioritize daily simulation playback
    const sunPosition = useMemo(() => {
        if (dailySimData?.hourly?.length > 0) {
            const idx = Math.min(
                playbackIndex,
                dailySimData.hourly.length - 1
            );
            const point = dailySimData.hourly[idx];
            if (point && point.solar_elevation > 0) {
                return sphericalToCartesian(point.solar_azimuth, point.solar_elevation, radius);
            }
        }

        if (!sunPath) return null;

        const index = sunPath.timestamps.findIndex(t => {
            const date = new Date(t);
            return (date.getMonth() + 1) === selectedMonth && date.getHours() === selectedHour;
        });

        if (index !== -1) {
            const az = sunPath.azimuth[index];
            const el = sunPath.elevation[index];
            return sphericalToCartesian(az, el, radius);
        }

        return null;
    }, [sunPath, selectedMonth, selectedHour, radius, dailySimData, playbackIndex]);

    // Daily simulation arc (path for the simulated day)
    const dailyArc = useMemo(() => {
        if (!dailySimData?.hourly?.length) return null;
        const controlPoints = dailySimData.hourly
            .filter((h) => h.solar_elevation > 0)
            .map((h) => sphericalToCartesian(h.solar_azimuth, h.solar_elevation, radius));
        if (controlPoints.length < 2) return null;
        const curve = new THREE.CatmullRomCurve3(
            controlPoints.map(p => new THREE.Vector3(p[0], p[1], p[2]))
        );
        const smoothPoints = curve.getPoints(100);
        // Filter out points below horizon
        return smoothPoints
            .filter(p => p.y > 0)
            .map(p => [p.x, p.y, p.z]);
    }, [dailySimData, radius]);

    const paths = useMemo(() => {
        if (!sunPath) return [];

        const dates = [
            { month: 6, day: 21, color: 'orange', labelKey: 'summer' },
            { month: 3, day: 21, color: 'yellow', labelKey: 'equinox' },
            { month: 12, day: 21, color: 'blue', labelKey: 'winter' }
        ];

        return dates.map(target => {
            const controlPoints = [];

            sunPath.timestamps.forEach((ts, i) => {
                const date = new Date(ts);
                if (date.getMonth() + 1 === target.month && date.getDate() === target.day) {
                    const az = sunPath.azimuth[i];
                    const el = sunPath.elevation[i];
                    if (el > 0) {
                        controlPoints.push(sphericalToCartesian(az, el, radius));
                    }
                }
            });

            // Build smooth curve via Catmull-Rom
            let smoothPoints = controlPoints;
            let peakPoint = null;

            if (controlPoints.length >= 2) {
                const curve = new THREE.CatmullRomCurve3(
                    controlPoints.map(p => new THREE.Vector3(p[0], p[1], p[2]))
                );
                const pts = curve.getPoints(100);
                // Filter out points below horizon
                smoothPoints = pts
                    .filter(p => p.y > 0)
                    .map(p => [p.x, p.y, p.z]);

                // Find peak Y point for label
                let maxY = -Infinity;
                for (const p of pts) {
                    if (p.y > maxY) {
                        maxY = p.y;
                        peakPoint = [p.x, p.y + 0.5, p.z];
                    }
                }
            }

            return {
                points: smoothPoints,
                color: target.color,
                labelKey: target.labelKey,
                peakPoint,
            };
        });

    }, [sunPath, radius]);

    const sunPathLabels = t('common.sun_path_labels', { returnObjects: true });

    if (!sunPath && !dailySimData) return null;

    return (
        <group>
            {/* Static Sun Paths */}
            {paths.map((path, i) => (
                path.points.length > 0 && (
                    <React.Fragment key={i}>
                        <Line
                            points={path.points}
                            color={path.color}
                            lineWidth={2}
                            dashed={false}
                        />
                        {path.peakPoint && (
                            <Html position={path.peakPoint} center>
                                <span style={{
                                    color: path.color,
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    textShadow: '0 0 4px rgba(0,0,0,0.8)',
                                    whiteSpace: 'nowrap',
                                    pointerEvents: 'none',
                                    userSelect: 'none',
                                }}>
                                    {sunPathLabels[path.labelKey]}
                                </span>
                            </Html>
                        )}
                    </React.Fragment>
                )
            ))}

            {/* Daily simulation arc */}
            {dailyArc && (
                <Line
                    points={dailyArc}
                    color="#f97316"
                    lineWidth={3}
                    dashed={false}
                />
            )}

            {/* Current Sun Position */}
            {sunPosition && (
                <Sphere args={[1, 32, 32]} position={sunPosition}>
                    <meshBasicMaterial color="#FDB813" />
                </Sphere>
            )}
        </group>
    );
};

export default React.memo(SunPath);
