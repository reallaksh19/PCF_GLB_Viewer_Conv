/**
 * angle-calc.js — Bend angle computation
 * Uses vector dot product to find angle at centre point between two endpoints.
 * Outputs degrees (CAESAR II format) or hundredths-of-a-degree (ISOGEN format).
 *
 * Exports:
 *   computeAngle(ep1, cp, ep2)       → degrees (float)
 *   formatAngle(degrees, format)     → string  e.g. "90" or "9000"
 */

import { warn } from '../logger.js';

const MOD = 'angle-calc';

// ── VECTOR HELPERS (local only) ───────────────────────────────────────────

const _vec = (from, to) => ({
  E: to.E - from.E,
  N: to.N - from.N,
  U: to.U - from.U,
});

const _dot = (a, b) => a.E * b.E + a.N * b.N + a.U * b.U;

const _mag = (v) => Math.sqrt(v.E * v.E + v.N * v.N + v.U * v.U);

// ── MAIN EXPORT ───────────────────────────────────────────────────────────

/**
 * Compute the bend angle at centre point between two endpoints.
 * The angle is the deflection (turn) angle, not the interior angle.
 * For a 90° elbow: vectors ep1→cp and ep2→cp are perpendicular → 90°.
 *
 * @param {{E:number,N:number,U:number}} ep1  - endpoint 1
 * @param {{E:number,N:number,U:number}} cp   - centre point
 * @param {{E:number,N:number,U:number}} ep2  - endpoint 2
 * @returns {number}  angle in degrees, or 90.0 as safe fallback
 */
export const computeAngle = (ep1, cp, ep2) => {
  const v1 = _vec(cp, ep1);   // cp → ep1
  const v2 = _vec(cp, ep2);   // cp → ep2

  const m1 = _mag(v1);
  const m2 = _mag(v2);

  if (m1 < 1e-6 || m2 < 1e-6) {
    warn(MOD, 'computeAngle', 'Zero-length vector detected — using 90° fallback', {
      ep1, cp, ep2, m1, m2,
      hint: 'Check that EP1, EP2, and CENTRE-POINT are distinct coordinates',
    });
    return 90.0;
  }

  // Clamp to [-1, 1] to guard against floating-point errors
  const cosA = Math.max(-1.0, Math.min(1.0, _dot(v1, v2) / (m1 * m2)));
  const angleDeg = (Math.acos(cosA) * 180) / Math.PI;

  if (angleDeg < 0.1 || angleDeg > 179.9) {
    warn(MOD, 'computeAngle', `Unusual bend angle computed: ${angleDeg.toFixed(2)}°`, {
      ep1, cp, ep2, cosA,
      hint: 'Verify that CENTRE-POINT is at the correct elbow tangent intersection',
    });
  }

  return Math.round(angleDeg * 10000) / 10000; // 4 decimal place precision
};

/**
 * Format an angle value for PCF output.
 * @param {number} degrees
 * @param {'degrees'|'hundredths'} format
 * @returns {string}
 */
export const formatAngle = (degrees, format = 'degrees') => {
  if (format === 'hundredths') {
    // ISOGEN native: multiply by 100, output as integer (e.g. 90° → "9000")
    return String(Math.round(degrees * 100));
  }
  // CAESAR II validated: output decimal degrees (e.g. "90" or "45.5")
  const rounded = Math.round(degrees * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};
