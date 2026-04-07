import React, { useMemo } from 'react';
import useStore from '../../store/useStore';
import SolarPanel from './SolarPanel';
import { computeRoofParams, computeRoofPanelTransform } from '../../utils/roofGeometry';

const OptimizedPanels = () => {
    const result = useStore((s) => s.optimization.result);
    const panelSpecs = useStore((s) => s.optimization.panelSpecs);
    const building = useStore((s) => s.building);

    const panels = useMemo(() => {
        if (!result?.panels) return [];

        const isImported = !!building.importedMesh;
        const roofParams = isImported ? null : computeRoofParams(building);
        const validPanels = [];

        for (let i = 0; i < result.panels.length; i++) {
            const p = result.panels[i];
            const posX = p.x ?? 0;
            const posZ = p.y ?? 0;

            const pw = p.orientation === 'landscape' ? panelSpecs.height : panelSpecs.width;
            const ph = p.orientation === 'landscape' ? panelSpecs.width : panelSpecs.height;

            let posY, rotation;
            if (isImported) {
                posY = building.installationPlaneY;
                rotation = [-Math.PI / 2, 0, 0];
            } else {
                const transform = computeRoofPanelTransform(posX, posZ, pw, ph, roofParams);
                if (!transform) continue;
                posY = transform.posY;
                rotation = transform.rotation;
            }

            validPanels.push({
                id: `opt-${i}`,
                position: [posX, posY, posZ],
                rotation,
                dimensions: { width: pw, height: ph },
            });
        }

        return validPanels;
    }, [result, panelSpecs, building]);

    if (panels.length === 0) return null;

    return (
        <group>
            {panels.map((panel) => (
                <SolarPanel
                    key={panel.id}
                    position={panel.position}
                    rotation={panel.rotation}
                    dimensions={panel.dimensions}
                    variant="optimized"
                />
            ))}
        </group>
    );
};

export default React.memo(OptimizedPanels);
