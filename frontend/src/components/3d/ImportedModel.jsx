import React, { useMemo, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../../store/useStore';

const ImportedModel = ({ data }) => {
    const meshRef = useRef();
    const { camera, size } = useThree();

    const deletedFaces = useStore((s) => s.building.deletedFaces);
    const modelOffsetY = useStore((s) => s.building.modelOffsetY);
    const pendingSelectionRect = useStore((s) => s.building.pendingSelectionRect);
    const batchDeleteFaces = useStore((s) => s.batchDeleteFaces);
    const clearSelectionRect = useStore((s) => s.clearSelectionRect);

    // Geometria originale completa (indici non filtrati)
    const originalGeometry = useMemo(() => {
        if (!data || !data.vertices || !data.faces) return null;

        const geom = new THREE.BufferGeometry();
        const vertices = new Float32Array(data.vertices.flat());
        const indices = new Uint32Array(data.faces.flat());

        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geom.setIndex(new THREE.BufferAttribute(indices, 1));
        geom.computeVertexNormals();

        return geom;
    }, [data]);

    // Geometria filtrata (senza le facce in deletedFaces)
    const filteredGeometry = useMemo(() => {
        if (!originalGeometry) return null;

        const origIndex = originalGeometry.index;
        if (!origIndex || deletedFaces.length === 0) return originalGeometry;

        const deletedSet = new Set(deletedFaces);
        const origArray = origIndex.array;
        const totalFaces = origArray.length / 3;

        const newIndices = [];
        for (let i = 0; i < totalFaces; i++) {
            if (!deletedSet.has(i)) {
                newIndices.push(
                    origArray[i * 3],
                    origArray[i * 3 + 1],
                    origArray[i * 3 + 2]
                );
            }
        }

        const geom = originalGeometry.clone();
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
        geom.computeVertexNormals();

        return geom;
    }, [originalGeometry, deletedFaces]);

    // Processa la box selection: proietta i centri delle facce e elimina quelle dentro il rettangolo
    useEffect(() => {
        if (!pendingSelectionRect || !originalGeometry || !meshRef.current) return;

        const { x1, y1, x2, y2 } = pendingSelectionRect;

        // Converti pixel in NDC (Normalized Device Coordinates)
        const ndcMinX = (Math.min(x1, x2) / size.width) * 2 - 1;
        const ndcMaxX = (Math.max(x1, x2) / size.width) * 2 - 1;
        const ndcMinY = -(Math.max(y1, y2) / size.height) * 2 + 1;
        const ndcMaxY = -(Math.min(y1, y2) / size.height) * 2 + 1;

        const posArray = originalGeometry.attributes.position.array;
        const indexArray = originalGeometry.index.array;
        const totalFaces = indexArray.length / 3;
        const deletedSet = new Set(deletedFaces);
        const facesToDelete = [];

        // Ottieni la matrice mondo della mesh per trasformare posizioni locali → mondo
        meshRef.current.updateMatrixWorld(true);
        const worldMatrix = meshRef.current.matrixWorld;

        const vec = new THREE.Vector3();

        for (let i = 0; i < totalFaces; i++) {
            if (deletedSet.has(i)) continue;

            const a = indexArray[i * 3];
            const b = indexArray[i * 3 + 1];
            const c = indexArray[i * 3 + 2];

            // Centro della faccia in coordinate locali
            vec.set(
                (posArray[a * 3] + posArray[b * 3] + posArray[c * 3]) / 3,
                (posArray[a * 3 + 1] + posArray[b * 3 + 1] + posArray[c * 3 + 1]) / 3,
                (posArray[a * 3 + 2] + posArray[b * 3 + 2] + posArray[c * 3 + 2]) / 3
            );

            // Trasforma in coordinate mondo e proietta in NDC
            vec.applyMatrix4(worldMatrix);
            vec.project(camera);

            // Verifica se il centro proiettato è dentro il rettangolo di selezione
            if (
                vec.x >= ndcMinX && vec.x <= ndcMaxX &&
                vec.y >= ndcMinY && vec.y <= ndcMaxY &&
                vec.z > 0 && vec.z < 1 // visibile (davanti alla camera)
            ) {
                facesToDelete.push(i);
            }
        }

        if (facesToDelete.length > 0) {
            batchDeleteFaces(facesToDelete);
        }

        clearSelectionRect();
    }, [pendingSelectionRect]);

    if (!filteredGeometry) return null;

    return (
        <group position={[0, modelOffsetY, 0]}>
            <mesh
                ref={meshRef}
                geometry={filteredGeometry}
                castShadow
                receiveShadow
                userData={{ isRoof: true }}
            >
                <meshStandardMaterial
                    color="#cbd5e1"
                    roughness={0.5}
                    metalness={0.1}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </group>
    );
};

export default React.memo(ImportedModel);
