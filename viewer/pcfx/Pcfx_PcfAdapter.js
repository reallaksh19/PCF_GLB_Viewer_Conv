/**
 * Pcfx_PcfAdapter.js
 * PCF <-> canonical `.pcfx` item mapping.
 * Inputs are raw PCF text or canonical items. Outputs are normalized `.pcfx` documents or PCF text.
 */

import { parsePcfText } from '../js/pcf2glb/pcf/parsePcfText.js';
import { normalizePcfModel } from '../js/pcf2glb/pcf/normalizePcfModel.js';
import { serializeToPCF } from '../pcf-builder/3DV_PCFSerializer.js';
import { createPcfxDocument, normalizeCanonicalItem } from './Pcfx_Core.js';

const BLOCK_STARTS = new Set([
  'PIPE',
  'BEND',
  'ELBOW',
  'TEE',
  'OLET',
  'VALVE',
  'FLANGE',
  'REDUCER',
  'REDUCER-CONCENTRIC',
  'REDUCER-ECCENTRIC',
  'SUPPORT',
  'MESSAGE-SQUARE',
]);

const GEOMETRY_KEYS = new Set(['END-POINT', 'CO-ORDS', 'CENTRE-POINT', 'BRANCH1-POINT']);

function toText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isBlockStart(line) {
  const token = String(line || '').trim().split(/\s+/)[0].toUpperCase();
  return BLOCK_STARTS.has(token);
}

function parseFlatLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return { key: trimmed.toUpperCase(), value: '' };
  const key = trimmed.slice(0, firstSpace).toUpperCase();
  const value = trimmed.slice(firstSpace).trim();
  return { key, value };
}

function parsePointValue(value, includeBore) {
  const parts = String(value || '').trim().split(/\s+/).map(Number);
  if (parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return null;

  const point = {
    x: parts[0],
    y: parts[1],
    z: parts[2],
  };

  if (includeBore) {
    const bore = Number.isFinite(parts[3]) ? parts[3] : null;
    if (bore !== null) point.bore = bore;
  }
  return point;
}

function parseHeaderAttrs(text) {
  const lines = String(text || '').split(/\r?\n/);
  const headerLines = [];
  const attrs = {};

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (isBlockStart(trimmed)) break;
    headerLines.push(trimmed);
    const parsed = parseFlatLine(trimmed);
    if (parsed) attrs[parsed.key] = parsed.value;
  }

  return { lines: headerLines, attrs };
}

function buildHeaderMetadata(headerAttrs, defaults) {
  const resolved = defaults && typeof defaults === 'object' ? defaults : {};
  return {
    project: toText(resolved.metadataProject || ''),
    facility: toText(resolved.metadataFacility || ''),
    documentNo: toText(resolved.metadataDocumentNo || ''),
    revision: toText(resolved.metadataRevision || ''),
    code: toText(resolved.metadataCode || ''),
    pipelineRef: toText(headerAttrs['PIPELINE-REFERENCE'] || resolved.defaultPipelineRef || ''),
    pipingClass: toText(headerAttrs['PIPING-SPEC'] || resolved.defaultPipingClass || ''),
    units: {
      bore: toText(headerAttrs['UNITS-BORE'] || resolved.metadataUnitsBore || ''),
      coords: toText(headerAttrs['UNITS-CO-ORDS'] || resolved.metadataUnitsCoords || ''),
    },
  };
}

/**
 * Build the standard `.pcfx` producer block from converter defaults.
 * @param {object} defaults
 * @returns {object}
 */
export function buildPcfxProducer(defaults) {
  const resolved = defaults && typeof defaults === 'object' ? defaults : {};
  return {
    app: toText(resolved.producerApp || 'GLB Viewers'),
    version: toText(resolved.producerVersion || '1.0.0'),
  };
}

