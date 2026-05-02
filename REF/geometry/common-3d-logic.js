/**
 * common-3d-logic.js — Geometric validation rules for PCF connections.
 * Encapsulates user-defined ground rules for cleanup and modularization.
 */

const MOD = 'common-3d-logic';

export const Common3DLogic = {
    // Default Fallbacks
    DEFAULTS: {
        MAX_OVERLAP: 1000,
        CONTINUITY_TOL: 6.0,
        MAX_CONTINUITY_TOL: 25.0,
        MIN_PIPE_SIZE: 50,
        MIN_COMPONENT_SIZE: 3,
        MAX_PIPE_RUN: 30000,
        SKEW_3PLANE_LIMIT: 2000,
        SKEW_2PLANE_LIMIT: 15000,
    },

    /**
     * Skew in XZ (Horizontal) is seldom valid.
     */
    isXZSkew: (v) => Math.abs(v.N) < 1e-9 && Math.abs(v.E) > 1e-9 && Math.abs(v.U) > 1e-9,

    /**
     * Validate a potential connection between two points.
     * @param {object} p1 - {E, N, U}
     * @param {object} p2 - {E, N, U}
     * @param {number} bore - Pipe Bore (mm)
     * @param {object} config - Application Config object (optional)
     * @returns {object} { valid: boolean, reason: string, warn: boolean }
     */
    validateConnection: (p1, p2, bore, config) => {
        const settings = config?.coordinateSettings?.common3DLogic ?? Common3DLogic.DEFAULTS;
        const maxRun = settings.maxPipeRun ?? Common3DLogic.DEFAULTS.MAX_PIPE_RUN;
        const skew3Lim = settings.skew3PlaneLimit ?? Common3DLogic.DEFAULTS.SKEW_3PLANE_LIMIT;
        const skew2Lim = settings.skew2PlaneLimit ?? Common3DLogic.DEFAULTS.SKEW_2PLANE_LIMIT;

        const dx = p2.E - p1.E;
        const dy = p2.N - p1.N;
        const dz = p2.U - p1.U;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const vec = len > 1e-9 ? { E: dx/len, N: dy/len, U: dz/len } : { E:0, N:0, U:0 };

        // 9a. Max Run Check
        if (len > maxRun) {
            return { valid: false, reason: `Length ${len.toFixed(0)}mm > Max ${maxRun}mm` };
        }

        // Skew Checks — with slope tolerance (1:100 default).
        // A mildly-sloped pipe (e.g. 13042mm East + 13mm Up, ratio 1:1004) should be treated as
        // single-axis: both the near-zero secondary component AND the near-1 primary component
        // must pass the tolerance before being counted as a genuine skew axis.
        // Strategy: zero out any axis whose raw displacement is ≤ slopeTol × primary displacement,
        // then recompute the unit vector from the effective (tolerance-filtered) displacements.
        const slopeTol = config?.coordinateSettings?.singleAxisSlopeTolerance ?? 0.01; // 1:100
        const primMagRaw = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
        const effDx = (primMagRaw > 0 && Math.abs(dx) / primMagRaw > slopeTol) ? dx : 0;
        const effDy = (primMagRaw > 0 && Math.abs(dy) / primMagRaw > slopeTol) ? dy : 0;
        const effDz = (primMagRaw > 0 && Math.abs(dz) / primMagRaw > slopeTol) ? dz : 0;
        const effLen = Math.sqrt(effDx*effDx + effDy*effDy + effDz*effDz);
        const effVec = effLen > 1e-9 ? { E: effDx/effLen, N: effDy/effLen, U: effDz/effLen } : vec;

        const isSkewX = Math.abs(effVec.E) > 1e-9 && Math.abs(effVec.E) < 1.0;
        const isSkewY = Math.abs(effVec.N) > 1e-9 && Math.abs(effVec.N) < 1.0;
        const isSkewZ = Math.abs(effVec.U) > 1e-9 && Math.abs(effVec.U) < 1.0;
        const skewCount = (isSkewX ? 1 : 0) + (isSkewY ? 1 : 0) + (isSkewZ ? 1 : 0);

        // 2. XZ Skew Check (Horizontal skew, N is 0) — use effVec so mildly-sloped pipes don't trigger
        if (Math.abs(effVec.N) < 1e-9 && isSkewX && isSkewZ) {
             return { valid: false, reason: 'XZ Skew detected (seldom valid)', warn: true };
        }

        // 9b. 3-Plane Skew
        if (skewCount === 3) {
            if (len > skew3Lim) {
                return { valid: false, reason: `3-Plane Skew > ${skew3Lim}mm`, warn: true };
            }
        }

        // 9c. 2-Plane Skew
        if (skewCount === 2) {
            if (len > skew2Lim) {
                return { valid: false, reason: `2-Plane Skew > ${skew2Lim}mm` };
            }
        }

        // 9d. Max Diagonal Gap (Failsafe for Any Axis)
        const maxDiag = settings.maxDiagonalGap ?? 6000;
        if (len > maxDiag && skewCount > 0) {
            return { valid: false, reason: `Length ${len.toFixed(0)}mm > Max Diagonal Gap ${maxDiag}mm` };
        }

        return { valid: true };
    },

    /**
     * Check for rollback (U-turn).
     * @param {object} currentVec - Normalized vector of current pipe segment
     * @param {object} prevVec - Normalized vector of previous segment
     * @returns {boolean} true if rollback detected
     */
    isRollback: (currentVec, prevVec) => {
        if (!prevVec) return false;
        // Dot product close to -1 means opposite direction
        const dot = currentVec.E * prevVec.E + currentVec.N * prevVec.N + currentVec.U * prevVec.U;
        return dot < -0.99;
    }
};
