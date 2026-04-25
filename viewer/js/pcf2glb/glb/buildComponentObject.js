import * as THREE from 'three';
import { buildPipeMesh } from './buildPipeMesh.js';
import { getSupportKindMap } from '../../../core/settings.js';

export function buildReducerMesh(comp) {
  // Simplified reducer proxy
  if (!comp.ep1 || !comp.ep2) throw new Error(`Invalid reducer geometry for ${comp.id}`);

  const p1 = new THREE.Vector3(comp.ep1.x, comp.ep1.y, comp.ep1.z);
  const p2 = new THREE.Vector3(comp.ep2.x, comp.ep2.y, comp.ep2.z);
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const length = dir.length();

  const r1 = Math.max((comp.ep1.bore || 10) / 2, 0.5);
  const r2 = Math.max((comp.ep2.bore || 10) / 2, 0.5);

  const geom = new THREE.CylinderGeometry(r2, r1, length, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5555aa });
  const mesh = new THREE.Mesh(geom, mat);

  const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  mesh.position.copy(mid);

  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );

  const rattrs = comp.attributes || {};
  mesh.name = comp.id;
  mesh.userData = {
    pcfType: comp.type,
    pcfId: comp.id,
    bore: comp.bore || null,
    refNo: comp.refNo || rattrs['COMPONENT-ATTRIBUTE97'] || '',
    ...rattrs,
  };
  return mesh;
}

export function buildGenericProxy(comp, color=0xcc5555) {
  // Simplified generic box proxy at ep1 or coOrds
  const ptSrc = comp.ep1 || comp.coOrds;
  const pt = ptSrc ? new THREE.Vector3(ptSrc.x, ptSrc.y, ptSrc.z) : new THREE.Vector3();
  const radius = Math.max((comp.bore || 20) / 2, 5);

  const geom = new THREE.BoxGeometry(radius * 3, radius * 3, radius * 3);
  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);

  mesh.position.copy(pt);
  mesh.name = comp.id;
  const gattrs = comp.attributes || {};
  mesh.userData = {
    pcfType: comp.type,
    pcfId: comp.id,
    bore: comp.bore || null,
    refNo: comp.refNo || gattrs['COMPONENT-ATTRIBUTE97'] || '',
    ...gattrs,
  };
  return mesh;
}

// ─── Support Kind System ──────────────────────────────────────────────────────
//
// Tier 1: Explicit SUPPORT-KIND attribute  → 'REST' | 'GUIDE' | 'ANCHOR' | 'SPRING'
// Tier 2: SUPPORT-DIRECTION keyword        → direction text → _DIR_TO_KIND
// Tier 3: Heuristic on name/tag text       → keyword scan
// Default: 'REST'
//
// Colours:  REST=green  GUIDE=blue  ANCHOR=red  SPRING=orange

// Direction-to-kind map: DOWN/UP → REST (vertical), lateral directions → GUIDE
const _DIR_TO_KIND = {
  DOWN: 'REST', UP: 'REST',
  NORTH: 'GUIDE', SOUTH: 'GUIDE', EAST: 'GUIDE', WEST: 'GUIDE',
  NORTHEAST: 'GUIDE', NORTHWEST: 'GUIDE', SOUTHEAST: 'GUIDE', SOUTHWEST: 'GUIDE',
};

// Per-kind hex colours
const _KIND_COLOR = {
  REST:   0x22c55e,   // green
  GUIDE:  0x3b82f6,   // blue
  ANCHOR: 0xef4444,   // red
  SPRING: 0xf97316,   // orange
};

/** Collect all text fields from support attributes into one uppercase string */
function _supportTextFromAttributes(attrs) {
  const src = attrs && typeof attrs === 'object' ? attrs : {};
  return [
    src.SUPPORT_TAG,
    src['SUPPORT-TAG'],
    src.SUPPORT_DIRECTION,
    src['SUPPORT-DIRECTION'],
    src.SKEY,
    src.SUPPORT_NAME,
    src['SUPPORT-NAME'],
    src['<SUPPORT_NAME>'],
    src['COMPONENT-IDENTIFIER'],
    src['COMPONENT-ATTRIBUTE1'],
    src['COMPONENT-ATTRIBUTE2'],
  ].map(v => String(v || '').toUpperCase()).join(' ');
}

