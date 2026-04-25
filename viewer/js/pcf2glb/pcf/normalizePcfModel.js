/**
 * normalizePcfModel.js
 * Converts splitPcfBlocks output into a normalized component model.
 * Each component has: id, type, ep1, ep2, coOrds, cp, bp, bore, attributes{}, raw{}.
 */

const GEOMETRY_KEYS = new Set(['END-POINT', 'CO-ORDS', 'CENTRE-POINT', 'BRANCH1-POINT']);

function parsePoint(str, includeBore) {
  const parts = String(str || '').trim().split(/\s+/).map(Number);
  if (parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return null;
  const pt = { x: parts[0], y: parts[1], z: parts[2] };
  if (includeBore) pt.bore = Number.isFinite(parts[3]) ? parts[3] : 0;
  return pt;
}

function normalizeBlock(block, log, idx) {
  const comp = {
    id: `comp_${idx}`,
    type: block.type,
    raw: block.rawAttrs,     // raw key-value pairs from splitPcfBlocks
    attributes: {},          // clean non-geometry attributes (excludes END-POINT/CO-ORDS etc.)
    ep1: null,
    ep2: null,
    coOrds: null,            // support placement coordinate — separate from pipe endpoints
    cp: null,                // CENTRE-POINT (elbows, bends)
    bp: null,                // BRANCH1-POINT (tees, olets)
    bore: 0,
  };

  const endPoints = [];

  // Skip block.lines[0] — it is the type keyword itself
  for (const line of block.lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('END-POINT')) {
      const pt = parsePoint(trimmed.replace(/^END-POINT\s*/, ''), true);
      if (pt) endPoints.push(pt);

    } else if (trimmed.startsWith('CO-ORDS')) {
      // Support placement — NOT a pipe endpoint
      const pt = parsePoint(trimmed.replace(/^CO-ORDS\s*/, ''), true);
      if (pt) comp.coOrds = pt;

    } else if (trimmed.startsWith('CENTRE-POINT')) {
      const pt = parsePoint(trimmed.replace(/^CENTRE-POINT\s*/, ''), false);
      if (pt) comp.cp = { x: pt.x, y: pt.y, z: pt.z };

    } else if (trimmed.startsWith('BRANCH1-POINT')) {
      const pt = parsePoint(trimmed.replace(/^BRANCH1-POINT\s*/, ''), true);
      if (pt) comp.bp = { x: pt.x, y: pt.y, z: pt.z, bore: pt.bore || 0 };

    } else {
      // Attribute line — support both plain keys and angle-bracket keys like <SUPPORT_NAME>
      const kv = trimmed.match(/^(<[^>]+>|[A-Z][A-Z0-9_\-]*)\s+(.*)/);
      if (kv) {
        comp.attributes[kv[1]] = kv[2].trim();
      } else {
        const single = trimmed.match(/^(<[^>]+>|[A-Z][A-Z0-9_\-]*)$/);
        if (single) comp.attributes[single[1]] = '';
      }
    }
  }

  comp.ep1 = endPoints[0] || null;
  comp.ep2 = endPoints[1] || null;
  comp.bore = (comp.ep1 && Number.isFinite(comp.ep1.bore)) ? comp.ep1.bore : 0;

  // MESSAGE-CIRCLE: circleCoord from CO-ORDS, text from TEXT attribute
  if (block.type === 'MESSAGE-CIRCLE') {
    const co = comp.coOrds;
    comp.circleCoord = co ? { x: co.x, y: co.y, z: co.z } : null;
    comp.circleText = comp.attributes['TEXT'] || '';
  }

  // MESSAGE-SQUARE: annotation text is the first non-blank content line
  if (block.type === 'MESSAGE-SQUARE') {
    const textLine = block.lines.slice(1).find(l => l.trim());
    if (textLine) comp.squareText = textLine.trim();
  }

  return comp;
}

export function normalizePcfModel(parsed, log) {
  const components = [];

  parsed.blocks.forEach((block, idx) => {
    const comp = normalizeBlock(block, log, idx);
    if (comp) components.push(comp);
  });

  // Post-process MESSAGE-SQUARE: assign squarePos from the next real component's ep1
  for (let i = 0; i < components.length; i++) {
    if (components[i].type === 'MESSAGE-SQUARE' && components[i].squareText) {
      for (let j = i + 1; j < components.length; j++) {
        const next = components[j];
        if (next.type !== 'MESSAGE-SQUARE' && next.type !== 'MESSAGE-CIRCLE') {
          const pt = next.ep1 || next.ep2 || next.coOrds;
          if (pt) components[i].squarePos = { x: pt.x, y: pt.y, z: pt.z };
          break;
        }
      }
    }
  }

  return {
    meta: parsed.meta,
    components,
  };
}
