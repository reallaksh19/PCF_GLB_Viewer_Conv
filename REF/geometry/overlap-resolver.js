/**
 * overlap-resolver.js — Detect and resolve PIPE components that engulf inner components.
 *
 * When a PIPE's EP1→EP2 span contains other component endpoints on the same axis
 * (same bore, within perpendicular tolerance), the PIPE is split into shorter sub-pipes
 * that fill only the gaps between the inner components.
 *
 * Also runs gasket absorption, continuity validation, and same-type overlap detection,
 * reporting all issues to the caller as anomaly entries.
 *
 * Exports:
 *   resolveOverlaps(groups, config)
 *     → { groups: Map<string,ComponentGroup>, anomalies: ValidationIssue[] }
 *
 * Prerequisites:
 *   - pts must already be built on all groups (call buildPts before this)
 *   - overlapResolution.enabled must be true in config (default: true)
 */

import { info, warn } from '../logger.js';
import { globalLogger } from '../utils/diagnostic-logger.js';
import { Common3DLogic } from './common-3d-logic.js';

const MOD = 'overlap-resolver';

// PCF types excluded from being used as inner split-point candidates:
// (Empty set now: we allow splitting pipes at SUPPORT and OLET to ensure continuity)
const EXCLUDED_SPLIT_TYPES = new Set([]);

const _getComponentName = (g) => g.rows?.[0]?.componentName ?? '';

// ── Geometry helpers ─────────────────────────────────────────────────────────

const _sub = (a, b) => ({ E: a.E - b.E, N: a.N - b.N, U: a.U - b.U });
const _dot = (a, b) => a.E * b.E + a.N * b.N + a.U * b.U;
const _len = (v) => Math.sqrt(_dot(v, v));

/**
 * Project point P onto the line defined by ep1→ep2.
 * @returns {{ t: number, perp: number, L: number }}
 *   t    = scalar distance along axis from ep1 (0 = ep1, L = ep2)
 *   perp = perpendicular distance from the axis
 *   L    = total length of ep1→ep2
 */
const _project = (P, ep1, ep2) => {
  const axis = _sub(ep2, ep1);
  const L = _len(axis);
  if (L < 1e-9) return { t: 0, perp: _len(_sub(P, ep1)), L: 0 };
  const unit = { E: axis.E / L, N: axis.N / L, U: axis.U / L };
  const pToEp1 = _sub(P, ep1);
  const t = _dot(pToEp1, unit);
  const proj = { E: unit.E * t, N: unit.N * t, U: unit.U * t };
  const perp = _len(_sub(pToEp1, proj));
  return { t, perp, L };
};

// ── Endpoint extraction ───────────────────────────────────────────────────────

/**
 * Get the endpoint points from a group used for pipe-splitting.
 * Standard components: pts['1'] and pts['2'].
 * SUPPORT/OLET: pts['0'] (Centre/Co-ords) to split the pipe at that location.
 */
const _getGroupEndpoints = (group) => {
  if (group.skip || EXCLUDED_SPLIT_TYPES.has(group.pcfType)) return [];
  const pts = group.pts;
  if (!pts) return [];
  const result = [];

  // Standard endpoints
  if (pts['1']) result.push({ pt: pts['1'], ptNum: '1' });
  if (pts['2']) result.push({ pt: pts['2'], ptNum: '2' });

  // Single-point components that split the pipe (SUPPORT, OLET)
  // Only include Point 0 if type is SUPPORT or OLET
  if ((group.pcfType === 'SUPPORT' || group.pcfType === 'OLET') && pts['0']) {
    result.push({ pt: pts['0'], ptNum: '0' });
  }

  return result;
};

// ── Per-component span collection ─────────────────────────────────────────────

/**
 * For each inner group that lies on the pipe axis, compute its entryT (smallest
 * projected t) and exitT (largest projected t) from its valid endpoints.
 *
 * Returns ONE span object per component, sorted by entryT ascending.
 * This prevents spurious sub-pipes being created across a component's own body
 * (e.g. a 146mm FLAN body between its own EP1 and EP2 would previously be
 * mistaken for a 146mm pipe gap).
 *
 * @param {Map}      groups        - all component groups
 * @param {string}   pipeRefno     - refno of the PIPE being split (excluded)
 * @param {string}   pipeName      - componentName of PIPE (for strict matching)
 * @param {{E,N,U}}  ep1           - PIPE EP1
 * @param {{E,N,U}}  ep2           - PIPE EP2 (real or inferred)
 * @param {number}   pipeBore      - PIPE bore (mm)
 * @param {number}   tol           - continuity tolerance (mm)
 * @param {number}   boreTol       - bore mismatch tolerance (mm)
 * @param {boolean}  relaxedUpper  - true when ep2 was inferred (allow t ≈ L)
 * @param {object}   resolveConfig - minComponentNameLength config
 * @returns {{ refno:string, entryT:number, exitT:number,
 *             entryCoord:{E,N,U}, exitCoord:{E,N,U} }[]}
 */
const _innerComponentSpans = (groups, pipeRefno, pipeName, ep1, ep2, pipeBore, tol, boreTol, relaxedUpper, resolveConfig) => {
  const spans = [];

  for (const [, g] of groups) {
    if (g.refno === pipeRefno || g.skip) continue;
    if (EXCLUDED_SPLIT_TYPES.has(g.pcfType)) continue;

    // Component Name Strict Match (Enhanced)
    const innerName = _getComponentName(g);
    const minNameLen = resolveConfig?.minComponentNameLength ?? 3;
    const isNameValid = (n) => n && n.trim().length >= minNameLen && !['NULL', 'UNSET'].includes(n.toUpperCase());

    // Only strictly enforce mismatch if PIPE name is significant
    // User Request: If Pipe Name is Invalid/Unset, SKIP SPLIT.
    if (!isNameValid(pipeName)) continue;

    // Pipe Name is Valid. Check for Mismatch.
    if (pipeName !== innerName) {
      if (pipeRefno.includes('1664')) {
        console.log(`[DEBUG 1664 _inner] Checking ${g.refno}: PipeName='${pipeName}' InnerName='${innerName}' Valid=${isNameValid(pipeName)} Match=${pipeName === innerName} -> ${pipeName !== innerName ? 'SKIP' : 'PROCESS'}`);
      }
      continue;
    }

    const validTs = [];

    for (const { pt } of _getGroupEndpoints(g)) {
      // Bore check: must be on the same pipe run.
      if (Math.abs((pt.bore ?? 0) - pipeBore) > boreTol) continue;

      const { t, perp, L } = _project(pt, ep1, ep2);

      // Must be strictly after ep1
      if (t <= tol) continue;
      // Normal pipe: must be strictly before ep2.
      // Inferred ep2: allow endpoints up to and including the farthest inner point.
      if (!relaxedUpper && t >= L - tol) continue;
      if (relaxedUpper && t > L + tol) continue;
      // Must be on-axis
      if (perp > tol) continue;

      validTs.push({ t, coord: { E: pt.E, N: pt.N, U: pt.U } });
    }

    if (validTs.length === 0) continue;

    validTs.sort((a, b) => a.t - b.t);

    spans.push({
      refno: g.refno,
      entryT: validTs[0].t,
      exitT: validTs[validTs.length - 1].t,
      entryCoord: validTs[0].coord,
      exitCoord: validTs[validTs.length - 1].coord,
    });
  }

  spans.sort((a, b) => a.entryT - b.entryT);
  return spans;
};

// ── Coord-key helper (shared with topology-builder) ───────────────────────────

/**
 * Snap a coordinate to the nearest multiple of tol and return a string key.
 * Same formula used in topology-builder.js.
 */