/** Extract a cardinal/ordinal direction keyword from any text blob */
function _supportDirectionFromText(text = '') {
  const t = String(text || '').toUpperCase();
  if (/\bNORTHEAST\b|\bNORTH-EAST\b|\bNE\b/.test(t)) return 'NORTHEAST';
  if (/\bNORTHWEST\b|\bNORTH-WEST\b|\bNW\b/.test(t)) return 'NORTHWEST';
  if (/\bSOUTHEAST\b|\bSOUTH-EAST\b|\bSE\b/.test(t)) return 'SOUTHEAST';
  if (/\bSOUTHWEST\b|\bSOUTH-WEST\b|\bSW\b/.test(t)) return 'SOUTHWEST';
  if (/\bUP\b/.test(t))    return 'UP';
  if (/\bDOWN\b/.test(t))  return 'DOWN';
  if (/\bNORTH\b/.test(t)) return 'NORTH';
  if (/\bSOUTH\b/.test(t)) return 'SOUTH';
  if (/\bEAST\b/.test(t))  return 'EAST';
  if (/\bWEST\b/.test(t))  return 'WEST';
  return '';
}

function _axisFromSupportDirection(direction) {
  const d = String(direction || '').toUpperCase();
  if (d === 'UP')        return new THREE.Vector3(0, 1, 0);
  if (d === 'DOWN')      return new THREE.Vector3(0, -1, 0);
  if (d === 'NORTH')     return new THREE.Vector3(0, 0, -1);
  if (d === 'SOUTH')     return new THREE.Vector3(0, 0, 1);
  if (d === 'EAST')      return new THREE.Vector3(1, 0, 0);
  if (d === 'WEST')      return new THREE.Vector3(-1, 0, 0);
  if (d === 'NORTHEAST') return new THREE.Vector3(1, 0, -1).normalize();
  if (d === 'NORTHWEST') return new THREE.Vector3(-1, 0, -1).normalize();
  if (d === 'SOUTHEAST') return new THREE.Vector3(1, 0, 1).normalize();
  if (d === 'SOUTHWEST') return new THREE.Vector3(-1, 0, 1).normalize();
  return null;
}

function _axisFromCosinesText(text = '') {
  const parts = String(text || '').split(/[,\s]+/).map(Number).filter(Number.isFinite);
  if (parts.length < 3) return null;
  const axis = new THREE.Vector3(parts[0], parts[1], parts[2]);
  return axis.length() < 0.01 ? null : axis.normalize();
}

function _orientObjectFromY(object, direction) {
  if (!object || !direction || direction.length() < 0.01) return;
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
}

/**
 * Resolve support kind via 3-tier fallback.
 * Tier 1: explicit SUPPORT-KIND / SUPPORT_KIND attribute
 * Tier 2: SUPPORT-DIRECTION mapped via _DIR_TO_KIND
 * Tier 3: keyword heuristic on name/tag text
 * Default: 'REST'
 *
 * @param {object} attrs - merged comp.raw + comp.attributes
 * @returns {'REST'|'GUIDE'|'ANCHOR'|'SPRING'}
 */
const _VALID_KINDS = new Set(['REST', 'GUIDE', 'ANCHOR', 'SPRING']);