function buildGeneratedRef(index, defaults) {
  const resolved = defaults && typeof defaults === 'object' ? defaults : {};
  const prefix = toText(resolved.refPrefix || 'PCFX-');
  const seqStart = Number.isFinite(Number(resolved.seqStart)) ? Number(resolved.seqStart) : 10;
  const seqStep = Number.isFinite(Number(resolved.seqStep)) && Number(resolved.seqStep) !== 0 ? Number(resolved.seqStep) : 10;
  const value = seqStart + (index * seqStep);
  return `${prefix}${value}`;
}

function buildGeneratedSeq(index, defaults) {
  const resolved = defaults && typeof defaults === 'object' ? defaults : {};
  const seqStart = Number.isFinite(Number(resolved.seqStart)) ? Number(resolved.seqStart) : 10;
  const seqStep = Number.isFinite(Number(resolved.seqStep)) && Number(resolved.seqStep) !== 0 ? Number(resolved.seqStep) : 10;
  return String(seqStart + (index * seqStep));
}

function parseBlockAttributes(block) {
  const attrs = {};
  const lines = Array.isArray(block && block.lines) ? block.lines.slice(1) : [];

  lines.forEach((line) => {
    const parsed = parseFlatLine(line);
    if (!parsed || GEOMETRY_KEYS.has(parsed.key)) return;
    attrs[parsed.key] = parsed.value;
  });

  return attrs;
}

function canonicalItemFromBlock(block, index, headerAttrs, defaults) {
  const rawAttrs = parseBlockAttributes(block);
  const type = toText(block && block.type ? block.type : 'UNKNOWN').toUpperCase();
  const ep = [];
  let cp = null;
  let bp = null;
  let supportCoord = null;

  (Array.isArray(block && block.lines) ? block.lines.slice(1) : []).forEach((line) => {
    const parsed = parseFlatLine(line);
    if (!parsed) return;
    if (parsed.key === 'END-POINT') {
      const point = parsePointValue(parsed.value, true);
      if (point) ep.push(point);
    } else if (parsed.key === 'CO-ORDS') {
      supportCoord = parsePointValue(parsed.value, false);
    } else if (parsed.key === 'CENTRE-POINT') {
      cp = parsePointValue(parsed.value, false);
    } else if (parsed.key === 'BRANCH1-POINT') {
      bp = parsePointValue(parsed.value, true);
    }
  });

  const refNo = toText(rawAttrs['COMPONENT-IDENTIFIER'] || rawAttrs['COMPONENT-ATTRIBUTE97'] || buildGeneratedRef(index, defaults));
  const seqNo = toText(rawAttrs['COMPONENT-ATTRIBUTE98'] || buildGeneratedSeq(index, defaults));
  const support = {
    supportKind: toText(rawAttrs['SUPPORT-KIND'] || defaults.supportKind || ''),
    supportName: toText(rawAttrs['SUPPORT-NAME'] || defaults.supportName || ''),
    supportGuid: toText(rawAttrs['SUPPORT-GUID'] || ''),
    supportDesc: toText(rawAttrs['SUPPORT-DESC'] || defaults.supportDescription || ''),
    supportFriction: toFiniteNumber(rawAttrs['SUPPORT-FRICTION']),
    supportGap: toText(rawAttrs['SUPPORT-GAP'] || defaults.supportGap || ''),
  };

  const item = {
    id: refNo || `pcfx-item-${index + 1}`,
    type,
    refNo,
    seqNo,
    pipelineRef: toText(rawAttrs['PIPELINE-REFERENCE'] || headerAttrs['PIPELINE-REFERENCE'] || defaults.defaultPipelineRef || ''),
    lineNoKey: toText(rawAttrs['LINE-NO-KEY'] || rawAttrs['LINE-NUMBER'] || defaults.defaultLineNoKey || ''),
    ep1: ep[0] || null,
    ep2: ep[1] || null,
    cp,
    bp,
    supportCoord,
    bore: ep[0] && Number.isFinite(Number(ep[0].bore)) ? Number(ep[0].bore) : toFiniteNumber(rawAttrs.BORE),
    branchBore: bp && Number.isFinite(Number(bp.bore)) ? Number(bp.bore) : null,
    wall: toFiniteNumber(rawAttrs['WALL-THICKNESS'] || rawAttrs.WALL_THICK || rawAttrs.WALL),
    corr: toFiniteNumber(rawAttrs['CORROSION-ALLOWANCE'] || rawAttrs.CORR),
    material: toText(rawAttrs.MATERIAL || defaults.defaultMaterial || ''),
    pipingClass: toText(rawAttrs['PIPING-SPEC'] || headerAttrs['PIPING-SPEC'] || defaults.defaultPipingClass || ''),
    rating: toText(rawAttrs.RATING || defaults.defaultRating || ''),
    attrs: {
      CA97: refNo,
      CA98: seqNo,
      skey: toText(rawAttrs.SKEY || ''),
    },
    process: {},
    support,
    extras: {
      pcfAttributes: cloneJson(rawAttrs),
    },
    rawBySource: {
      pcfLines: cloneJson(block.lines || []),
    },
  };

  return normalizeCanonicalItem(item);
}

