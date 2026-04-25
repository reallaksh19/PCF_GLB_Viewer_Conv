/**
 * max-finder.js — Compute basis-of-maximum values from parsed CAESAR II data.
 * Returns a summary object used by the Input Data tab BASIS card.
 */

import { pipeLength } from './formatter.js';
import { STRESS_TABLE, DISPLACEMENT_TABLE } from '../data/report-data.js';

/**
 * Compute max values from both static report data and live parsed data.
 * @param {object|null} parsed  — output of caesar-parser.js, may be null
 * @returns {object}
 */
export function computeMaxValues(parsed) {
  const result = {
    maxStress: null,
    maxDisplacement: null,
    longestSpan: null,
    heaviestRigid: null,
    maxAppliedForce: null,
  };

  const stresses = parsed?.stresses?.length ? parsed.stresses : STRESS_TABLE;
  const displacements = parsed?.displacements?.length ? parsed.displacements : DISPLACEMENT_TABLE;

  // Max stress — from parsed or static data
  if (stresses.length) {
    const row = [...stresses].sort((a, b) => b.ratio - a.ratio)[0];
    result.maxStress = {
      node: row.node,
      value: row.calc,
      unit: parsed?.stresses?.length ? 'KPa' : 'MPa',
      loadCase: row.loadCase,
    };
  }

  // Max displacement — from parsed or static data
  if (displacements.length) {
    let maxRow = null, maxVal = 0;
    for (const row of displacements) {
      const vals = [Math.abs(row.dx || 0), Math.abs(row.dy || 0), Math.abs(row.dz || 0)];
      const m = Math.max(...vals);
      if (m > maxVal) { maxVal = m; maxRow = row; }
    }
    if (maxRow) {
      const dir = Math.abs(maxRow.dy || 0) >= Math.abs(maxRow.dx || 0) && Math.abs(maxRow.dy || 0) >= Math.abs(maxRow.dz || 0)
        ? 'DY' : Math.abs(maxRow.dx || 0) >= Math.abs(maxRow.dz || 0) ? 'DX' : 'DZ';
      result.maxDisplacement = {
        node: maxRow.node,
        value: maxVal,
        dir,
        unit: 'mm',
        loadCase: maxRow.loadCase,
      };
    }
  }

  if (!parsed) return result;

  // Longest span — from parsed elements
  if (parsed.elements?.length) {
    let longest = null, longestLen = 0;
    for (const el of parsed.elements) {
      const len = pipeLength(el.dx ?? 0, el.dy ?? 0, el.dz ?? 0);
      if (len > longestLen) {
        longestLen = len;
        longest = el;
      }
    }
    if (longest) {
      result.longestSpan = {
        from: longest.from,
        to: longest.to,
        length: longestLen,
        unit: 'mm',
      };
    }
  }

  // Heaviest rigid — from parsed rigid elements
  if (parsed.rigids?.length) {
    const heaviest = [...parsed.rigids].sort((a, b) => b.mass - a.mass)[0];
    result.heaviestRigid = {
      node: heaviest.node ?? heaviest.from,
      mass: heaviest.mass,
      unit: 'kg',
    };
  }

  // Max applied force magnitude
  if (parsed.forces?.length) {
    let maxForce = null, maxMag = 0;
    for (const f of parsed.forces) {
      const mag = Math.sqrt((f.fx ** 2) + (f.fy ** 2) + (f.fz ** 2));
      if (mag > maxMag) { maxMag = mag; maxForce = f; }
    }
    if (maxForce) {
      result.maxAppliedForce = {
        node: maxForce.node,
        fx: maxForce.fx,
        fy: maxForce.fy,
        fz: maxForce.fz,
        magnitude: maxMag,
        unit: 'N',
      };
    }
  }

  return result;
}

export function computeOperatingConditions(parsed) {
  if (!parsed || !parsed.elements?.length) return null;
  const values = {};

  for (let i = 1; i <= 9; i++) {
    values[`T${i}`] = { value: -Infinity };
    values[`P${i}`] = { value: -Infinity };
  }
  values.T3 = { value: Infinity }; // Override T3 default logic if it's considered a minimum
  values.P_hydro = { value: -Infinity };

  for (const el of parsed.elements) {
    for (let i = 1; i <= 9; i++) {
      if (i === 3 && el.T3 !== undefined && el.T3 < values.T3.value) {
        values.T3 = { value: el.T3 }; // Min design temp
      } else if (el[`T${i}`] !== undefined && el[`T${i}`] > values[`T${i}`].value) {
        values[`T${i}`] = { value: el[`T${i}`] };
      }

      if (el[`P${i}`] !== undefined && el[`P${i}`] > values[`P${i}`].value) {
        values[`P${i}`] = { value: el[`P${i}`] };
      }
    }
    if (el.P_hydro !== undefined && el.P_hydro > values.P_hydro.value) {
      values.P_hydro = { value: el.P_hydro };
    }
  }

  const result = {};
  for (const key of Object.keys(values)) {
    result[key] = Number.isFinite(values[key].value) ? values[key].value : undefined;
  }
  return result;
}