function _resolveSupportKind(attrs) {
  // ── Tier 1: explicit SUPPORT-KIND / SUPPORT_KIND attribute ─────────
  const explicitKind = (attrs['SUPPORT-KIND'] || attrs['SUPPORT_KIND'] || '').toUpperCase().trim();
  if (_VALID_KINDS.has(explicitKind)) return explicitKind;

  // ── Tier 1.5: SKEY lookup in user-configured kind map ──────────────
  // Settings → Config Tab → "Support Kind Map"
  // e.g. { CA150: 'REST', CA100: 'GUIDE', VA200: 'ANCHOR' }
  const skey = (attrs['SKEY'] || attrs['SUPPORT-SKEY'] || '').toUpperCase().trim();
  if (skey) {
    const kindMap = getSupportKindMap();
    const mapped  = kindMap[skey]?.toUpperCase();
    if (mapped && _VALID_KINDS.has(mapped)) return mapped;
  }

  // ── Tier 2: SUPPORT-DIRECTION keyword ─────────────────────────────
  const supportText = _supportTextFromAttributes(attrs);
  const direction   = _supportDirectionFromText(supportText);
  const dirKind     = _DIR_TO_KIND[direction] || null;
  if (dirKind) return dirKind;

  // ── Tier 3: heuristic on name / tag text ──────────────────────────
  const sName = (
    attrs['<SUPPORT_NAME>'] || attrs['SUPPORT_NAME'] || attrs['SUPPORT-NAME'] || supportText
  ).toUpperCase();

  if (sName.includes('ANCHOR') || sName.includes('ANC') || sName.includes('FIX')) return 'ANCHOR';
  if (sName.includes('SPRING') || sName.includes('SPR'))                           return 'SPRING';
  if (sName.includes('GUIDE')  || sName.includes('GUID') || /\bGD\b/.test(sName)) return 'GUIDE';

  // ── Default ────────────────────────────────────────────────────────
  return 'REST';
}

/** Make one arrow cone mesh pointing along +Y (caller rotates it) */
function _makeArrow(radius, color) {
  const h = radius * 3;
  const geo = new THREE.CylinderGeometry(0, radius, h, 16);
  const mat = new THREE.MeshStandardMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

/** Add an arrow along `axis` at offset `dist` from group centre */
function _addArrow(group, axis, dist, radius, color) {
  const arrow = _makeArrow(radius, color);
  arrow.position.copy(axis).multiplyScalar(dist);
  _orientObjectFromY(arrow, axis);
  group.add(arrow);
  return arrow;
}

export function buildSupportProxy(comp) {
  // Position: prefer CO-ORDS (support placement point), fall back to ep1
  const ptSrc = comp.coOrds || comp.ep1;
  const pt    = ptSrc ? new THREE.Vector3(ptSrc.x, ptSrc.y, ptSrc.z) : new THREE.Vector3();
  const radius = Math.max((comp.bore || 20) / 2, 5);
  const group = new THREE.Group();
  group.position.copy(pt);

  // Merge raw + normalized attributes (raw first so normalized wins on conflict)
  const attrs = { ...(comp.raw || {}), ...(comp.attributes || {}) };

  // ── Resolve kind via unified 3-tier logic ─────────────────────────
  const kind  = _resolveSupportKind(attrs);
  const color = _KIND_COLOR[kind] ?? _KIND_COLOR.REST;

  // ── Axis for arrow orientation ────────────────────────────────────
  const supportText = _supportTextFromAttributes(attrs);
  const direction   = _supportDirectionFromText(supportText);
  const supportAxis =
    _axisFromCosinesText(attrs.AXIS_COSINES || attrs['AXIS-COSINES'] || '') ||
    _axisFromSupportDirection(direction);

  const arrowDist = radius + (radius * 3) / 2;   // half-height offset

  if (kind === 'REST') {
    // ── REST: single arrow pointing from below (↓ toward pipe) ──────
    const axis = supportAxis || new THREE.Vector3(0, 1, 0);
    _addArrow(group, axis, -arrowDist, radius, color);

  } else if (kind === 'GUIDE') {
    // ── GUIDE: vertical + 2 lateral arrows (↑ + ← →) ───────────────
    const vertAxis = new THREE.Vector3(0, 1, 0);
    _addArrow(group, vertAxis, -arrowDist, radius, color);

    const latAxis = (supportAxis && Math.abs(supportAxis.y) < 0.95)
      ? supportAxis.clone().normalize()
      : new THREE.Vector3(1, 0, 0);
    _addArrow(group, latAxis,               -arrowDist, radius, color);
    _addArrow(group, latAxis.clone().negate(), -arrowDist, radius, color);

  } else if (kind === 'ANCHOR') {
    // ── ANCHOR: 6 arrows pointing inward along ±X ±Y ±Z (all-fixed) ─
    const axes = [
      new THREE.Vector3( 1,  0,  0),
      new THREE.Vector3(-1,  0,  0),
      new THREE.Vector3( 0,  1,  0),
      new THREE.Vector3( 0, -1,  0),
      new THREE.Vector3( 0,  0,  1),
      new THREE.Vector3( 0,  0, -1),
    ];
    axes.forEach(axis => _addArrow(group, axis, -arrowDist, radius, color));

  } else if (kind === 'SPRING') {
    // ── SPRING: helix coil below the pipe ────────────────────────────
    const coilTurns   = 4;
    const coilHeight  = radius * 6;
    const coilRadius  = radius * 0.7;
    const segments    = 64;
    const points      = [];
    for (let i = 0; i <= segments; i++) {
      const t     = i / segments;
      const angle = t * Math.PI * 2 * coilTurns;
      points.push(new THREE.Vector3(
        Math.cos(angle) * coilRadius,
        -arrowDist - coilHeight * t,
        Math.sin(angle) * coilRadius,
      ));
    }
    const coilGeo = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      segments,
      radius * 0.12,
      8,
    );
    const coilMat  = new THREE.MeshStandardMaterial({ color });
    group.add(new THREE.Mesh(coilGeo, coilMat));
  }

  // ── Metadata ──────────────────────────────────────────────────────
  group.name = comp.id;
  const userData = {
    pcfType: comp.type,
    pcfId:   comp.id,
    bore:    comp.bore || null,
    refNo:   comp.refNo || attrs['COMPONENT-ATTRIBUTE97'] || '',
    supportKind: kind,
    ...attrs,
  };
  group.userData = userData;
  // Propagate to children so raycasting returns full metadata
  group.children.forEach(child => { child.userData = userData; });

  return group;
}