const _coordKey = (pt, tol) => {
  const snap = (v) => Math.round(v / tol) * tol;
  return `${snap(pt.E)}|${snap(pt.N)}|${snap(pt.U)}`;
};

// ── Path-chain tracer (for 3D-routed BRANs) ───────────────────────────────────

/**
 * Trace the connected chain of components starting from a seed coordinate.
 *
 * Used when straight-axis projection fails to find any inner components
 * (e.g. BRAN/1662 whose EP1→EP2 is a ~35,939mm diagonal but the actual
 * route zig-zags through multiple 90° ELBOs). In this case every ELBO
 * is 440mm+ off the diagonal — far beyond the 0.5mm tolerance — so the
 * span-walk finds nothing. Path tracing follows endpoint adjacency instead.
 *
 * Algorithm:
 *  1. Build a coordKey index mapping snapped coordinates to component entries.
 *  2. From seedCoord, find the first unvisited component whose PT1 or PT2
 *     matches the current position (within tol, same bore).
 *  3. Record { group, entryCoord, exitCoord } and advance to exitCoord.
 *  4. Repeat up to 1000 steps (safety cap) or until no neighbour is found.
 *
 * SUPPORT and OLET are excluded (EXCLUDED_SPLIT_TYPES).
 *
 * @param {Map}      groups      - all component groups (original, pre-split)
 * @param {string}   pipeRefno   - refno of the BRAN being resolved (excluded)
 * @param {string}   pipeName    - componentName of BRAN (for strict matching)
 * @param {{E,N,U}}  seedCoord   - starting coordinate (BRAN EP1)
 * @param {number}   pipeBore    - BRAN bore for bore-match filtering
 * @param {number}   tol         - continuity tolerance (mm)
 * @param {number}   boreTol     - bore mismatch tolerance (mm)
 * @param {object}   resolveConfig - minComponentNameLength config
 * @returns {{ group:object, entryCoord:{E,N,U}, exitCoord:{E,N,U} }[]}
 */
const _tracePathChain = (groups, pipeRefno, pipeName, seedCoord, pipeBore, tol, boreTol, resolveConfig) => {
  const chain = [];
  const visited = new Set();
  let current = seedCoord;

  // Build coordKey → [{ group, ptNum, coord }] index
  const coordIndex = new Map();
  for (const [, g] of groups) {
    if (g.refno === pipeRefno || g.skip) continue;
    if (EXCLUDED_SPLIT_TYPES.has(g.pcfType)) continue;

    // Name Check (Enhanced)
    const innerName = _getComponentName(g);
    const minNameLen = resolveConfig?.minComponentNameLength ?? 3;
    const isNameValid = (n) => n && n.trim().length >= minNameLen && !['NULL', 'UNSET'].includes(n.toUpperCase());

    // Only strictly enforce mismatch if PIPE name is significant
    // User Request: If Pipe Name is Invalid/Unset, SKIP SPLIT.
    if (!isNameValid(pipeName)) continue;

    // Pipe Name is Valid. Check for Mismatch (ignoring innerName validity).
    if (pipeName !== innerName) {
      if (pipeRefno.includes('1664')) {
        console.log(`[DEBUG 1664 _trace] Checking ${g.refno}: PipeName='${pipeName}' InnerName='${innerName}' Valid=${isNameValid(pipeName)} Match=${pipeName === innerName} -> ${pipeName !== innerName ? 'SKIP' : 'PROCESS'}`);
      }
      continue;
    }
    const b1 = g.pts?.['1']?.bore ?? 0;
    const b2 = g.pts?.['2']?.bore ?? 0;
    if (Math.abs(b1 - pipeBore) > boreTol && Math.abs(b2 - pipeBore) > boreTol) continue;

    for (const ptNum of ['1', '2']) {
      const pt = g.pts?.[ptNum];
      if (!pt) continue;
      if (Math.abs((pt.bore ?? 0) - pipeBore) > boreTol) continue;
      const key = _coordKey(pt, tol);
      if (!coordIndex.has(key)) coordIndex.set(key, []);
      coordIndex.get(key).push({ group: g, ptNum, coord: { E: pt.E, N: pt.N, U: pt.U } });
    }
  }

  for (let step = 0; step < 1000; step++) {
    const key = _coordKey(current, tol);
    const candidates = coordIndex.get(key) ?? [];

    // Find the first unvisited component whose matched endpoint is at 'current'
    const match = candidates.find(c => !visited.has(c.group.refno));
    if (!match) break;

    visited.add(match.group.refno);
    const g = match.group;

    const entryPtNum = match.ptNum;
    const exitPtNum = entryPtNum === '1' ? '2' : '1';
    const entryCoord = match.coord;
    const exitPt = g.pts?.[exitPtNum];
    if (!exitPt) break;                       // single-endpoint component — stop

    const exitCoord = { E: exitPt.E, N: exitPt.N, U: exitPt.U };
    chain.push({ group: g, entryCoord, exitCoord });
    current = exitCoord;
  }

  return chain;
};

// ── Dominant-axis scanner (for diagonal BRANs with straight inner sections) ───

/**
 * Fallback for pipes whose EP1→EP2 is a 3D diagonal but all inner components
 * move along only ONE axis (e.g. BRAN/1151: EP is diagonal E+U, but all inner
 * FLANs/VALVs/ELBOs stay at E=96400 and only vary in U).
 *
 * Algorithm:
 *  1. Find all non-skip, non-SUPPORT, non-OLET endpoints with matching bore
 *     that share 2 of 3 axes with EP1 (within tol).
 *  2. Confirm all candidates vary along the same single axis.
 *  3. Build one span per component (min/max t on that axis), sorted ascending.
 *
 * Returns { spans, axis, L } or null if no unambiguous dominant axis found.
 *
 * @param {Map}      groups     - all component groups
 * @param {string}   pipeRefno  - refno of the BRAN being resolved (excluded)
 * @param {string}   pipeName   - componentName of BRAN (for strict matching)
 * @param {{E,N,U}}  ep1        - BRAN EP1
 * @param {{E,N,U}}  ep2        - BRAN EP2 (real or null if inferred)
 * @param {number}   pipeBore   - BRAN bore
 * @param {number}   tol        - continuity tolerance (mm)
 * @param {number}   boreTol    - bore tolerance (mm)
 * @param {boolean}  inferredEp2 - true if ep2 was inferred (skip trailing)
 * @param {object}   resolveConfig - minComponentNameLength config
 * @returns {{ spans, axis:string, L:number|null } | null}
 */
