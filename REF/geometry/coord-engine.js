/**
 * coord-engine.js — Coordinate parsing, formatting, transformation
 * Pure functions — no side effects, no imports from app modules except logger.
 *
 * Exports:
 *   parseCoord(val)                 → number (0.0 on failure)
 *   parseBore(val)                  → number (0.0 on failure)
 *   fmtCoord(n, decimalPlaces)      → string  e.g. "96400.0"
 *   fmtValue(n, decimalPlaces)      → string  e.g. "9.53"
 *   distance3D(p1, p2)              → number  mm
 *   applyTransform(pt, transform)   → {E,N,U}
 *   coordKey(pt, tolerance)         → string  for Map keying
  EPSILON                         → number (1e-5)
  isZero(n)                       → boolean
  isEqual(a, b)                   → boolean
  isVecZero(v)                    → boolean
  isVecEqual(v1, v2)              → boolean
 */

import { warn } from '../logger.js';

const MOD = 'coord-engine';

export const EPSILON = 1e-5;

// ── ROBUST MATH ────────────────────────────────────────────────────────────

export const isZero = (n) => Math.abs(n) < EPSILON;
export const isEqual = (a, b) => Math.abs(a - b) < EPSILON;

export const isVecZero = (v) => !v || (isZero(v.E) && isZero(v.N) && isZero(v.U));
export const isVecEqual = (v1, v2) => {
  if (!v1 || !v2) return false;
  return isEqual(v1.E, v2.E) && isEqual(v1.N, v2.N) && isEqual(v1.U, v2.U);
};

// ── COORD PARSING ──────────────────────────────────────────────────────────

/**
 * Parse a coordinate value. Strips common suffixes. Returns 0.0 on failure.
 * Handles: "96400.000mm", "96400", "-2650.5", "1.2e+05"
 * @param {*} val
 * @returns {number}
 */
export const parseCoord = (val) => {
  if (val === null || val === undefined) return 0.0;
  if (typeof val === 'number') return isNaN(val) ? 0.0 : val;
  const s = String(val).trim().toLowerCase().replace(/mm$/,'').replace(/m$/,'').trim();
  if (s === '') return 0.0;
  const n = parseFloat(s);
  if (isNaN(n)) {
    warn(MOD, 'parseCoord', `Cannot parse coordinate: "${val}"`, { val });
    return 0.0;
  }
  return n;
};

/**
 * Parse a bore value. Strips mm/NB/DN/"/in suffixes.
 * @param {*} val
 * @returns {number}
 */
export const parseBore = (val) => {
  if (val === null || val === undefined) return 0.0;
  if (typeof val === 'number') return isNaN(val) ? 0.0 : val;
  const s = String(val).trim().toLowerCase()
    .replace(/\s*(mm|nb|dn|in|")$/,'').trim();
  if (s === '') return 0.0;
  const n = parseFloat(s);
  if (isNaN(n)) {
    warn(MOD, 'parseBore', `Cannot parse bore: "${val}"`, { val });
    return 0.0;
  }
  return n;
};

// ── FORMATTING ─────────────────────────────────────────────────────────────

/**
 * Format a coordinate number. Strips trailing zeros but keeps at least 1 decimal.
 * @param {number} n
 * @param {number} [dp=3]  decimal places
 * @returns {string}
 */
export const fmtCoord = (n, dp = 3) => {
  if (typeof n !== 'number' || isNaN(n)) return '0.0';
  const s = n.toFixed(dp);
  // Strip trailing zeros after decimal, keep at least one decimal digit
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
};

/**
 * Format a dimension value (wall, corrosion, etc.).
 * Same rules as fmtCoord but default 2 decimal places.
 * @param {number} n
 * @param {number} [dp=2]
 * @returns {string}
 */
export const fmtValue = (n, dp = 2) => fmtCoord(n, dp);

// ── COORDINATE TRANSFORM ───────────────────────────────────────────────────

/**
 * Apply translation + scale transform to a coordinate triplet.
 * @param {{E:number, N:number, U:number}} pt
 * @param {{dE:number, dN:number, dU:number, scaleE:number, scaleN:number, scaleU:number}} transform
 * @returns {{E:number, N:number, U:number}}
 */
export const applyTransform = (pt, transform) => {
  const t = transform ?? {};
  return {
    E: (pt.E + (t.dE ?? 0)) * (t.scaleE ?? 1),
    N: (pt.N + (t.dN ?? 0)) * (t.scaleN ?? 1),
    U: (pt.U + (t.dU ?? 0)) * (t.scaleU ?? 1),
  };
};

// ── GEOMETRY ───────────────────────────────────────────────────────────────

/**
 * 3D Euclidean distance between two points.
 * @param {{E:number,N:number,U:number}} p1
 * @param {{E:number,N:number,U:number}} p2
 * @returns {number}  mm
 */
export const distance3D = (p1, p2) => {
  const dE = p1.E - p2.E;
  const dN = p1.N - p2.N;
  const dU = p1.U - p2.U;
  return Math.sqrt(dE * dE + dN * dN + dU * dU);
};

/**
 * Generate a string key for a coordinate, snapped to tolerance grid.
 * Used to match endpoints across components in topology builder.
 * @param {{E:number,N:number,U:number}} pt
 * @param {number} [tolerance=0.5]   mm
 * @returns {string}  e.g. "96400|17989|101968"
 */
export const coordKey = (pt, tolerance = 0.5) => {
  const snap = (v) => Math.round(v / tolerance) * tolerance;
  return `${snap(pt.E)}|${snap(pt.N)}|${snap(pt.U)}`;
};

/**
 * Build a PCF coordinate token string: "E N U bore"
 * @param {{E:number,N:number,U:number}} pt
 * @param {number} bore
 * @param {number} [dp=3]
 * @param {number} [tokens=4]   3 = no bore, 4 = with bore
 * @returns {string}
 */
export const fmtPointToken = (pt, bore, dp = 3, tokens = 4) => {
  const e = fmtCoord(pt.E, dp);
  const n = fmtCoord(pt.N, dp);
  const u = fmtCoord(pt.U, dp);
  if (tokens === 3) return `${e} ${n} ${u}`;
  return `${e} ${n} ${u} ${fmtCoord(bore, dp)}`;
};