export function buildComponentObject(comp, log) {
  switch (comp.type) {
    case 'PIPE':
      return buildPipeMesh(comp);
    case 'REDUCER':
    case 'REDUCER-CONCENTRIC':
    case 'REDUCER-ECCENTRIC':
      return buildReducerMesh(comp);
    case 'BEND':
    case 'ELBOW':
      return buildGenericProxy(comp, 0xaa55aa);
    case 'TEE':
    case 'OLET':
      return buildGenericProxy(comp, 0x55aa55);
    case 'VALVE':
      return buildGenericProxy(comp, 0xcc2222);
    case 'FLANGE':
      return buildGenericProxy(comp, 0x888888);
    case 'SUPPORT':
      return buildSupportProxy(comp);
    // Fittings / hardware — rendered as colour-coded generic proxies
    case 'CAP':
      return buildGenericProxy(comp, 0x777777);
    case 'COUPLING':
    case 'UNION':
      return buildGenericProxy(comp, 0x999966);
    case 'CROSS':
      return buildGenericProxy(comp, 0x44aa88);
    case 'GASKET':
    case 'BOLT':
    case 'WELD':
      return buildGenericProxy(comp, 0xaaaaaa);
    case 'STRAINER':
    case 'FILTER':
      return buildGenericProxy(comp, 0x33aacc);
    case 'BLIND-FLANGE':
      return buildGenericProxy(comp, 0x666688);
    case 'TRAP':
      return buildGenericProxy(comp, 0xcc8833);
    case 'INSTRUMENT':
      return buildGenericProxy(comp, 0xddaa00);
    // Annotation-only types — no geometry needed in GLB export
    case 'MESSAGE-SQUARE':
    case 'MESSAGE-CIRCLE':
      return null;
    default:
      if (log) log.warn('UNSUPPORTED_COMPONENT_TYPE', { id: comp.id, type: comp.type });
      return null;
  }
}
