/**
 * snapper.js — Sequential Snapping & Gap Filling
 * Implements "Robust Sequential" logic:
 * 1. Iterates components in input order.
 * 2. Snaps Start Point to Previous End Point if gap < Tolerance.
 * 3. Fills Gap with PIPE if gap > Tolerance.
 */

import { distance3D } from './coord-engine.js';
import { info, warn } from '../logger.js';

const MOD = 'snapper';

/**
 * Run sequential snapping and gap filling.
 * @param {Map<string, ComponentGroup>} groups
 * @param {number} tolerance (mm)
 * @returns {Map<string, ComponentGroup>}
 */
export const snapSequential = (groups, tolerance, config) => {
  const result = new Map();
  const list = [...groups.values()]; // Assumes insertion order = input order
  const maxGap = config?.coordinateSettings?.sequentialMaxGap ?? 7000;
  if (list.length === 0) return groups;

  let prevEnd = null;
  let gapCount = 0;
  let snapCount = 0;

  for (const group of list) {
    if (group.skip) {
      result.set(group.refno, group);
      continue;
    }

    const p1 = group.pts?.['1']; // Start
    const p2 = group.pts?.['2']; // End

    // Determine Entry/Exit
    // For sequential logic, we assume Point 1 is Entry, Point 2 is Exit.
    // (If not, we might need logic to flip, but simple CSVs usually follow 1->2 flow).

    if (!p1) {
      // Support or singleton? Just add it.
      // Update prevEnd? If it's on the line, maybe.
      // For ANCI/SUPPORT, they usually sit *on* the pipe, not break it.
      // If we treat them as breaking, we get the "spider web" if we bridge to them.
      // "Robust Sequential" usually ignores Supports for connectivity chain.
      if (group.pcfType !== 'SUPPORT' && group.pcfType !== 'ANCI') {
        // Reset chain if we hit a weird component without P1
        prevEnd = null;
      }
      result.set(group.refno, group);
      continue;
    }

    if (prevEnd) {
      const d = distance3D(prevEnd, p1);

      if (d <= tolerance) {
        if (d > 0.001) {
          // Snap! Local Stretch strategy:
          // Instead of globally shifting p1 backward (which causes drift), 
          // we physically stretch the PREVIOUS component's End Point forward to perfectly touch p1.
          prevEnd.E = p1.E;
          prevEnd.N = p1.N;
          prevEnd.U = p1.U;
          snapCount++;
        }
        // If d <= 0.001, it's a perfect match. We accept it as continuous.
        // No action needed, but we don't break the chain.
      } else {
        // Gap Fill Validation (Rule: Avoid massive gaps if metadata changes significantly)
        let allowFill = true;

        // 1. Bore Check
        // Rule: If gap <= 1000mm, apply Bore Ratio (0.5 - 2.0).
        // If gap > 1000mm, apply strict 2mm tolerance? Or always apply 2mm tolerance unless ratio is set?
        // The user said "rule 7: upto 1000mm Bore ratios =0.5 to 2".
        // This implies relaxed tolerance for short gaps (reducers?), but maybe strict for long gaps?
        // Actually, existing code had strict 2mm check.
        // Let's implement the ratio logic for short gaps, and strict for long gaps (or keep strict everywhere if ratio fails).
        // Wait, if ratio is 0.5 (e.g. 100 -> 50), that's a reducer.
        // If we allow 0.5 ratio, we allow filling a gap between 100 and 50 with a reducer-like pipe?
        // Yes, "synthetic pipe".

        const b1 = prevEnd.bore ?? 0;
        const b2 = p1.bore ?? 0;
        const gapLen = d;

        // 0. Max Gap Check
        if (gapLen > maxGap) {
          allowFill = false;
          info(MOD, 'snapSequential', `Gap fill blocked: Gap ${gapLen.toFixed(0)}mm > Max ${maxGap}mm`);
        }

        // Strict Bore Match for Long Gaps (> 1000mm)
        if (gapLen > 1000 && Math.abs(b1 - b2) > 2.0) {
          allowFill = false;
          info(MOD, 'snapSequential', `Gap fill blocked (>1m): Bore change ${b1} -> ${b2}`);
        }
        // Ratio Check for Short Gaps (<= 1000mm)
        else if (gapLen <= 1000 && b1 > 0 && b2 > 0) {
          const ratio = b1 / b2;
          if (ratio < 0.5 || ratio > 2.0) {
            allowFill = false;
            info(MOD, 'snapSequential', `Gap fill blocked (Ratio): ${b1}/${b2} = ${ratio.toFixed(2)}`);
          }
        }
        // Fallback for zero bore or edge cases - assume strict if not handled above?
        // If b1 or b2 is 0, ratio is undefined/infinity. If strict > 2.0, we block.
        // If one is 0, `abs(b1-b2) > 2.0` catches it.
        else if (Math.abs(b1 - b2) > 2.0) {
          allowFill = false;
          info(MOD, 'snapSequential', `Gap fill blocked (Strict): Bore change ${b1} -> ${b2}`);
        }

        // 2. Component Name Check (if both defined and not 'unset')
        const nameA = prevEnd.compName;
        const nameB = p1.compName;
        const isSet = (n) => n && n.toLowerCase() !== 'unset' && n.trim() !== '';

        if (isSet(nameA) && isSet(nameB) && nameA !== nameB) {
          allowFill = false;
          info(MOD, 'snapSequential', `Gap fill blocked: Name mismatch "${nameA}" vs "${nameB}"`);
        }

        if (allowFill) {
          // Insert implicit pipe
          const gapRef = `_gap_${gapCount++}`;
          const gapPipe = {
            refno: gapRef,
            pcfType: 'PIPE',
            csvType: 'PIPE',
            skip: false,
            pts: {
              '1': { ...prevEnd, bore: p1.bore }, // Inherit bore from next component
              '2': { ...p1, bore: p1.bore }
            }
          };
          result.set(gapRef, gapPipe);
          info(MOD, 'snapSequential', `Filled gap ${d.toFixed(1)}mm with ${gapRef}`);
        } else {
          // Break chain
          prevEnd = null;
        }
      }
    }

    // Update PrevEnd
    // If component is a PIPE/FITTING, the flow continues from P2.
    // If component is SUPPORT, flow continues from P1 (it's a point on line).
    // Actually, supports in CSVs usually have P1/P2 if they are "length" supports, or P0 if point.
    // If P2 exists, use it.
    if (p2) {
      prevEnd = group.pts['2'];
    } else {
      // Point component (Blind? Cap? Support?)
      // If it's a Cap/Blind, flow stops.
      // If it's a Support, flow *should* have continued through the pipe it's on.
      // But in sequential list, the Support often appears *after* the Pipe or *between* Pipes.
      // If between, and it has no length, we should probably keep prevEnd as is (the end of the previous pipe).
      if (group.pcfType !== 'SUPPORT' && group.pcfType !== 'ANCI') {
        prevEnd = null; // Break chain
      }
    }

    result.set(group.refno, group);
  }

  info(MOD, 'snapSequential', `Snapped ${snapCount} joints. Filled ${gapCount} gaps.`);
  return result;
};
