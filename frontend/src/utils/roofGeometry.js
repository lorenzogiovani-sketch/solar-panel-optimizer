/**
 * Utility condivisa per calcolare la posizione Y e la rotazione di un pannello
 * sulla superficie del tetto, dato il suo centro (posX, posZ) nel piano locale.
 *
 * Usata da OptimizedPanels.jsx e da adoptOptimizedPanels() nello store.
 * Usata anche da ObstaclesCard.jsx per il posizionamento iniziale degli ostacoli.
 */

/**
 * Determina su quale falda del tetto a padiglione cade un punto (x, z).
 * @returns {'south'|'north'|'east'|'west'|null}
 */
export function getHipFace(x, z, halfW, halfD, hrl, slopeRunEW) {
    if (Math.abs(x) > halfW || Math.abs(z) > halfD) return null;

    const absX = Math.abs(x);
    const absZ = Math.abs(z);
    const isNS = absX <= hrl || slopeRunEW <= 0 ||
        absZ * slopeRunEW >= (absX - hrl) * halfD;

    if (isNS) return z >= 0 ? 'south' : 'north';
    return x >= 0 ? 'east' : 'west';
}

/**
 * Calcola i 4 angoli del footprint del pannello nel piano XZ.
 */
export function getPanelCorners(posX, posZ, pw, ph, face, slopeAngle) {
    const hpw = pw / 2;
    const hph = ph / 2;
    const cosA = Math.cos(slopeAngle);
    const corners = [];

    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            if (face === 'south' || face === 'north') {
                corners.push([posX + sx * hpw, posZ - sy * hph * cosA]);
            } else {
                corners.push([posX + sx * hpw * cosA, posZ - sy * hph]);
            }
        }
    }
    return corners;
}

/**
 * Calcola la posizione Y e la rotazione per allineare un ostacolo perpendicolare
 * alla superficie del tetto nel punto (x, z) nel piano locale dell'edificio.
 *
 * @param {number} x - Coordinata X locale
 * @param {number} z - Coordinata Z locale
 * @param {object} building - Stato building dallo store
 * @returns {{ y: number, normalEuler: number[] }} y: altezza sulla superficie del tetto,
 *   normalEuler: [rx, 0, rz] rotazione per allineare l'asse Y locale con la normale della falda
 */
export function computeRoofSurfaceAtPoint(x, z, building) {
    const params = computeRoofParams(building);
    const {
        height, halfW, halfD, isGable, isHip,
        roofAngleRad, gableRidgeHeight,
        rh, hrl, slopeRunEW, flatRoofSurface,
        slopeAngleNS, slopeAngleEW,
    } = params;

    if (isHip) {
        const face = getHipFace(x, z, halfW, halfD, hrl, slopeRunEW);
        if (!face) return { y: height, normalEuler: [0, 0, 0] };

        const isNS = face === 'south' || face === 'north';
        if (isNS) {
            const absZ = Math.abs(z);
            const t = Math.min(absZ / halfD, 1.0);
            const y = height + rh * (1 - t);
            const slopeSign = z >= 0 ? 1 : -1;
            // Ruota attorno a X per allinearsi alla normale della falda NS
            return { y, normalEuler: [slopeSign * slopeAngleNS, 0, 0] };
        } else {
            const absX = Math.abs(x);
            const distFromRidge = absX - hrl;
            const t = slopeRunEW > 0 ? Math.min(distFromRidge / slopeRunEW, 1.0) : 0;
            const y = height + rh * (1 - t);
            const slopeSign = x >= 0 ? 1 : -1;
            // Ruota attorno a Z per allinearsi alla normale della falda EW
            return { y, normalEuler: [0, 0, -slopeSign * slopeAngleEW] };
        }
    } else if (isGable) {
        const absZ = Math.abs(z);
        const t = Math.min(absZ / halfD, 1.0);
        const y = height + gableRidgeHeight * (1 - t);
        const slopeSign = z >= 0 ? 1 : -1;
        // Ruota attorno a X per allinearsi alla normale della falda gable
        return { y, normalEuler: [slopeSign * roofAngleRad, 0, 0] };
    } else {
        return { y: flatRoofSurface, normalEuler: [0, 0, 0] };
    }
}

