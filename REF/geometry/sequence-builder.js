/**
 * sequence-builder.js — Nearest-neighbour re-sort
 * When CSV rows are out of order, sorts components by coordinate proximity.
 * Starts from the START-marked node; greedily picks the nearest unvisited component.
 *
 * Exports:
 *   nearestNeighbourSort(groups, startRefno, tolerance) → refno[]
 */

import { distance3D } from '../geometry/coord-engine.js';
import { info }       from '../logger.js';

const MOD = 'sequence-builder';

// ── VECTOR HELPERS ─────────────────────────────────────────────────────────

const sub = (a, b) => ({ E: a.E - b.E, N: a.N - b.N, U: a.U - b.U });
const mag = (v) => Math.sqrt(v.E*v.E + v.N*v.N + v.U*v.U);
const norm = (v) => {
  const m = mag(v);
  return m < 1e-9 ? {E:0,N:0,U:0} : { E: v.E/m, N: v.N/m, U: v.U/m };
};
const dot = (a, b) => a.E*b.E + a.N*b.N + a.U*b.U;

// ── TRAVERSAL HELPERS ──────────────────────────────────────────────────────

const _lastCoord = (group) => {
  const pts = group.pts ?? {};
  // Try to find the last defined point. For a component with 2 points, it's '2'.
  // We need at least one point.
  const ep = pts['2'] ?? pts['1'] ?? pts['0'] ?? null;
  return ep ? { E: ep.E, N: ep.N, U: ep.U } : null;
};

const _getExitVector = (group) => {
  const pts = group.pts ?? {};
  const pLast = pts['2'] ?? pts['1'] ?? null;
  // If we have '2', prev is '1'. If we have '1', prev is '0'.
  const pPrev = pts['2'] ? pts['1'] : (pts['1'] ? pts['0'] : null);

  if (pLast && pPrev) {
    return norm(sub(pLast, pPrev));
  }
  return null; // Cannot determine direction (single point)
};

const _firstCoord = (group) => {
  const pts = group.pts ?? {};
  const ep1 = pts['1'] ?? pts['0'] ?? null;
  return ep1 ? { E: ep1.E, N: ep1.N, U: ep1.U } : null;
};

/**
 * Nearest-neighbour greedy sort from startRefno.
 * Enhanced with Vector-Aware scoring to prefer aligned candidates across gaps.
 *
 * @param {Map<string, ComponentGroup>} groups
 * @param {string}  startRefno
 * @param {number}  [tolerance=10]   mm — max gap to consider connected
 * @returns {string[]}  ordered refno[]
 */
export const nearestNeighbourSort = (groups, startRefno, tolerance = 10) => {
  const active   = [...groups.entries()].filter(([, g]) => !g.skip);
  const ordered  = [];
  const visited  = new Set();

  let current = startRefno;

  while (ordered.length < active.length) {
    if (!current || visited.has(current)) {
      // Jump to nearest unvisited from current tail
      // TODO: This fallback jump is also greedy and dumb.
      // Ideally we should look for the closest start point to *any* visited end point?
      // For now, keep existing behavior: linear scan.
      const remaining = active.filter(([r]) => !visited.has(r));
      if (remaining.length === 0) break;
      current = remaining[0][0];
    }

    visited.add(current);
    ordered.push(current);

    const curGroup  = groups.get(current);
    const curCoord  = _lastCoord(curGroup);
    const exitDir   = _getExitVector(curGroup);

    if (!curCoord) {
      current = null;
      continue;
    }

    // Find best unvisited candidate
    let bestRefno = null;
    let bestScore = Infinity;
    let bestDist  = Infinity;

    // Search Radius: Don't look too far to avoid O(N^2) on huge datasets?
    // Actually N is usually small (<1000). Full scan is fine.

    for (const [refno, g] of active) {
      if (visited.has(refno)) continue;

      const fc = _firstCoord(g);
      if (!fc) continue;

      const d = distance3D(curCoord, fc);

      // SCORING LOGIC
      // Base score is distance.
      // If we have an exit direction, we apply a penalty multiplier to off-axis candidates.

      let score = d;

      if (d > tolerance && exitDir) {
        // We have a gap. Check alignment.
        // Gap Vector:
        const gapVec = sub(fc, curCoord);
        const gapDir = norm(gapVec);
        const alignment = dot(exitDir, gapDir); // 1.0 = aligned, 0 = 90deg, -1 = back

        // Penalty Factor:
        // If alignment > 0.9 (approx 25 deg), penalty is 1 (neutral).
        // Otherwise, penalty is high (e.g., 5x distance).
        // This makes a 200mm aligned gap cheaper than a 50mm side gap.

        const penalty = alignment > 0.9 ? 1.0 : 10.0;
        score = d * penalty;
      }

      // Check strictly against bestScore
      if (score < bestScore) {
        bestScore = score;
        bestDist  = d; // Keep track of actual distance for tolerance check
        bestRefno = refno;
      }
    }

    // Determine if we continue chain or break
    // Tolerance check applies to the *actual distance*, not the score.
    // However, if the best candidate is miles away, we probably shouldn't link it automatically
    // if we want to respect the tolerance strictly.
    // But the original code had `bestDist < tolerance * 100` (loose fallback).

    // We'll stick to the loose fallback to allow bridging gaps, but rely on the score to pick the *right* bridge.

    const MAX_JUMP = tolerance * 200; // e.g. 2000mm if tol=10

    if (bestRefno && bestDist < MAX_JUMP) {
        current = bestRefno;
    } else {
        current = null;
    }
  }

  info(MOD, 'nearestNeighbourSort', 'Sort complete', {
    sorted: ordered.length, total: active.length,
  });

  return ordered;
};