const _dominantAxisScan = (groups, pipeRefno, pipeName, ep1, ep2, pipeBore, tol, boreTol, inferredEp2, resolveConfig) => {
  const candidates = [];   // { group, t, coord, axisKey }

  for (const [, g] of groups) {
    if (g.refno === pipeRefno || g.skip) continue;
    if (EXCLUDED_SPLIT_TYPES.has(g.pcfType)) continue;

    // Name Check
    // Component Name Strict Match (Enhanced)
    const innerName = _getComponentName(g);
    const minNameLen = resolveConfig?.minComponentNameLength ?? 3;
    const isNameValid = (n) => n && n.trim().length >= minNameLen && !['NULL', 'UNSET'].includes(n.toUpperCase());

    // Only strictly enforce mismatch if PIPE name is significant
    // User Request: If Pipe Name is Invalid/Unset, SKIP SPLIT.
    if (!isNameValid(pipeName)) continue;

    // Pipe Name is Valid. Check for Mismatch (ignoring innerName validity).
    if (pipeName !== innerName) {
      if (pipeRefno.includes('1664')) {
        console.log(`[DEBUG 1664 _dominant] Checking ${g.refno}: PipeName='${pipeName}' InnerName='${innerName}' Valid=${isNameValid(pipeName)} Match=${pipeName === innerName} -> ${pipeName !== innerName ? 'SKIP' : 'PROCESS'}`);
      }
      continue;
    }

    for (const { pt } of _getGroupEndpoints(g)) {
      if (Math.abs((pt.bore ?? 0) - pipeBore) > boreTol) continue;

      const matchE = Math.abs(pt.E - ep1.E) <= tol;
      const matchN = Math.abs(pt.N - ep1.N) <= tol;
      const matchU = Math.abs(pt.U - ep1.U) <= tol;
      const matchCount = (matchE ? 1 : 0) + (matchN ? 1 : 0) + (matchU ? 1 : 0);

      // Need exactly 2 matching axes — the remaining axis is the split direction
      if (matchCount !== 2) continue;

      const axisKey = !matchE ? 'E' : !matchN ? 'N' : 'U';
      const t = pt[axisKey] - ep1[axisKey];   // signed distance along split axis

      candidates.push({ group: g, t, coord: { E: pt.E, N: pt.N, U: pt.U }, axisKey });
    }
  }

  if (candidates.length === 0) return null;

  // All candidates must agree on the same split axis
  const axes = new Set(candidates.map(c => c.axisKey));
  if (axes.size > 1) return null;   // mixed axes — ambiguous

  const axis = [...axes][0];

  // Determine split direction from EP2 (if available and not inferred)
  const direction = (ep2 && !inferredEp2) ? Math.sign(ep2[axis] - ep1[axis]) : 1;
  if (direction === 0) return null;   // EP2 same as EP1 on split axis — degenerate

  // Keep only candidates in the correct direction and beyond tol
  const valid = candidates.filter(c => (c.t * direction) > tol);
  if (valid.length === 0) return null;

  // Build one span per component: min/max |t|
  const spanMap = new Map();
  for (const c of valid) {
    const absT = c.t * direction;   // always positive after filter
    if (!spanMap.has(c.group.refno)) {
      spanMap.set(c.group.refno, {
        group: c.group,
        minT: absT, maxT: absT,
        minCoord: c.coord, maxCoord: c.coord,
      });
    } else {
      const s = spanMap.get(c.group.refno);
      if (absT < s.minT) { s.minT = absT; s.minCoord = c.coord; }
      if (absT > s.maxT) { s.maxT = absT; s.maxCoord = c.coord; }
    }
  }

  const spans = [...spanMap.values()].map(s => ({
    refno: s.group.refno,
    entryT: s.minT,
    exitT: s.maxT,
    entryCoord: s.minCoord,
    exitCoord: s.maxCoord,
  }));
  spans.sort((a, b) => a.entryT - b.entryT);

  // L on the split axis (distance from EP1 to EP2 along that axis)
  const L = (ep2 && !inferredEp2) ? Math.abs(ep2[axis] - ep1[axis]) : null;

  return { spans, axis, L };
};

// ── Sub-pipe construction ─────────────────────────────────────────────────────

/**
 * Create a synthetic sub-pipe ComponentGroup.
 * Inherits all design values from the original PIPE's pts['1'].
 */
const _makeSynthPipe = (original, ep1Coord, ep2Coord, index) => {
  const designFrom = original.pts['1'] ?? {};
  const len = _len(_sub(ep2Coord, ep1Coord));
  return {
    refno: `${original.refno}_sp${index}`,
    csvType: original.csvType,
    pcfType: 'PIPE',
    skip: false,
    firstRowIndex: original.firstRowIndex,
    rows: [],   // synthetic — no raw CSV rows
    lenCalc: len, // Store calculated length for UI
    pts: {
      '1': { ...designFrom, E: ep1Coord.E, N: ep1Coord.N, U: ep1Coord.U },
      '2': { ...designFrom, E: ep2Coord.E, N: ep2Coord.N, U: ep2Coord.U },
    },
  };
};

// ── Gasket absorption ─────────────────────────────────────────────────────────

/**
 * Absorb GASK gaps into adjacent non-PIPE components (typically FLANs).
 *
 * When a GASK sits between two FLANs, its 3mm thickness creates a topology gap.
 * This function finds the non-PIPE component whose endpoint touches GASK EP1
 * and extends that endpoint to GASK EP2, bridging the gap.
 *
 * Rules:
 *  - Only processes GASK groups (csvType='GASK', skip=true)
 *  - Never modifies PIPE coordinates (would corrupt the splitting pass)
 *  - Gasket length sanity check: 0.1mm – 20mm
 *  - One component extended per gasket (breaks after first match)
 */
const _absorbGaskets = (groups, tol) => {
  for (const [, gask] of groups) {
    if (!gask.skip) continue;
    if ((gask.csvType ?? '').toUpperCase() !== 'GASK') continue;
    const gp1 = gask.pts?.['1'];
    const gp2 = gask.pts?.['2'];
    if (!gp1 || !gp2) continue;

    const gaskLen = _len(_sub(gp2, gp1));
    if (gaskLen < 0.1 || gaskLen > 20) continue;

    for (const [, g] of groups) {
      if (g.skip || !g.pts) continue;
      if (g.pcfType === 'PIPE') continue;  // never modify PIPE coordinates
      const ep1 = g.pts['1'];
      const ep2 = g.pts['2'];

      // EP2 of this component touches GASK EP1 → extend EP2 to GASK EP2
      if (ep2 && _len(_sub(ep2, gp1)) < tol) {
        info(MOD, '_absorbGaskets',
          `Extending ${g.refno} EP2 by ${gaskLen.toFixed(1)}mm (absorbing GASK ${gask.refno})`);
        g.pts['2'] = { ...ep2, E: gp2.E, N: gp2.N, U: gp2.U };
        break;
      }

      // EP1 of this component touches GASK EP1 → extend EP1 to GASK EP2
      if (ep1 && _len(_sub(ep1, gp1)) < tol) {
        info(MOD, '_absorbGaskets',
          `Extending ${g.refno} EP1 by ${gaskLen.toFixed(1)}mm (absorbing GASK ${gask.refno})`);
        g.pts['1'] = { ...ep1, E: gp2.E, N: gp2.N, U: gp2.U };
        break;
      }
    }
  }
  return groups;
};

// ── Same-type overlap detection ───────────────────────────────────────────────

/**
 * Detect same-type overlaps after splitting.
 * Two components of the same PCF type overlap if one's span contains the other's endpoint.
 * Returns ERROR-level anomaly entries.
 */