/**
 * Pre-calcola i parametri del tetto una volta, da riusare per ogni pannello.
 */
export function computeRoofParams(building) {
    const height = building.height || 6;
    const w = building.width || 12;
    const d = building.depth || 10;
    const isGable = building.roofType === 'gable' && building.roofAngle > 0;
    const isHip = building.roofType === 'hip';
    const roofAngleRad = isGable ? (building.roofAngle * Math.PI) / 180 : 0;
    const halfW = w / 2;
    const halfD = d / 2;
    const gableRidgeHeight = isGable ? halfD * Math.tan(roofAngleRad) : 0;

    const rh = building.ridgeHeight || 3;
    const rl = Math.min(building.ridgeLength || 8, w);
    const hrl = rl / 2;
    const slopeRunEW = halfW - hrl;

    const flatRoofSurface = height + 0.22;

    const slopeAngleNS = isHip ? Math.atan2(rh, halfD) : 0;
    const slopeAngleEW = isHip && slopeRunEW > 0 ? Math.atan2(rh, slopeRunEW) : 0;

    return {
        height, halfW, halfD, isGable, isHip,
        roofAngleRad, gableRidgeHeight,
        rh, hrl, slopeRunEW, flatRoofSurface,
        slopeAngleNS, slopeAngleEW,
    };
}

/**
 * Calcola tilt e azimuth effettivi (conv. pvlib) per un punto sul tetto.
 * @param {number} posX - Coordinata X locale del pannello
 * @param {number} posZ - Coordinata Z locale del pannello
 * @param {object} building - Stato building dallo store
 * @param {number} buildingAzimuth - Azimuth edificio in gradi (conv. pvlib: 0=N, 180=S)
 * @returns {{ tilt: number, azimuth: number, face: string }}
 */
export function computeEffectiveTiltAzimuth(posX, posZ, building, buildingAzimuth) {
    const params = computeRoofParams(building);
    const { isGable, isHip, slopeAngleNS, slopeAngleEW, halfW, halfD, hrl, slopeRunEW } = params;

    if (!isGable && !isHip) {
        return { tilt: 0, azimuth: buildingAzimuth, face: 'flat' };
    }

    if (isGable) {
        const tiltDeg = building.roofAngle || 0;
        if (posZ < 0) {
            // local -Z → world direction = buildingAzimuth
            return { tilt: tiltDeg, azimuth: buildingAzimuth, face: 'north' };
        }
        // local +Z → world direction = (buildingAzimuth + 180)
        return { tilt: tiltDeg, azimuth: (buildingAzimuth + 180) % 360, face: 'south' };
    }

    // hip
    const face = getHipFace(posX, posZ, halfW, halfD, hrl, slopeRunEW);
    if (!face) return { tilt: 0, azimuth: buildingAzimuth, face: 'flat' };

    const isNS = face === 'south' || face === 'north';
    const tiltDeg = (isNS ? slopeAngleNS : slopeAngleEW) * 180 / Math.PI;

    const azLookup = {
        north: buildingAzimuth,
        south: (buildingAzimuth + 180) % 360,
        east: ((90 - buildingAzimuth) % 360 + 360) % 360,
        west: ((270 - buildingAzimuth) % 360 + 360) % 360,
    };
    return { tilt: tiltDeg, azimuth: azLookup[face], face };
}

/**
 * Restituisce le superfici del tetto con tilt/azimuth/peso per calcolo irradianza pesata.
 * @param {object} building - Stato building dallo store
 * @param {number} buildingAzimuth - Azimuth edificio (conv. pvlib)
 * @returns {Array<{ tilt: number, azimuth: number, face: string, weight: number }>}
 */
