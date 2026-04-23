/**
 * Coordinate System Utilities
 *
 * Convention mapping:
 *   pvlib azimuth  — 0°=N, 90°=E, 180°=S, 270°=W (clockwise from North)
 *   Reference §1.2 — Ψ = az_pvlib − 180°; Ψ=0°=S, Ψ=−90°=E, Ψ=+90°=W (per Eq. 1.14)
 *   Three.js scene — Y-up, −Z=N, +X=E, +Z=S; sun vector: x=cos(el)·sin(az), z=−cos(el)·cos(az)
 *
 * Convention (Right-Handed, Y-Up):
 * - +Y: Up (vertical, elevation)
 * - -Z: North (azimuth 0°)
 * - +Z: South (azimuth 180°)
 * - +X: East (azimuth 90°)
 * - -X: West (azimuth 270°)
 *
 * This matches standard GIS conventions with Y-up for 3D graphics.
 */

/**
 * Converts spherical solar coordinates to Cartesian coordinates.
 *
 * @param {number} azimuthDeg - Solar azimuth angle in degrees
 *                              (0° = North, 90° = East, 180° = South, 270° = West)
 * @param {number} elevationDeg - Solar elevation angle in degrees
 *                                (0° = horizon, 90° = zenith)
 * @param {number} radius - Distance from origin (typically sun path radius)
 * @returns {[number, number, number]} Cartesian coordinates [x, y, z]
 *
 * @example
 * // Sun at North, 45° elevation, 10 units away
 * sphericalToCartesian(0, 45, 10)    // [0, 7.07, -7.07]
 *
 * @example
 * // Sun at East, 45° elevation, 10 units away
 * sphericalToCartesian(90, 45, 10)   // [7.07, 7.07, 0]
 */
export function sphericalToCartesian(azimuthDeg, elevationDeg, radius) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;

    // Standard spherical to Cartesian conversion with coordinate system alignment:
    // - x: Horizontal component along East-West axis (sin for azimuth)
    // - y: Vertical component (sin for elevation)
    // - z: Horizontal component along North-South axis (negated cos for -Z = North)
    const x = radius * Math.cos(el) * Math.sin(az);
    const y = radius * Math.sin(el);
    const z = -radius * Math.cos(el) * Math.cos(az);  // Negated for -Z = North convention

    return [x, y, z];
}

/**
 * Calculates building rotation angle (Y-axis) based on target solar azimuth.
 * The building's -Z face (default front) is rotated to face the target azimuth direction.
 *
 * @param {number} targetAzimuthDeg - Target azimuth angle in degrees
 *                                    (0° = North, 90° = East, 180° = South, 270° = West)
 * @param {number} modelRotationDeg - Additional manual rotation adjustment in degrees
 *                                    (default: 0)
 * @returns {number} Rotation angle in radians around Y-axis (negative of azimuth)
 *
 * @example
 * // Face building's -Z slope toward South (180°)
 * calculateBuildingRotation(180)  // -π radians (-180°)
 *
 * @example
 * // Face building's -Z slope toward North (0°)
 * calculateBuildingRotation(0)    // 0 radians (0°)
 *
 * @example
 * // Face building's -Z slope toward East (90°) with 15° manual adjustment
 * calculateBuildingRotation(90, 15)  // -1.833 radians (-105°)
 */
export function calculateBuildingRotation(targetAzimuthDeg, modelRotationDeg = 0) {
    // Building's -Z face should point toward the target azimuth direction.
    //
    // Coordinate system: -Z = North (0°), +X = East (90°), +Z = South (180°)
    // Building default: -Z face points to -Z (North, 0°)
    //
    // Three.js R_y(θ) applied to the -Z face vector [0,0,-1] gives [-sin(θ), 0, -cos(θ)].
    // For this to equal the azimuth direction [sin(az), 0, -cos(az)], we need θ = -az.
    //
    // Examples:
    //   - azimuth = 0° (North):   rotation = 0°    → -Z face points to -Z (North)
    //   - azimuth = 90° (East):   rotation = -90°  → -Z face points to +X (East)
    //   - azimuth = 180° (South): rotation = -180° → -Z face points to +Z (South)
    //   - azimuth = 270° (West):  rotation = -270° → -Z face points to -X (West)
    //
    // NOTE: The backend shadow_service applies R_y(+azimuth + modelRot) to sun vectors,
    // which is the exact inverse of this rotation. No backend changes required.
    return (-(targetAzimuthDeg + modelRotationDeg) * Math.PI) / 180;
}