/**
 * Map a normalized PCF parse result to canonical items.
 * `options.parsed` and `options.text` are used to preserve geometry and headers.
 * @param {object} model
 * @param {object} options
 * @returns {object[]}
 */
export function canonicalItemsFromPcfModel(model, options) {
  const resolved = options && typeof options === 'object' ? options : {};
  const parsed = resolved.parsed;
  const text = toText(resolved.text || '');
  const defaults = resolved.defaults && typeof resolved.defaults === 'object' ? resolved.defaults : {};

  if (!model || !Array.isArray(model.components)) {
    throw new Error('A normalized PCF model is required for canonical conversion.');
  }
  if (!parsed || !Array.isArray(parsed.blocks)) {
    throw new Error('Parsed PCF blocks are required for canonical conversion.');
  }

  const headers = parseHeaderAttrs(text);
  return parsed.blocks.map((block, index) => canonicalItemFromBlock(block, index, headers.attrs, defaults));
}

/**
 * Create a `.pcfx` document directly from raw PCF text.
 * @param {string} text
 * @param {string} fileName
 * @param {object} defaults
 * @param {object} log
 * @returns {object}
 */
export function pcfxDocumentFromPcfText(text, fileName, defaults, log) {
  const parsed = parsePcfText(text, log);
  const model = normalizePcfModel(parsed, log);
  const items = canonicalItemsFromPcfModel(model, { parsed, text, defaults });
  const headers = parseHeaderAttrs(text);

  return createPcfxDocument({
    producer: buildPcfxProducer(defaults),
    metadata: buildHeaderMetadata(headers.attrs, defaults),
    items,
    sourceSnapshots: {
      sourceFile: toText(fileName || ''),
      pcfHeaderLines: cloneJson(headers.lines),
    },
    diagnostics: [],
  });
}

/**
 * Rebuild PCF-style attributes from one canonical item.
 * @param {object} item
 * @returns {object}
 */