const _detectSameTypeOverlaps = (groups, tol, boreTol, commonLogic) => {
  const anomalies = [];
  // Filter out skipped items and synthetic sequencer gaps
  const groupList = [...groups.values()].filter(g => !g.skip && g.pts && (!g.refno || !g.refno.startsWith('_gap_')));

  for (let i = 0; i < groupList.length; i++) {
    const A = groupList[i];
    const aEp1 = A.pts['1'];
    const aEp2 = A.pts['2'];
    if (!aEp1 || !aEp2) continue;

    for (let j = i + 1; j < groupList.length; j++) {
      const B = groupList[j];
      if (A.pcfType !== B.pcfType) continue;

      // Check alignment of B's endpoints against A's axis
      const bEps = _getGroupEndpoints(B);
      if (bEps.length < 2) continue; // Need at least 2 points to define a span for overlap check

      // Assume linear components (PIPE, TEE run) have P1 and P2
      // Check if B's axis is collinear with A
      const p1 = B.pts?.['1'];
      const p2 = B.pts?.['2'];
      if (!p1 || !p2) continue;

      if (Math.abs((p1.bore ?? 0) - (aEp1.bore ?? 0)) > boreTol) continue;

      const proj1 = _project(p1, aEp1, aEp2);
      const proj2 = _project(p2, aEp1, aEp2);

      // Must be collinear (perp < tol)
      if (proj1.perp > tol || proj2.perp > tol) continue;

      // Interval Intersection
      // A is [0, L]
      // B is [min(t1, t2), max(t1, t2)]
      const bStart = Math.min(proj1.t, proj2.t);
      const bEnd = Math.max(proj1.t, proj2.t);
      const L = proj1.L; // Length of A

      const overlapStart = Math.max(0, bStart);
      const overlapEnd = Math.min(L, bEnd);
      const overlapLen = overlapEnd - overlapStart;

      // Overlap must be significant (> tol)
      if (overlapLen > tol) {
        const id = `OVERLAP:${A.refno}:${B.refno}`;
        const maxOverlap = commonLogic?.maxOverlap ?? 1000;
        const isExcessive = overlapLen > maxOverlap;

        if (!anomalies.find(x => x.id === id)) {
          const nameA = A.raw?.componentName ?? '';
          const nameB = B.raw?.componentName ?? '';
          const namesMatch = nameA && nameB && nameA === nameB;

          // Downgrade severity if metadata confirms same pipeline identity
          const severity = namesMatch ? 'INFO' : (isExcessive ? 'ERROR' : 'WARNING');

          anomalies.push({
            severity,
            id,
            message: `Same-type overlap: ${A.pcfType} ${A.refno} overlaps ${B.refno}`,
            detail: `${namesMatch ? '[Self-Overlap] ' : ''}${isExcessive ? `[EXCESSIVE > ${maxOverlap}mm] ` : ''}Overlap Length=${overlapLen.toFixed(1)}mm. Review source CSV.`,
            rowIndex: A.firstRowIndex,
          });
          warn(MOD, '_detectSameTypeOverlaps',
            `Same-type overlap: ${A.pcfType} ${A.refno} ↔ ${B.refno}`,
            { overlapLen: overlapLen.toFixed(1), severity });
        }
      }
    }
  }

  return anomalies;
};

// ── Post-resolution continuity validation ─────────────────────────────────────

/**
 * Flag components that are completely disconnected after resolution.
 *
 * Uses the same coordKey snapping as topology-builder.js (Math.round(v/tol)*tol).
 * A component is flagged only when BOTH its EP1 and EP2 are isolated —
 * meaning no other component's endpoint lands within tol of either.
 *
 * A single isolated endpoint (degree-1 node) is normal at chain starts/ends — not flagged.
 * SUPPORT is excluded (single-point type by design).
 *
 * Returns WARNING-level anomaly entries for validationReport.anomaly[].
 */
