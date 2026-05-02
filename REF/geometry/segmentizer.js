/**
 * segmentizer.js — Automatic Pipe Segmentation
 * Splits PIPE components exceeding a maximum length into multiple smaller segments.
 * Used for long runs to match fabrication/stock lengths.
 */

import { info, warn } from '../logger.js';
import { globalLogger } from '../utils/diagnostic-logger.js';

const MOD = 'segmentizer';

// Vector math helpers
const _sub = (a, b) => ({ E: a.E - b.E, N: a.N - b.N, U: a.U - b.U });
const _add = (a, b) => ({ E: a.E + b.E, N: a.N + b.N, U: a.U + b.U });
const _mul = (v, s) => ({ E: v.E * s, N: v.N * s, U: v.U * s });
const _len = (v) => Math.sqrt(v.E * v.E + v.N * v.N + v.U * v.U);

/**
 * Segmentize PIPES that exceed maxLen.
 * @param {Map<string, ComponentGroup>} groups
 * @param {number} maxLen (mm) e.g. 13100
 * @returns {Map<string, ComponentGroup>} New map with split pipes
 */
export const segmentizePipes = (groups, maxLen) => {
  if (!maxLen || maxLen <= 0) return groups;

  const result = new Map();
  let splitCount = 0;

  for (const [refno, group] of groups) {
    // Only segment PIPE components
    if (group.pcfType !== 'PIPE' || group.skip) {
      result.set(refno, group);
      continue;
    }

    const p1 = group.pts?.['1'];
    const p2 = group.pts?.['2'];

    if (!p1 || !p2) {
      result.set(refno, group);
      continue;
    }

    const vec = _sub(p2, p1);
    const len = _len(vec);

    if (len <= maxLen) {
      result.set(refno, group);
      continue;
    }

    // Split logic
    const numSegments = Math.ceil(len / maxLen);
    const segLen = len / numSegments; // Equal length segments
    const dir = _mul(vec, 1 / len); // Unit vector

    info(MOD, 'segmentize', `Splitting ${refno} (${len.toFixed(0)}mm) into ${numSegments} segments of ~${segLen.toFixed(0)}mm`);
    globalLogger.logSegmentCut(len, segLen, len - segLen);

    let prevPoint = p1;
    for (let i = 0; i < numSegments; i++) {
      const isLast = i === numSegments - 1;
      const nextPoint = isLast ? p2 : _add(prevPoint, _mul(dir, segLen));

      // Create new group
      const newRef = `${refno}_seg${i + 1}`;
      const newGroup = {
        ...group,
        refno: newRef,
        pts: {
          '1': { ...prevPoint, bore: p1.bore }, // Inherit bore/attribs
          '2': { ...nextPoint, bore: p2.bore }
        }
      };

      result.set(newRef, newGroup);
      prevPoint = nextPoint;
    }
    splitCount++;
  }

  if (splitCount > 0) {
    info(MOD, 'segmentize', `Segmented ${splitCount} long pipes.`);
  }

  return result;
};