export function buildPcfAttributesFromCanonicalItem(item) {
  const normalized = normalizeCanonicalItem(item);
  const attrs = cloneJson(normalized.extras && normalized.extras.pcfAttributes ? normalized.extras.pcfAttributes : {});

  if (!('COMPONENT-IDENTIFIER' in attrs) && normalized.refNo) attrs['COMPONENT-IDENTIFIER'] = normalized.refNo;
  if (normalized.pipelineRef && !('PIPELINE-REFERENCE' in attrs)) attrs['PIPELINE-REFERENCE'] = normalized.pipelineRef;
  if (normalized.pipingClass && !('PIPING-SPEC' in attrs)) attrs['PIPING-SPEC'] = normalized.pipingClass;
  if (normalized.material && !('MATERIAL' in attrs)) attrs.MATERIAL = normalized.material;
  if (normalized.rating && !('RATING' in attrs)) attrs.RATING = normalized.rating;
  if (normalized.attrs.skey && !('SKEY' in attrs)) attrs.SKEY = normalized.attrs.skey;

  attrs['COMPONENT-ATTRIBUTE97'] = normalized.attrs.CA97 || normalized.refNo || '';
  attrs['COMPONENT-ATTRIBUTE98'] = normalized.attrs.CA98 || normalized.seqNo || '';

  if (normalized.support.supportName && !('SUPPORT-NAME' in attrs)) attrs['SUPPORT-NAME'] = normalized.support.supportName;
  if (normalized.support.supportGuid && !('SUPPORT-GUID' in attrs)) attrs['SUPPORT-GUID'] = normalized.support.supportGuid;
  if (normalized.support.supportDesc && !('SUPPORT-DESC' in attrs)) attrs['SUPPORT-DESC'] = normalized.support.supportDesc;
  if (normalized.support.supportGap && !('SUPPORT-GAP' in attrs)) attrs['SUPPORT-GAP'] = normalized.support.supportGap;
  if (normalized.support.supportKind && !('SUPPORT-KIND' in attrs)) attrs['SUPPORT-KIND'] = normalized.support.supportKind;
  if (Number.isFinite(normalized.support.supportFriction) && !('SUPPORT-FRICTION' in attrs)) attrs['SUPPORT-FRICTION'] = normalized.support.supportFriction;

  return attrs;
}

function toSerializerComponent(item) {
  const normalized = normalizeCanonicalItem(item);
  const component = {
    type: normalized.type,
    points: [],
    attributes: buildPcfAttributesFromCanonicalItem(normalized),
  };

  if (normalized.ep1) component.points.push({ ...normalized.ep1, bore: Number.isFinite(normalized.ep1.bore) ? normalized.ep1.bore : normalized.bore || 0 });
  if (normalized.ep2) component.points.push({ ...normalized.ep2, bore: Number.isFinite(normalized.ep2.bore) ? normalized.ep2.bore : normalized.bore || 0 });
  if (normalized.cp) component.centrePoint = cloneJson(normalized.cp);
  if (normalized.bp) component.branch1Point = cloneJson(normalized.bp);
  if (normalized.supportCoord) component.coOrds = cloneJson(normalized.supportCoord);

  return component;
}

/**
 * Convert canonical items into PCF text.
 * `options.metadata` is used for header lines. `options.defaults` fills missing fields.
 * @param {object[]} items
 * @param {object} options
 * @returns {string}
 */
export function pcfTextFromCanonicalItems(items, options) {
  const resolved = options && typeof options === 'object' ? options : {};
  const metadata = resolved.metadata && typeof resolved.metadata === 'object' ? resolved.metadata : {};
  const defaults = resolved.defaults && typeof resolved.defaults === 'object' ? resolved.defaults : {};
  const components = Array.isArray(items) ? items.map((item) => toSerializerComponent(item)) : [];

  const headerLines = [];
  const pipelineRef = toText(metadata.pipelineRef || defaults.defaultPipelineRef || '');
  const pipingClass = toText(metadata.pipingClass || defaults.defaultPipingClass || '');
  const units = metadata.units && typeof metadata.units === 'object' ? metadata.units : {};
  const unitsBore = toText(units.bore || defaults.metadataUnitsBore || '');
  const unitsCoords = toText(units.coords || defaults.metadataUnitsCoords || '');

  if (pipelineRef) headerLines.push(`PIPELINE-REFERENCE ${pipelineRef}`);
  if (pipingClass) headerLines.push(`PIPING-SPEC ${pipingClass}`);
  if (unitsBore) headerLines.push(`UNITS-BORE ${unitsBore}`);
  if (unitsCoords) headerLines.push(`UNITS-CO-ORDS ${unitsCoords}`);

  const body = serializeToPCF(components);
  if (headerLines.length === 0) return body;
  if (!body) return `${headerLines.join('\n')}\n`;
  return `${headerLines.join('\n')}\n\n${body}`;
}
