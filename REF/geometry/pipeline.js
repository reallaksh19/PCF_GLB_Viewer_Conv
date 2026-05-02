/**
 * pipeline.js — Geometry Processing Pipeline
 * Orchestrates the point building, overlap resolution, and multi-pass refinement logic.
 *
 * Implements "Mode A vs Mode B" and "Two-Pass" strategies as requested.
 */

import { buildPts } from '../converter/point-builder.js';
import { resolveOverlaps } from './overlap-resolver.js';
import { snapSequential } from './snapper.js';
import { segmentizePipes } from './segmentizer.js';
import { info, warn } from '../logger.js';
import { applyAlgebraicSequenceMath } from '../services/topology-service.js';

const MOD = 'pipeline';

/**
 * Process component groups to generate final geometry.
 * Handles point building, overlap resolution, and optional multi-pass gap filling.
 *
 * @param {Map<string, ComponentGroup>} groups  - Raw component groups
 * @param {object} config                       - Full app configuration
 * @returns {{ groups: Map, anomalies: object[] }}
 */
export const processGeometry = (groups, config) => {
  const settings = config?.coordinateSettings ?? {};
  const pipelineMode = settings.pipelineMode ?? 'repair'; // 'strict' | 'repair' | 'sequential'
  const multiPass = settings.multiPass ?? true;

  info(MOD, 'processGeometry', `Starting geometry pipeline in "${pipelineMode}" mode (MultiPass: ${multiPass})`);

  // 1. Build Points sequentially — pts['1'] = first row, pts['2'] = last row.
  info(MOD, 'processGeometry', 'Building Points sequentially from rows...');
  let builtCount = 0;
  for (const [, g] of groups) {
    if (!g.pts) {
      g.pts = buildPts(g, config);
      builtCount++;
    }
  }
  info(MOD, 'processGeometry', `Built points for ${builtCount} groups`);

  let finalGroups = groups;
  let finalAnomalies = [];

  // ── BRANCH: SEQUENTIAL MODE ──────────────────────────────────────────────
  if (pipelineMode === 'sequential') {
    info(MOD, 'processGeometry', 'Executing Sequential Robust Mode (Overlap Resolution DISABLED per GATE 6)...');

    // 2. Run Snapping & Gap Filling (Sequential)
    const tol = settings.continuityTolerance ?? 6.0;
    finalGroups = snapSequential(finalGroups, tol, config);

  } else {
    // ── BRANCH: GRAPH MODE (Strict / Repair) ──────────────────────────────
    info(MOD, 'processGeometry', 'Skipping Overlap Resolution Pass 1 and 2 (Moved upstream to ValidatedCSVdata per GATE 6).');
  }

  // ── FINAL STEP: SEGMENTATION ──────────────────────────────────────────────
  info(MOD, 'processGeometry', `Skipping Pipeline Segmentation (Moved upstream to ValidatedCSVdata per GATE 6).`);

  // ALGEBRAIC COMPONENT SEQUENCE MATH (Strict Point Overwrite)
  // Irrespective of rows, forces Pt1 to connect sequentially to previous Pt2,
  // and projects Pt2 algebraically per user specification.
  const activeTol = settings.continuityTolerance ?? 6.0;
  const orderedGroups = Array.from(finalGroups.values()).sort((a, b) => (a.firstRowIndex || 0) - (b.firstRowIndex || 0));
  applyAlgebraicSequenceMath(orderedGroups, activeTol);

  // Deduplicate anomalies
  const uniqueAnomalies = [];
  const seenIds = new Set();
  for (const a of finalAnomalies) {
    if (!seenIds.has(a.id)) {
      seenIds.add(a.id);
      uniqueAnomalies.push(a);
    }
  }

  return { groups: finalGroups, anomalies: uniqueAnomalies, groupsPass1: finalGroups };
};
