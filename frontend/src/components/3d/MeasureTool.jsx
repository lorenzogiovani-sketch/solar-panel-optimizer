import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import useStore from '../../store/useStore';

const MeasurementLine = ({ measurement }) => {
    const { pointA, pointB, distance } = measurement;

    const midpoint = useMemo(() => [
        (pointA[0] + pointB[0]) / 2,
        (pointA[1] + pointB[1]) / 2,
        (pointA[2] + pointB[2]) / 2,
    ], [pointA, pointB]);

    return (
        <group>
            <Line
                points={[pointA, pointB]}
                color="#D97757"
                lineWidth={2.5}
                depthTest={false}
                renderOrder={30}
            />
            <mesh position={pointA} userData={{ isMeasureTool: true }}>
                <sphereGeometry args={[0.06, 12, 12]} />
                <meshBasicMaterial color="#D97757" depthTest={false} />
            </mesh>
            <mesh position={pointB} userData={{ isMeasureTool: true }}>
                <sphereGeometry args={[0.06, 12, 12]} />
                <meshBasicMaterial color="#D97757" depthTest={false} />
            </mesh>
            <Html position={midpoint} center style={{ pointerEvents: 'none' }}>
                <div style={{
                    background: 'rgba(250, 246, 239, 0.92)',
                    color: '#D97757',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                    border: '1px solid rgba(217, 119, 87, 0.4)',
                }}>
                    {distance.toFixed(2)} m
                </div>
            </Html>
        </group>
    );
};

const MeasureTool = () => {
    const measureMode = useStore((s) => s.ui.measureMode);
    const measurements = useStore((s) => s.ui.measurements);
    const pendingPoint = useStore((s) => s.ui.pendingMeasurePoint);

    const { raycaster, scene, camera, gl } = useThree();

    // Track pointer position to distinguish click from drag
    const pointerDownPos = useRef(null);

    const handlePointerDown = useCallback((e) => {
        if (!useStore.getState().ui.measureMode) return;
        if (e.button !== 0) return;
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handlePointerUp = useCallback((e) => {
        if (!useStore.getState().ui.measureMode) return;
        if (e.button !== 0) return;
        if (!pointerDownPos.current) return;

        // Ignore if the pointer moved more than 5px (it's a drag, not a click)
        const dx = Math.abs(e.clientX - pointerDownPos.current.x);
        const dy = Math.abs(e.clientY - pointerDownPos.current.y);
        pointerDownPos.current = null;
        if (dx > 5 || dy > 5) return;

        const rect = gl.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);

        const hit = intersects.find((h) => !h.object.userData?.isMeasureTool);
        if (!hit) return;

        const point = [hit.point.x, hit.point.y, hit.point.z];
        const state = useStore.getState();

        if (state.ui.pendingMeasurePoint) {
            const pointA = state.ui.pendingMeasurePoint;
            const ddx = point[0] - pointA[0];
            const ddy = point[1] - pointA[1];
            const ddz = point[2] - pointA[2];
            const distance = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            useStore.getState().addMeasurement({ pointA, pointB: point, distance });
        } else {
            useStore.getState().setPendingMeasurePoint(point);
        }
    }, [raycaster, scene, camera, gl]);

    const handleKeyDown = useCallback((e) => {
        if (!useStore.getState().ui.measureMode) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

        if (e.key === 'Escape') {
            const state = useStore.getState();
            if (state.ui.pendingMeasurePoint) {
                useStore.getState().setPendingMeasurePoint(null);
            } else if (state.ui.measurements.length > 0) {
                useStore.getState().removeLastMeasurement();
            } else {
                useStore.getState().setMeasureMode(false);
            }
            e.preventDefault();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            useStore.getState().removeLastMeasurement();
            e.preventDefault();
        }
    }, []);

    useEffect(() => {
        const domEl = gl.domElement;
        domEl.addEventListener('pointerdown', handlePointerDown);
        domEl.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            domEl.removeEventListener('pointerdown', handlePointerDown);
            domEl.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [handlePointerDown, handlePointerUp, handleKeyDown, gl]);

    return (
        <group>
            {measurements.map((m) => (
                <MeasurementLine key={m.id} measurement={m} />
            ))}
            {pendingPoint && (
                <mesh position={pendingPoint} userData={{ isMeasureTool: true }}>
                    <sphereGeometry args={[0.08, 16, 16]} />
                    <meshBasicMaterial color="#D97757" depthTest={false} />
                </mesh>
            )}
        </group>
    );
};

export default React.memo(MeasureTool);