export function computeRoofSurfaces(building, buildingAzimuth) {
    const params = computeRoofParams(building);
    const { isGable, isHip, halfW, halfD, hrl, slopeRunEW, slopeAngleNS, slopeAngleEW, rh } = params;

    if (!isGable && !isHip) {
        return [{ tilt: 0, azimuth: buildingAzimuth, face: 'flat', weight: 1.0 }];
    }

    if (isGable) {
        const tiltDeg = building.roofAngle || 0;
        return [
            { tilt: tiltDeg, azimuth: (buildingAzimuth + 180) % 360, face: 'south', weight: 0.5 },
            { tilt: tiltDeg, azimuth: buildingAzimuth, face: 'north', weight: 0.5 },
        ];
    }

    // hip: 4 falde, peso proporzionale all'area proiettata approssimata
    const nsSlope = Math.sqrt(halfD * halfD + rh * rh);
    const areaNS = 2 * halfW * nsSlope; // 2 falde NS (approssimazione rettangolare)
    const ewRun = slopeRunEW > 0 ? slopeRunEW : 0.01;
    const ewSlope = Math.sqrt(ewRun * ewRun + rh * rh);
    const areaEW = 2 * halfD * ewSlope; // 2 falde EW (approssimazione triangolare)
    const total = areaNS + areaEW;

    const tiltNS = slopeAngleNS * 180 / Math.PI;
    const tiltEW = slopeAngleEW * 180 / Math.PI;

    return [
        { tilt: tiltNS, azimuth: (buildingAzimuth + 180) % 360, face: 'south', weight: areaNS / 2 / total },
        { tilt: tiltNS, azimuth: buildingAzimuth, face: 'north', weight: areaNS / 2 / total },
        { tilt: tiltEW, azimuth: ((90 - buildingAzimuth) % 360 + 360) % 360, face: 'east', weight: areaEW / 2 / total },
        { tilt: tiltEW, azimuth: ((270 - buildingAzimuth) % 360 + 360) % 360, face: 'west', weight: areaEW / 2 / total },
    ];
}

/**
 * Calcola posY e rotation per un singolo pannello sulla superficie del tetto.
 * @param {number} posX - Coordinata X locale del pannello
 * @param {number} posZ - Coordinata Z locale del pannello
 * @param {number} pw - Larghezza pannello (dopo orientamento)
 * @param {number} ph - Altezza pannello (dopo orientamento)
 * @param {object} roofParams - Output di computeRoofParams()
 * @returns {{ posY: number, rotation: number[] } | null} null se il pannello non è valido
 */
export function computeRoofPanelTransform(posX, posZ, pw, ph, roofParams) {
    const {
        height, halfW, halfD, isGable, isHip,
        roofAngleRad, gableRidgeHeight,
        rh, hrl, slopeRunEW, flatRoofSurface,
        slopeAngleNS, slopeAngleEW,
    } = roofParams;

    let posY;
    let rotation;

    if (isHip) {
        const centerFace = getHipFace(posX, posZ, halfW, halfD, hrl, slopeRunEW);
        if (!centerFace) return null;

        const isNS = centerFace === 'south' || centerFace === 'north';
        const slopeAngle = isNS ? slopeAngleNS : slopeAngleEW;

        const corners = getPanelCorners(posX, posZ, pw, ph, centerFace, slopeAngle);
        const allOnSameFace = corners.every(([cx, cz]) =>
            getHipFace(cx, cz, halfW, halfD, hrl, slopeRunEW) === centerFace
        );
        if (!allOnSameFace) return null;

        const absX = Math.abs(posX);
        const absZ = Math.abs(posZ);

        if (isNS) {
            const t = Math.min(absZ / halfD, 1.0);
            posY = height + rh * (1 - t) + 0.05;
            const slopeSign = posZ >= 0 ? 1 : -1;
            rotation = [-Math.PI / 2 + slopeSign * slopeAngleNS, 0, 0];
        } else {
            const distFromRidge = absX - hrl;
            const t = slopeRunEW > 0 ? Math.min(distFromRidge / slopeRunEW, 1.0) : 0;
            posY = height + rh * (1 - t) + 0.05;
            const slopeSign = posX >= 0 ? 1 : -1;
            rotation = [-Math.PI / 2, slopeSign * slopeAngleEW, 0];
        }
    } else if (isGable) {
        const absZ = Math.abs(posZ);
        const t = Math.min(absZ / halfD, 1.0);
        posY = height + gableRidgeHeight * (1 - t) + 0.05;

        const slopeSign = posZ >= 0 ? 1 : -1;
        rotation = [-Math.PI / 2 + slopeSign * roofAngleRad, 0, 0];
    } else {
        posY = flatRoofSurface + 0.025;
        rotation = [-Math.PI / 2, 0, 0];
    }

    return { posY, rotation };
}