const _validateContinuity = (groups, tol) => {
  const anomalies = [];
  const index = new Map();
  const snap = (v) => Math.round(v / tol) * tol;

  // Collect ALL endpoints (for nearest-neighbour search)
  const allEndpoints = [];  // { refno, ptKey, coord: {E,N,U} }

  for (const [, g] of groups) {
    if (g.skip || !g.pts) continue;
    for (const ptKey of ['1', '2']) {
      const pt = g.pts[ptKey];
      if (!pt) continue;
      const key = `${snap(pt.E)}|${snap(pt.N)}|${snap(pt.U)}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(g.refno);
      allEndpoints.push({ refno: g.refno, ptKey, coord: { E: pt.E, N: pt.N, U: pt.U } });
    }
  }

  // Count how many endpoints of each component are isolated (no shared neighbour)
  const isolatedCount = new Map();
  for (const [, refnos] of index) {
    if (refnos.length === 1) {
      isolatedCount.set(refnos[0], (isolatedCount.get(refnos[0]) ?? 0) + 1);
    }
  }

  /** Find nearest endpoint from a different component */
  const findNearest = (coord, ownRefno) => {
    let bestDist = Infinity;
    let bestRefno = '?';
    for (const ep of allEndpoints) {
      if (ep.refno === ownRefno) continue;
      const d = _len(_sub(ep.coord, coord));
      if (d < bestDist) {
        bestDist = d;
        bestRefno = ep.refno;
      }
    }
    return { dist: bestDist, refno: bestRefno };
  };

  // Only flag when BOTH endpoints are isolated (completely disconnected)
  for (const [refno, count] of isolatedCount) {
    const g = groups.get(refno);
    if (!g || g.pcfType === 'SUPPORT') continue;
    if (count >= 2) {
      const ep1 = g.pts?.['1'];
      const ep2 = g.pts?.['2'];

      // Find nearest neighbour for each endpoint
      const near1 = ep1 ? findNearest(ep1, refno) : { dist: Infinity, refno: '?' };
      const near2 = ep2 ? findNearest(ep2, refno) : { dist: Infinity, refno: '?' };
      const closerEP = near1.dist <= near2.dist ? 'EP1' : 'EP2';
      const nearDist = Math.min(near1.dist, near2.dist);
      const nearRef = near1.dist <= near2.dist ? near1.refno : near2.refno;

      // Actionable advice based on gap size
      let advice;
      if (nearDist < 5) {
        advice = `Very close (${nearDist.toFixed(1)}mm) — continuityTolerance (${tol}mm) may be too tight.`;
      } else if (nearDist < 100) {
        advice = `Small gap (${nearDist.toFixed(1)}mm) — likely a skipped gasket/pcom. May need tolerance increase or gap-fill.`;
      } else if (nearDist < 1000) {
        advice = `Medium gap (${nearDist.toFixed(0)}mm) — needs a bridging PIPE segment.`;
      } else {
        advice = `Large gap (${nearDist.toFixed(0)}mm) — may be a branch transition or CSV data issue.`;
      }

      anomalies.push({
        severity: 'WARNING',
        id: `CONTINUITY:${refno}`,
        message: `Continuity gap: ${g.pcfType} ${refno} has no connected neighbours`,
        detail: `EP1=(${ep1?.E},${ep1?.N},${ep1?.U}) EP2=(${ep2?.E},${ep2?.N},${ep2?.U}). ` +
          `Nearest: ${closerEP} → ${nearRef} at ${nearDist.toFixed(1)}mm. ${advice}`,
        rowIndex: g.firstRowIndex,
      });
      warn(MOD, '_validateContinuity',
        `CONTINUITY WARNING: ${g.pcfType} ${refno} disconnected — nearest=${nearRef} at ${nearDist.toFixed(1)}mm`, { tol });
    } else if (count === 1) {
      // Single endpoint isolated — partially connected
      const ep1 = g.pts?.['1'];
      const ep2 = g.pts?.['2'];
      // Find which endpoint is isolated
      const ep1Key = ep1 ? `${snap(ep1.E)}|${snap(ep1.N)}|${snap(ep1.U)}` : null;
      const ep1Iso = ep1Key ? (index.get(ep1Key) ?? []).length === 1 : false;
      const isoEP = ep1Iso ? 'EP1' : 'EP2';
      const isoPt = ep1Iso ? ep1 : ep2;

      if (isoPt) {
        const near = findNearest(isoPt, refno);
        anomalies.push({
          severity: 'INFO',
          id: `CONTINUITY-PARTIAL:${refno}`,
          message: `Partial gap: ${g.pcfType} ${refno} ${isoEP} has no connected neighbour`,
          detail: `${isoEP}=(${isoPt.E},${isoPt.N},${isoPt.U}). ` +
            `Nearest: ${near.refno} at ${near.dist.toFixed(1)}mm.`,
          rowIndex: g.firstRowIndex,
        });
        info(MOD, '_validateContinuity',
          `CONTINUITY INFO: ${g.pcfType} ${refno} ${isoEP} isolated — nearest=${near.refno} at ${near.dist.toFixed(1)}mm`);
      }
    }
  }

  return anomalies;
};

// ── Sequence-based gap fill ───────────────────────────────────────────────────

const _normalize = (v) => {
  const L = _len(v);
  return L < 1e-9 ? { E: 0, N: 0, U: 0 } : { E: v.E / L, N: v.N / L, U: v.U / L };
};

const _getExpectedDirection = (g, coord, isExit) => {
  if (!g.pts) return null;

  // Identify which point matches 'coord'
  let ptKey = null;
  const tol = 0.1;
  for (const k of ['1', '2', '3', '0']) {
    const p = g.pts[k];
    if (p && _len(_sub(p, coord)) < tol) {
      ptKey = k;
      break;
    }
  }
  if (!ptKey) return null;

  const p0 = g.pts['0'];
  const p1 = g.pts['1'];
  const p2 = g.pts['2'];

  let center = null;

  // Components with a defined center (P0)
  if (['ELBO', 'BEND', 'TEE', 'OLET', 'CROSS'].includes(g.pcfType) && p0) {
    center = p0;
  } else {
    // Linear components: Center is the 'other' endpoint
    if (ptKey === '1') center = p2;
    else if (ptKey === '2') center = p1;
  }

  if (!center) return null;

  const vec = isExit ? _sub(coord, center) : _sub(center, coord);
  return _normalize(vec);
};

const _extractPipelineRef = (refno) => {
  if (!refno) return '';
  const clean = refno.startsWith('=') ? refno.slice(1) : refno;
  const slash = clean.indexOf('/');
  return slash > 0 ? clean.slice(0, slash) : clean;
};

/**
 * Walk non-skip components in CSV sequence order and synthesise PIPE segments
 * wherever consecutive component endpoints have a gap > minPipeLength.
 *
 * How it works:
 *  1. Collect all non-skip, non-standalone components.
 *  2. Sort by firstRowIndex.
 *  3. Walk pairs (A, B).
 *  4. If gap detected, verify collinearity with A's exit or B's entry vector.
 *  5. Create synthetic PIPE if valid.
 *
 * @param {Map}    groups       - post-overlap-resolution groups
 * @param {number} tol          - continuity tolerance (mm)
 * @param {number} minPipeLen   - minimum gap to generate a PIPE
 * @param {number} boreTol      - bore mismatch tolerance (mm)
 * @param {object} commonLogic  - common 3D logic config
 * @param {boolean} ignoreSupports - if true, exclude Support/Anci from being targets
 * @returns {number} count of gaps filled
 */
const _fillSequenceGaps = (groups, tol, minPipeLen, boreTol, commonLogic, ignoreSupports) => {
  // ── Pre-pass: suppress oversized PIPE components ──────────────────────────
  {
    const preIdx = new Map();
    for (const [, g] of groups) {
      // Only verify real components, completely ignore synthetic sequencer gaps
      if (g.refno && g.refno.startsWith('_gap_')) continue;

      if (g.skip || g.pcfType === 'PIPE' || g.pcfType === 'SUPPORT') continue;
      for (const ptKey of ['1', '2', '0', '3']) {
        const pt = g.pts?.[ptKey];
        if (!pt) continue;
        const key = _coordKey(pt, tol);
        if (!preIdx.has(key)) preIdx.set(key, []);
        preIdx.get(key).push(g.refno);
      }
    }

    for (const [refno, g] of groups) {
      if (g.skip || g.pcfType !== 'PIPE') continue;
      const p1 = g.pts?.['1'];
      const p2 = g.pts?.['2'];
      if (!p1 || !p2) continue;
      const pipeLen = _len(_sub(p2, p1));
      if (pipeLen < 5000) continue;
      const k1 = _coordKey(p1, tol);
      const k2 = _coordKey(p2, tol);
      const n1 = (preIdx.get(k1) ?? []).length > 0;
      const n2 = (preIdx.get(k2) ?? []).length > 0;
      if (n1 && n2) {
        g.skip = true;
        info(MOD, '_fillSequenceGaps',
          `Suppressed oversized PIPE ${refno} (${pipeLen.toFixed(0)}mm) — both endpoints touch fittings`);
      }
    }
  }

  // ── Collect components ─────────────────────────────────────────────────────
  const fittings = [];
  const allComponents = [];
  for (const [, g] of groups) {
    if (g.skip) continue;
    if (!g.pts?.['1'] && !g.pts?.['2'] && !g.pts?.['0']) continue;
    allComponents.push(g);

    // In Pass 2 (ignoreSupports=true), exclude structural SUPPORTs from gap-fill candidates.
    // ANCI (anchor) is a piping fitting — always keep it in the fittings list.
    if (ignoreSupports && g.pcfType === 'SUPPORT') continue;

    if (g.pcfType !== 'PIPE') {
      fittings.push(g);
    }
  }

  fittings.sort((a, b) => a.firstRowIndex - b.firstRowIndex);
  if (fittings.length < 2) return 0;

  // ── Build coordKey index ──────────────────────────────────────────────────
  const coordIdx = new Map();
  for (const g of allComponents) {
    for (const ptKey of ['1', '2', '0', '3']) {
      const pt = g.pts?.[ptKey];
      if (!pt) continue;
      const key = _coordKey(pt, tol);
      if (!coordIdx.has(key)) coordIdx.set(key, []);
      coordIdx.get(key).push(g.refno);
    }
  }

  const hasNeighbour = (pt, ownRefno) => {
    const key = _coordKey(pt, tol);
    const refs = coordIdx.get(key) ?? [];
    return refs.some(r => r !== ownRefno);
  };

  const getExit = (g) => {
    if (g.pcfType === 'SUPPORT' || g.pcfType === 'ANCI') return g.pts?.['0'] ?? null;
    if (g.pcfType === 'OLET') return g.pts?.['0'] ?? g.pts?.['3'] ?? null;
    return g.pts?.['2'] ?? null;
  };

  const getEntry = (g) => {
    if (g.pcfType === 'SUPPORT' || g.pcfType === 'ANCI') return g.pts?.['0'] ?? null;
    if (g.pcfType === 'OLET') return g.pts?.['0'] ?? g.pts?.['1'] ?? null;
    return g.pts?.['1'] ?? null;
  };

  // ── Walk consecutive FITTING pairs and fill gaps ──────────────────────────
  let filled = 0;
  const newPipes = [];
  let prevGapVec = null;
  let prevTarget = null;

  for (let i = 0; i < fittings.length - 1; i++) {
    const A = fittings[i];
    const B = fittings[i + 1];

    // ── Targeted debug for 1534 → 2737 ──────────────────────────────────────
    const isDebugPair = (A.refno?.includes('1534') && B.refno?.includes('2737')) ||
      (A.refno?.includes('2737') && B.refno?.includes('1534'));
    if (isDebugPair) {
      console.log(`[GapFill DEBUG] Pair A=${A.refno}(${A.pcfType}) → B=${B.refno}(${B.pcfType})`);
      console.log(`  aExit=`, getExit(A), `  bEntry=`, getEntry(B));
    }
    // Rule 6: Skip small bore (< 50mm)
    // EXEMPT anchor types: ANCI, SUPPORT, OLET have no meaningful bore in CSV (stored as 0).
    // For these, fall back to the partner's bore for the check.
    const BORELESS_TYPES = new Set(['ANCI', 'SUPPORT', 'OLET']);
    const boreA = getExit(A)?.bore ?? 0;
    const rawBoreB = getEntry(B)?.bore ?? 0;
    const boreB = (rawBoreB === 0 && BORELESS_TYPES.has(B.pcfType)) ? boreA : rawBoreB;
    const rulesEnabled = commonLogic?.enabled !== false;

    if (rulesEnabled) {
      // Only apply minBore when NEITHER side is a boreless anchor type
      const skipBoreCheck = BORELESS_TYPES.has(A.pcfType) || BORELESS_TYPES.has(B.pcfType);
      if (!skipBoreCheck) {
        const minBore = commonLogic?.minPipeSize ?? 50;
        if (boreA < minBore || boreB < minBore) continue;
      }
    }

    // Strict Pipeline Check
    if (_extractPipelineRef(A.refno) !== _extractPipelineRef(B.refno)) continue;

    // Skip BRAN boundaries (likely discontinuities)
    if (A.pcfType === 'BRAN' || B.pcfType === 'BRAN') continue;

    const aExit = getExit(A);
    const bEntry = getEntry(B);
    if (!aExit || !bEntry) continue;

    const gap = _len(_sub(bEntry, aExit));
    const gapVec = _normalize(_sub(bEntry, aExit));

    // Check for Rider OLET
    const isRiderA = A.pcfType === 'OLET' && A.pts?.['1'] && A.pts?.['2'] && _len(_sub(A.pts['1'], A.pts['2'])) < 10;
    const isRiderB = B.pcfType === 'OLET' && B.pts?.['1'] && B.pts?.['2'] && _len(_sub(B.pts['1'], B.pts['2'])) < 10;
    const involvesRider = isRiderA || isRiderB;
    const involvesSupport = A.pcfType === 'SUPPORT' || B.pcfType === 'SUPPORT'
      || A.pcfType === 'ANCI' || B.pcfType === 'ANCI';

    const effectiveMinLen = involvesRider ? 1 : minPipeLen;

    if (!involvesRider && !involvesSupport) {
      if (hasNeighbour(aExit, A.refno)) continue;
      if (hasNeighbour(bEntry, B.refno)) continue;
    }

    if (gap < effectiveMinLen) continue;

    // Rule 9a: Max Pipe Run
    if (rulesEnabled) {
      const maxRun = commonLogic?.maxPipeRun ?? 30000;
      if (gap > maxRun) continue;
    }

    // Bore Compatibility Check
    // Rule 7: For gaps <= 1000mm, allow Bore Ratio 0.5-2.0. For >1000mm, enforce strict boreTol.
    // SKIP bore compatibility when B (or A) is a boreless anchor type (ANCI/SUPPORT/OLET) —
    // their bore is 0 in CSV and the synthetic pipe will inherit boreA anyway.
    const skipBoreCompat = BORELESS_TYPES.has(A.pcfType) || BORELESS_TYPES.has(B.pcfType);
    if (!skipBoreCompat) {
      if (gap > 1000) {
        if (Math.abs(boreA - boreB) > boreTol) continue;
      } else {
        if (boreA > 0 && boreB > 0) {
          const ratio = boreA / boreB;
          if (ratio < 0.5 || ratio > 2.0) continue;
        } else {
          if (Math.abs(boreA - boreB) > boreTol) continue;
        }
      }
    }

    // Component Name Check (avoid connecting distinct pipelines)
    const nameA = A.raw?.componentName ?? '';
    const nameB = B.raw?.componentName ?? '';
    const isSet = (n) => n && n.toLowerCase() !== 'unset' && n.trim() !== '';
    if (isSet(nameA) && isSet(nameB) && nameA !== nameB) {
      continue;
    }

    // Rule 4: Smart Rollback Check
    // Only check rollback if we just bridged a gap *into* A (prevTarget === A.refno).
    // If we arrived at A via a solid connection (no gap), we trust the topology.
    const isChainContinuous = prevTarget === A.refno;

    if (rulesEnabled && isChainContinuous && prevGapVec && Common3DLogic.isRollback(gapVec, prevGapVec)) {
      // Allow rollback ONLY if the intervening component (A) is a fitting that can turn (Elbo, Bend, Tee)
      // If A is a straight PIPE/FLAN/VALV, a rollback implies a fold-back error.
      const isTurning = ['ELBO', 'BEND', 'TEE', 'CROSS', 'OLET'].includes(A.pcfType);

      if (!isTurning) {
        warn(MOD, '_fillSequenceGaps', `Skipping rollback (fold-back) at ${A.refno} (Type ${A.pcfType} does not allow 180 turn)`);
        // Reset chain state since we broke the link
        prevGapVec = null;
        prevTarget = null;
        continue;
      }
    }

    // Common 3D Logic Validation (Skew, Length, etc.)
    if (rulesEnabled) {
      const validation = Common3DLogic.validateConnection(aExit, bEntry, boreA, { coordinateSettings: { common3DLogic: commonLogic } });
      if (!validation.valid) {
        if (validation.warn) {
          warn(MOD, '_fillSequenceGaps', `[USER ACTION REQUIRED] ${validation.reason} between ${A.refno} and ${B.refno} - Connection skipped`);
        }
        continue;
      }
    }

    // ── Vector Alignment Check ──────────────────────────────────────────────
    const aVec = _getExpectedDirection(A, aExit, true);
    const bVec = _getExpectedDirection(B, bEntry, false);

    const isNonZero = (v) => v && (Math.abs(v.E) > 1e-9 || Math.abs(v.N) > 1e-9 || Math.abs(v.U) > 1e-9);

    // Check Max Diagonal Gap:
    //   - Indeterminate components (SUPPORT/OLET): allow if axis-aligned OR gap ≤ maxSegmentLength
    //   - Turning components (ELBO/BEND/TEE/CROSS): exit direction changes at the fitting,
    //     so the gap vector after the turn won't align with the fitting's entry vector.
    //     Apply same short-diagonal fallback so a synthetic PIPE can be injected after the bend.
    //   - Straight components: strict dot-product alignment (> 0.9)
    //
    // Cap uses config.coordinateSettings.maxSegmentLength (default 20000mm) instead of the
    // old hardcoded commonLogic.maxDiagonalGap (6000mm).
    const maxSegLen = rulesEnabled
      ? (commonLogic?.maxSegmentLength ?? 20000)
      : Infinity;
    const isAxisAligned = (v) => Math.abs(v.E) > 0.9 || Math.abs(v.N) > 0.9 || Math.abs(v.U) > 0.9;
    const isShortEnough = (len) => len <= maxSegLen;

    // Turning component types — exit vec after a 90° bend won't match gap vec
    const TURN_TYPES = new Set(['ELBO', 'BEND', 'TEE', 'CROSS', 'OLET']);

    let alignedA = false;
    if (TURN_TYPES.has(A.pcfType)) {
      // ELBO/BEND/TEE exemption: treat like indeterminate — allow if axis-aligned OR short enough
      alignedA = isAxisAligned(gapVec) || isShortEnough(gap);
    } else if (isNonZero(aVec)) {
      alignedA = _dot(gapVec, aVec) > 0.9;
    } else {
      // Indeterminate direction (SUPPORT/OLET with no vector)
      alignedA = isAxisAligned(gapVec) || isShortEnough(gap);
    }

    let alignedB = false;
    if (TURN_TYPES.has(B.pcfType)) {
      // ELBO/BEND/TEE exemption: entry side of a bend can arrive from any direction
      alignedB = isAxisAligned(gapVec) || isShortEnough(gap);
    } else if (isNonZero(bVec)) {
      alignedB = _dot(gapVec, bVec) > 0.9;
    } else {
      // Indeterminate direction
      alignedB = isAxisAligned(gapVec) || isShortEnough(gap);
    }

    // Both ends must allow the connection
    if (!alignedA || !alignedB) continue;

    const synthRefno = `_gap_${A.refno}_${B.refno}`;
    const designFrom = aExit;

    const synthPipe = {
      refno: synthRefno,
      csvType: 'PIPE',
      pcfType: 'PIPE',
      skip: false,
      firstRowIndex: A.firstRowIndex + 0.5,
      dn: bEntry.bore ?? designFrom.bore ?? A.dn ?? B.dn ?? 0,
      rows: [],
      pts: {
        '1': { ...designFrom, E: aExit.E, N: aExit.N, U: aExit.U },
        '2': {
          ...designFrom, E: bEntry.E, N: bEntry.N, U: bEntry.U,
          bore: bEntry.bore ?? designFrom.bore ?? 0
        },
      },
    };

    newPipes.push(synthPipe);
    filled++;
    prevGapVec = gapVec;
    prevTarget = B.refno; // Mark B as the target of this gap

    for (const ptKey of ['1', '2']) {
      const pt = synthPipe.pts[ptKey];
      const key = _coordKey(pt, tol);
      if (!coordIdx.has(key)) coordIdx.set(key, []);
      coordIdx.get(key).push(synthRefno);
    }

    info(MOD, '_fillSequenceGaps',
      `Synthesised PIPE ${synthRefno} (${gap.toFixed(0)}mm) between ${A.refno} and ${B.refno}`);
  }

  for (const sp of newPipes) {
    groups.set(sp.refno, sp);
  }

  if (filled > 0) {
    info(MOD, '_fillSequenceGaps', `Gap fill complete: ${filled} PIPE(s) synthesised`);
  }

  return filled;
};

// ── Coordinate Snapping ───────────────────────────────────────────────────────

/**
 * Mathematically snap component endpoints that are within the continuity tolerance.
 * Ensures that if two endpoints are close, they become perfectly identical in the PCF output.
 */
const _snapCoordinates = (groups, tol) => {
  if (tol <= 0.001) return 0;
  let snaps = 0;
  const tolSq = tol * tol;

  const allPoints = [];
  for (const [, g] of groups) {
    if (g.skip || !g.pts) continue;
    for (const k of ['1', '2', '3', '0']) {
      if (g.pts[k]) allPoints.push({ ref: g.refno, pt: g.pts[k] });
    }
  }

  for (let i = 0; i < allPoints.length; i++) {
    const p1 = allPoints[i].pt;
    for (let j = i + 1; j < allPoints.length; j++) {
      if (allPoints[i].ref === allPoints[j].ref) continue; // don't snap component to itself

      const p2 = allPoints[j].pt;
      const dSq = (p1.E - p2.E) ** 2 + (p1.N - p2.N) ** 2 + (p1.U - p2.U) ** 2;

      if (dSq > 0.0001 && dSq <= tolSq) {
        p2.E = p1.E;
        p2.N = p1.N;
        p2.U = p1.U;
        snaps++;
      }
    }
  }

  if (snaps > 0) {
    info(MOD, '_snapCoordinates', `Physically snapped ${snaps} endpoints within ${tol}mm tolerance.`);
  }
  return snaps;
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resolve overlapping PIPE components by splitting them around inner components.
 *
 * Pass order:
 *   0. Coordinate snapping — forces endpoints within tolerance to share exact coordinates
 *   1. Split engulfing PIPEs into sub-pipes (per-component span walk)
 *   2. Absorb GASK gaps into adjacent FLANs
 *   3. Validate continuity — flag fully-disconnected components as WARNING
 *   4. Detect same-type overlaps — flag data errors as ERROR
 *
 * @param {Map<string, ComponentGroup>} groups  - grouped components (pts already built)
 * @param {object} config                       - app config
 * @returns {{ groups: Map, anomalies: object[] }}
 */
export const resolveOverlaps = (groups, config) => {
  const settings = config?.coordinateSettings?.overlapResolution ?? {};

  // Global toggle — pass-through if disabled
  if (settings.enabled === false) {
    return { groups, anomalies: [] };
  }

  const tol = config?.coordinateSettings?.continuityTolerance ?? 0.5;
  const boreTol = settings.boreTolerance ?? 1.0;
  const minPipeLen = settings.minPipeLength ?? 10.0;

  // Pass 0: Physically snap endpoints within tolerance
  _snapCoordinates(groups, tol);

  const commonLogic = config?.coordinateSettings?.common3DLogic ?? Common3DLogic.DEFAULTS;
  const rulesEnabled = commonLogic.enabled !== false;

  // Rule 7: Priority Processing (Sort by Bore Descending)
  const groupArray = [...groups.entries()];
  if (rulesEnabled) {
    groupArray.sort((a, b) => {
      const boreA = a[1].pts?.['1']?.bore ?? 0;
      const boreB = b[1].pts?.['1']?.bore ?? 0;
      // Descending bore
      if (boreB !== boreA) return boreB - boreA;
      // Preserve sequence for same bore
      return a[1].firstRowIndex - b[1].firstRowIndex;
    });
  }

  const sortedGroups = new Map(groupArray);
  const result = new Map();
  let totalSplit = 0;

  for (const [refno, group] of sortedGroups) {
    // Rule 6: Skip small bore pipes (<50mm) in Pass 1
    const ep1 = group.pts?.['1'];
    const pipeBore = ep1?.bore ?? 0;
    if (rulesEnabled && group.pcfType === 'PIPE' && pipeBore < (commonLogic.minPipeSize ?? 50)) {
      result.set(refno, group);
      continue;
    }

    // Only PIPE groups with at least EP1 are candidates for splitting
    if (group.pcfType !== 'PIPE' || group.skip || !ep1 || group.skipEngulfSplit) {
      result.set(refno, group);
      continue;
    }

    // ── Case A: PIPE has both endpoints — normal engulfment detection ─────
    // ── Case B: PIPE has only EP1 (CSV truncated, EP2 row absent) ─────────
    //    Infer the pipe axis from collinear bore-matching inner components.
    //    Use the farthest collinear inner endpoint as a virtual EP2.
    let ep2 = group.pts['2'] ?? null;
    let L = ep2 ? _len(_sub(ep2, ep1)) : 0;
    let inferredEp2 = false;

    if (!ep2) {
      const candidates = [];
      for (const [, g] of groups) {
        if (g.refno === refno || g.skip) continue;
        for (const { pt } of _getGroupEndpoints(g)) {
          if (Math.abs((pt.bore ?? 0) - pipeBore) > boreTol) continue;
          // Collinearity: at least 2 of 3 axes match ep1 within tol
          const matchE = Math.abs(pt.E - ep1.E) < tol;
          const matchN = Math.abs(pt.N - ep1.N) < tol;
          const matchU = Math.abs(pt.U - ep1.U) < tol;
          if ((matchE ? 1 : 0) + (matchN ? 1 : 0) + (matchU ? 1 : 0) >= 2) {
            candidates.push(pt);
          }
        }
      }
      if (candidates.length === 0) {
        result.set(refno, group);
        continue;
      }
      // Farthest candidate from ep1 defines the virtual axis end
      let farthest = candidates[0];
      let maxDist = _len(_sub(farthest, ep1));
      for (const c of candidates) {
        const d = _len(_sub(c, ep1));
        if (d > maxDist) { maxDist = d; farthest = c; }
      }
      ep2 = farthest;
      L = maxDist;
      inferredEp2 = true;
      group.pts['2'] = farthest; // PERMANENTLY save the inferred EP2 so it survives if loop bypassed
      info(MOD, 'resolveOverlaps',
        `PIPE ${refno}: no EP2 in CSV — inferred axis to (${ep2.E},${ep2.N},${ep2.U}), L=${L.toFixed(1)}mm`);
    }

    if (L < minPipeLen) {
      result.set(refno, group);
      continue;
    }

    // Max Pipe Run guard — if pipe length exceeds maxPipeRun, skip engulf-splitting.
    // The pipe is kept as-is; overlap detection is not attempted on very long pipe runs.
    const maxPipeRun = commonLogic?.maxPipeRun ?? null;
    const enableMaxPipeRun = commonLogic?.enableMaxPipeRun ?? false;
    if (rulesEnabled && enableMaxPipeRun && maxPipeRun !== null && L > maxPipeRun) {
      info(MOD, 'resolveOverlaps',
        `PIPE ${refno}: length ${L.toFixed(1)}mm exceeds Max Pipe Run (${maxPipeRun}mm) — skipping engulf-split`);
      result.set(refno, group);
      continue;
    }

    // Collect one span per inner component (entryT → exitT along the axis).
    // Gaps are measured BETWEEN components, never across a component's own body.
    const pipeName = _getComponentName(group);

    const spans = _innerComponentSpans(
      groups, refno, pipeName, ep1, ep2, pipeBore, tol, boreTol, inferredEp2, settings
    );

    if (spans.length === 0) {
      // Straight-axis projection found nothing.
      // Fallback: path-chain tracing from EP1 for 3D-routed BRANs (through ELBOs, bends, etc.)
      // This handles pipes whose EP1→EP2 is a long diagonal that doesn't align with any inner
      // component (e.g. BRAN/1662 whose diagonal is ~35,939mm but routes through 5+ ELBOs).
      const chain = _tracePathChain(groups, refno, pipeName, ep1, pipeBore, tol, boreTol, settings);

      if (chain.length === 0) {
        // ── Fallback 3: Dominant-axis scan ─────────────────────────────────
        // Handles pipes whose EP1→EP2 is a 3D diagonal but all inner components
        // stay on 2 constant axes and only vary along one (e.g. BRAN/1151 inner
        // components are all at E=96400, N=16586.4 and vary in U, but the BRAN
        // axis goes from U=101968 to E=95683 diagonally — so projection fails and
        // path-chain can't start because the first component is 505mm away from EP1).
        const dasResult = _dominantAxisScan(
          groups, refno, pipeName, ep1, ep2, pipeBore, tol, boreTol, inferredEp2, settings
        );

        if (!dasResult || dasResult.spans.length === 0) {
          // Truly standalone — no inner components reachable by any method
          result.set(refno, group);
          continue;
        }

        const { spans: dasSpans, L: dasL } = dasResult;
        const dasSubPipes = [];
        let dasPrevExitT = 0;
        let dasPrevExitCoord = ep1;

        for (const span of dasSpans) {
          const gap = span.entryT - dasPrevExitT;
          if (gap >= minPipeLen) {
            dasSubPipes.push(_makeSynthPipe(group, dasPrevExitCoord, span.entryCoord, dasSubPipes.length));
          }
          dasPrevExitT = span.exitT;
          dasPrevExitCoord = span.exitCoord;
        }

        // Trailing gap: last span exit → BRAN EP2 (only if EP2 is real and on the same axis)
        if (ep2 && !inferredEp2 && dasL !== null) {
          const trailing = dasL - dasPrevExitT;
          if (trailing >= minPipeLen) {
            dasSubPipes.push(_makeSynthPipe(group, dasPrevExitCoord, ep2, dasSubPipes.length));
          }
        }

        if (dasSubPipes.length === 0) {
          result.set(refno, group);
        } else {
          for (const sp of dasSubPipes) result.set(sp.refno, sp);
          totalSplit++;
          info(MOD, 'resolveOverlaps',
            `Split PIPE ${refno} via dominant-axis(${dasResult.axis}) → ${dasSubPipes.length} sub-pipe(s)`);
        }
        continue;
      }

      // Build sub-pipes for gaps between consecutive chain components
      const subPipes = [];
      let prevExitCoord = ep1;

      for (const link of chain) {
        const gap = _len(_sub(link.entryCoord, prevExitCoord));
        if (gap >= minPipeLen) {
          subPipes.push(_makeSynthPipe(group, prevExitCoord, link.entryCoord, subPipes.length));
        }
        prevExitCoord = link.exitCoord;
      }

      // Trailing gap: last chain-component exit → BRAN EP2 (only if EP2 is real, not inferred)
      if (ep2 && !inferredEp2) {
        const trailing = _len(_sub(ep2, prevExitCoord));
        if (trailing >= minPipeLen) {
          subPipes.push(_makeSynthPipe(group, prevExitCoord, ep2, subPipes.length));
        }
      }

      if (subPipes.length === 0) {
        result.set(refno, group);
      } else {
        for (const sp of subPipes) result.set(sp.refno, sp);
        totalSplit++;
        info(MOD, 'resolveOverlaps',
          `Split PIPE ${refno} via path-chain → ${subPipes.length} sub-pipe(s)`,
          { chain: chain.map(c => c.group.refno) });
      }
      continue;
    }

    // Walk component-by-component: only the gap from prevExitT → span.entryT
    // produces a sub-pipe. The span itself (component body) is skipped automatically.
    const subPipes = [];
    let prevExitT = 0;
    let prevExitCoord = ep1;

    for (const span of spans) {
      const gap = span.entryT - prevExitT;
      if (gap >= minPipeLen) {
        subPipes.push(_makeSynthPipe(group, prevExitCoord, span.entryCoord, subPipes.length));
      }
      prevExitT = span.exitT;
      prevExitCoord = span.exitCoord;
    }

    // Trailing gap between last component exit and pipe EP2
    const trailingGap = L - prevExitT;
    if (trailingGap >= minPipeLen) {
      subPipes.push(_makeSynthPipe(group, prevExitCoord, ep2, subPipes.length));
    }

    if (subPipes.length === 0) {
      // All inter-component gaps were below minPipeLen — keep original
      result.set(refno, group);
      info(MOD, 'resolveOverlaps',
        `PIPE ${refno}: all gaps < minPipeLength (${minPipeLen}mm) — kept as-is`);
    } else {
      for (const sp of subPipes) result.set(sp.refno, sp);
      totalSplit++;
      info(MOD, 'resolveOverlaps',
        `Split PIPE ${refno} → ${subPipes.length} sub-pipe(s)`,
        { subPipes: subPipes.map(sp => `${sp.refno} [${sp.pts['1'].N}→${sp.pts['2'].N}]`) });

      const innerRefs = spans.map(s => s.refno).join(', ');
      globalLogger.logOverlapSplit(refno, innerRefs || 'inferred/chain');
    }
  }

  if (totalSplit > 0) {
    info(MOD, 'resolveOverlaps',
      `Overlap resolution complete: ${totalSplit} PIPE(s) split`, { totalGroups: result.size });
  }

  // Pass 2: Absorb GASK gaps into adjacent FLANs
  _absorbGaskets(result, tol);

  // Pass 2.5: Sequence-based gap fill — synthesise PIPE segments between
  // consecutive components that have no connecting neighbour
  if (settings.gapFillEnabled !== false) {
    const ignoreSupports = settings.ignoreSupports === true;
    // Inject maxSegmentLength from parent config so _fillSequenceGaps can cap gaps correctly
    const commonLogicWithSegLen = {
      ...commonLogic,
      maxSegmentLength: config?.coordinateSettings?.maxSegmentLength ?? 20000,
    };
    _fillSequenceGaps(result, tol, minPipeLen, boreTol, commonLogicWithSegLen, ignoreSupports);
  }


  // Pass 3: Continuity validation — flag fully-disconnected components (both endpoints isolated)
  const contAnomalies = _validateContinuity(result, tol);

  // Pass 4: Same-type overlap detection — flag data errors
  const overlapAnomalies = _detectSameTypeOverlaps(result, tol, boreTol, commonLogic);

  // Continuity warnings first, then overlap errors
  const anomalies = [...contAnomalies, ...overlapAnomalies];

  return { groups: result, anomalies };
};
