/**
 * direction-calc.js — Dominant axis and direction detection
 * Used for MESSAGE-SQUARE annotation text.
 * Pure functions, no side effects.
 *
 * Exports:
 *   dominantDirection(p1, p2)   → 'NORTH'|'SOUTH'|'EAST'|'WEST'|'UP'|'DOWN'
 *   directionText(p1, p2)       → string e.g. "NORTH" or "NORTH AND UP"
 *   componentLength(p1, p2)     → number (mm)
 */

// ── DIRECTION MAP ─────────────────────────────────────────────────────────
// Maps axis + sign to direction name
const AXIS_DIRECTION = {
  E_pos: 'EAST', E_neg: 'WEST',
  N_pos: 'NORTH', N_neg: 'SOUTH',
  U_pos: 'UP', U_neg: 'DOWN',
};

/**
 * Compute delta vector between two points.
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @returns {{dE:number, dN:number, dU:number}}
 */
const _delta = (p1, p2) => ({
  dE: p2.E - p1.E,
  dN: p2.N - p1.N,
  dU: p2.U - p1.U,
});

/**
 * Return the single dominant direction of travel from p1 to p2.
 * Dominant = axis with largest absolute delta.
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @returns {string}
 */
export const dominantDirection = (p1, p2) => {
  const { dE, dN, dU } = _delta(p1, p2);
  const axes = [
    { key: 'E', val: dE },
    { key: 'N', val: dN },
    { key: 'U', val: dU },
  ];
  const dominant = axes.reduce((max, a) => Math.abs(a.val) > Math.abs(max.val) ? a : max, axes[0]);
  const sign = dominant.val >= 0 ? 'pos' : 'neg';
  return AXIS_DIRECTION[`${dominant.key}_${sign}`] ?? 'UNKNOWN';
};

/**
 * Return direction text for MESSAGE-SQUARE.
 * If two axes have similar magnitudes (within 20%), show both.
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @returns {string}  e.g. "NORTH" or "NORTH AND UP"
 */
export const directionText = (p1, p2) => {
  const { dE, dN, dU } = _delta(p1, p2);
  const axes = [
    { key: 'E', val: dE },
    { key: 'N', val: dN },
    { key: 'U', val: dU },
  ].sort((a, b) => Math.abs(b.val) - Math.abs(a.val));

  const primary = axes[0];
  const secondary = axes[1];

  const primaryName = AXIS_DIRECTION[`${primary.key}_${primary.val >= 0 ? 'pos' : 'neg'}`];

  // Show secondary if it's at least 30% of the primary magnitude
  if (Math.abs(primary.val) > 0 &&
    Math.abs(secondary.val) / Math.abs(primary.val) >= 0.30) {
    const secondaryName = AXIS_DIRECTION[`${secondary.key}_${secondary.val >= 0 ? 'pos' : 'neg'}`];
    return `${primaryName} AND ${secondaryName}`;
  }

  return primaryName ?? 'UNKNOWN';
};

/**
 * 3D Euclidean distance (component physical length).
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @returns {number}  mm
 */
export const componentLength = (p1, p2) => {
  const { dE, dN, dU } = _delta(p1, p2);
  return Math.sqrt(dE * dE + dN * dN + dU * dU);
};

/**
 * Detect if travel from p1 to p2 is "skew" — significant movement on 2+ axes.
 * Used to identify 90-degree elbows that are missing a CENTRE-POINT.
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @param {number} [threshold=6]  mm — minimum displacement to count as movement
 * @returns {boolean}
 */
export const isSkew = (p1, p2, threshold = 6) => {
  const { dE, dN, dU } = _delta(p1, p2);
  let axes = 0;
  if (Math.abs(dE) > threshold) axes++;
  if (Math.abs(dN) > threshold) axes++;
  if (Math.abs(dU) > threshold) axes++;
  return axes >= 2;
};

/**
 * Infer the corner (centre) point for a 90-degree elbow with skew travel.
 *
 * Vector-sense mode (preferred): when ep1AxisVec is supplied it carries the
 * normalised direction the pipe travels FROM EP1 toward the CP (from Phase-1
 * Len_Vec stamping, stored as row.__axisVec).  The dominant axis of that vector
 * is the axis EP1 travels on → the CP KEEPS EP1's value on that axis and TAKES
 * EP2's value on the perpendicular axis.
 *
 * Example (=67133182/8396):
 *   EP1 Len_Vec = 2[-1.000N+0.001Up]  → N-dominant → CP.E = EP1.E, CP.N = EP2.N
 *   Result: (EP1.E, EP2.N, avgU) = NE corner  ✓
 *
 * Fallback heuristic (no axisVec): primary axis is the one with largest |delta|
 * and gets the destination value — works for unequal deltas but is ambiguous
 * when |dE| ≈ |dN|.
 *
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @param {{dE:number,dN:number,dU:number}|null} [ep1AxisVec]  EP1 row __axisVec
 * @param {number} [threshold=6]  mm
 * @returns {{E:number,N:number,U:number}}  inferred corner point
 */
export const inferCorner = (p1, p2, ep1AxisVec = null, threshold = 6) => {
  // ── Vector-sense mode ──────────────────────────────────────────────────────
  // Rule: CP keeps EP1's value on every axis EXCEPT the dominant travel axis
  // (the axis EP1 travels along to reach CP), where it takes EP2's value.
  if (ep1AxisVec) {
    const absE = Math.abs(ep1AxisVec.dE ?? 0);
    const absN = Math.abs(ep1AxisVec.dN ?? 0);
    const absU = Math.abs(ep1AxisVec.dU ?? 0);
    const corner = { E: p1.E, N: p1.N, U: p1.U };
    if (absN >= absE && absN >= absU) {
      // N-dominant: pipe travels N/S from EP1 to CP → CP.N = EP2.N
      corner.N = p2.N;
    } else if (absE >= absN && absE >= absU) {
      // E-dominant: pipe travels E/W from EP1 to CP → CP.E = EP2.E
      corner.E = p2.E;
    } else {
      // U-dominant: pipe travels up/down from EP1 to CP → CP.U = EP2.U
      corner.U = p2.U;
    }
    return corner;
  }

  // ── Fallback: largest-delta heuristic ────────────────────────────────────
  const { dE, dN, dU } = _delta(p1, p2);
  const axes = [
    { key: 'E', abs: Math.abs(dE) },
    { key: 'N', abs: Math.abs(dN) },
    { key: 'U', abs: Math.abs(dU) },
  ].filter(a => a.abs > threshold)
    .sort((a, b) => b.abs - a.abs);

  // Corner takes the destination value for the primary (largest) axis,
  // and keeps the source value for the other axes.
  const corner = { E: p1.E, N: p1.N, U: p1.U };
  if (axes.length >= 1) {
    corner[axes[0].key] = p2[axes[0].key];
  }
  return corner;
};
