import React, { useMemo, useEffect, useRef } from 'react';
import useStore from '../../store/useStore';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { sphericalToCartesian } from '../../utils/coordinates';

const SunLight = ({ radius = 30 }) => {
    const sunPath = useStore((s) => s.solar.sunPath);
    const selectedMonth = useStore((s) => s.solar.selectedMonth);
    const selectedHour = useStore((s) => s.solar.selectedHour);
    const dailySimData = useStore((s) => s.dailySimulation.data);
    const playbackIndex = useStore((s) => s.dailySimulation.playbackIndex);
    const lightRef = useRef();

    const sunData = useMemo(() => {
        // Priority: daily simulation playback overrides static sun position
        if (dailySimData?.hourly?.length > 0) {
            const idx = Math.min(
                playbackIndex,
                dailySimData.hourly.length - 1
            );
            const point = dailySimData.hourly[idx];
            if (point && point.solar_elevation > 0) {
                return {
                    azimuth: point.solar_azimuth,
                    elevation: point.solar_elevation,
                };
            }
        }

        // Fallback: static sun path data
        if (!sunPath) return null;

        const index = sunPath.timestamps.findIndex(t => {
            const date = new Date(t);
            return (date.getMonth() + 1) === selectedMonth && date.getHours() === selectedHour;
        });

        if (index !== -1) {
            return {
                azimuth: sunPath.azimuth[index],
                elevation: sunPath.elevation[index]
            };
        }
        return null;
    }, [sunPath, selectedMonth, selectedHour, dailySimData, playbackIndex]);

    useEffect(() => {
        if (sunData && lightRef.current) {
            const pos = new THREE.Vector3(...sphericalToCartesian(sunData.azimuth, sunData.elevation, radius));
            lightRef.current.position.copy(pos);

            const intensity = Math.max(0, Math.sin((sunData.elevation * Math.PI) / 180)) * 1.5;
            lightRef.current.intensity = intensity;

            lightRef.current.updateMatrixWorld();
        }
    }, [sunData, radius]);

    if (!sunData || sunData.elevation <= 0) return null;

    return (
        <directionalLight
            ref={lightRef}
            castShadow
            intensity={1}
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-20}
            shadow-camera-right={20}
            shadow-camera-top={20}
            shadow-camera-bottom={-20}
            shadow-bias={-0.0001}
        />
    );
};

export default React.memo(SunLight);
