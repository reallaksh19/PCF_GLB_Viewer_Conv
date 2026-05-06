import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RvmViewer3D } from './RvmViewer3D.js';

const PATCH_FLAG = Symbol.for('pcf-glb-rvm-support-symbols-patched');
const SUPPORT_SYMBOL_GROUP_NAME = '__RVM_SUPPORT_SYMBOLS__';
const SUPPORT_KIND_RX = /\b(GUIDE|LINE\s*STOP|LINESTOP|LIMIT\s*STOP|LIMIT|RESTING|REST|SHOE|BP|BASE\s*PLATE|ANCHOR|FIXED|STOPPER|STOP)\b/i;
const SUPPORT_TAG_RX = /\bPS[-_\s]?[A-Z0-9][A-Z0-9._/\-]*\b/i;
const DEFAULTS = Object.freeze({
  labelsVisible: false,
  symbolScaleFactor: 0.0035,
  minScale: 8,
  maxScale: 120,
  belowPipeFactor: 0.72,
});

function asText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
function asNumber(value) {
  const n = Number.parseFloat(String(value ?? '').replace(/mm/gi, '').trim());
  return Number.isFinite(n) ? n : null;
}
function normalizeCoord(value) {
  if (!value && value !== 0) return null;
  if (Array.isArray(value) && value.length >= 3) {
    const x = asNumber(value[0]); const y = asNumber(value[1]); const z = asNumber(value[2]);
    return x === null || y === null || z === null ? null : new THREE.Vector3(x, y, z);
  }
  if (typeof value === 'object') {
    const x = asNumber(value.x ?? value.X); const y = asNumber(value.y ?? value.Y); const z = asNumber(value.z ?? value.Z);
    return x === null || y === null || z === null ? null : new THREE.Vector3(x, y, z);
  }
  const text = String(value || '').trim();
  if (!text) return null;
  const tokens = text.split(/\s+/g);
  const directional = new THREE.Vector3(0, 0, 0);
  let parsedDir = false;
  for (let i = 0; i < tokens.length - 1; i += 2) {
    const axis = tokens[i].toUpperCase();
    const n = asNumber(tokens[i + 1]);
    if (n === null) continue;
    if (axis === 'E') { directional.x = n; parsedDir = true; }
    else if (axis === 'W') { directional.x = -n; parsedDir = true; }
    else if (axis === 'N') { directional.y = n; parsedDir = true; }
    else if (axis === 'S') { directional.y = -n; parsedDir = true; }
    else if (axis === 'U') { directional.z = n; parsedDir = true; }
    else if (axis === 'D') { directional.z = -n; parsedDir = true; }
  }
  if (parsedDir) return directional;
  const vals = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  return vals.length >= 3 ? new THREE.Vector3(vals[0], vals[1], vals[2]) : null;
}
function getAttrs(obj) {
  const out = {};
  const stack = [obj?.userData, obj?.userData?.attributes, obj?.userData?.rawAttributes, obj?.userData?.sourceAttributes, obj?.attributes];
  for (const src of stack) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) if (v !== undefined && v !== null && out[k] === undefined) out[k] = v;
  }
  return out;
}
function supportSearchText(obj, attrs) {
  return [obj?.name, obj?.userData?.name, obj?.userData?.type, obj?.userData?.kind, obj?.userData?.canonicalObjectId, attrs.TYPE, attrs.STYP, attrs.DTXR, attrs.SUPPORT_TYPE, attrs.CMPSUPTYPE, attrs.CMPSUPREFN, attrs.SUPPORT_TAG, attrs.NAME, attrs.TAG, attrs.TAGNO, attrs.SKEY, attrs.SPRE, attrs.DESCRIPTION, attrs.DESC, attrs.CONNECTIONTYPE].map(asText).join(' ');
}
function normalizeSupportKind(text) {
  const s = String(text || '').toUpperCase();
  if (/\bGUIDE\b/.test(s)) return 'GUIDE';
  if (/\bLINE\s*STOP\b|\bLINESTOP\b|\bSTOPPER\b/.test(s)) return 'LINESTOP';
  if (/\bLIMIT\s*STOP\b|\bLIMIT\b/.test(s)) return 'LIMIT';
  if (/\bRESTING\b|\bREST\b|\bSHOE\b|\bBP\b|\bBASE\s*PLATE\b/.test(s)) return 'REST';
  if (/\bANCHOR\b|\bFIXED\b/.test(s)) return 'ANCHOR';
  if (/\bSTOP\b/.test(s)) return 'LINESTOP';
  return '';
}
function supportTag(obj, attrs) {
  const values = [attrs.SUPPORT_TAG, attrs.CMPSUPREFN, attrs.NAME, attrs.TAG, attrs.TAGNO, attrs.REF, attrs.REFNO, attrs.DBREF, attrs.SKEY, attrs.SPRE, attrs.DESCRIPTION, attrs.DESC, obj?.userData?.name, obj?.userData?.canonicalObjectId, obj?.name];
  for (const value of values) {
    const m = SUPPORT_TAG_RX.exec(asText(value));
    if (m) return m[0].replace(/\s+/g, '-');
  }
  const fallback = asText(attrs.CMPSUPREFN || attrs.SUPPORT_TAG || attrs.NAME || obj?.userData?.name || obj?.name || 'SUPPORT').trim();
  return fallback.replace(/^.*\/SUPPORT\s*/i, '').slice(0, 48);
}
function isSupportObject(obj, attrs) {
  const text = supportSearchText(obj, attrs);
  const typeText = String(attrs.TYPE || obj?.userData?.type || obj?.userData?.kind || '').toUpperCase();
  if (typeText === 'PIPE' || typeText === 'BRANCH') return false;
  return typeText === 'SUPPORT' || typeText === 'ATTA' || typeText === 'ANCI' || /\bSUPPORT\b|\bATTA\b|\bANCI\b/i.test(text) || SUPPORT_KIND_RX.test(text);
}
function rawPosition(attrs) {
  for (const key of ['SUPPORTCOORD', 'SUPPORT_COORD', 'SCOORD', 'POS', 'POSITION', 'COORDS', 'CO_ORDS', 'CO_ORD', 'BPOS', 'BP', 'APOS', 'LPOS']) {
    const p = normalizeCoord(attrs[key]);
    if (p) return p;
  }
  return null;
}
function hasRenderableGeometry(obj) {
  let count = 0;
  obj.traverse((child) => { if (child.isMesh && !child.userData?.supportSymbol) count += 1; });
  return count > 0;
}
function getSymbolPosition(obj, attrs, viewer) {
  if (hasRenderableGeometry(obj)) {
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
  }
  const p = rawPosition(attrs);
  if (!p) return null;
  return viewer?.modelGroup ? viewer.modelGroup.localToWorld(p.clone()) : p;
}
function axisFromName(value) {
  const s = String(value || '').trim().toUpperCase();
  if (['X', '+X', '-X'].includes(s)) return new THREE.Vector3(1, 0, 0);
  if (['Y', '+Y', '-Y'].includes(s)) return new THREE.Vector3(0, 1, 0);
  if (['Z', '+Z', '-Z'].includes(s)) return new THREE.Vector3(0, 0, 1);
  return null;
}
function dominantAxisFromPoints(a, b) {
  if (!a || !b) return null;
  const d = new THREE.Vector3().subVectors(b, a);
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az && ax > 1e-9) return new THREE.Vector3(Math.sign(d.x) || 1, 0, 0);
  if (ay >= ax && ay >= az && ay > 1e-9) return new THREE.Vector3(0, Math.sign(d.y) || 1, 0);
  if (az > 1e-9) return new THREE.Vector3(0, 0, Math.sign(d.z) || 1);
  return null;
}
function resolvePipeAxis(attrs, viewer) {
  const explicit = axisFromName(attrs.PIPE_AXIS || attrs.ROUTE_AXIS || attrs.AXIS || attrs.DIRECTION || attrs.DIR);
  if (explicit) return explicit.normalize();
  const apos = rawPosition({ POS: attrs.APOS });
  const lpos = rawPosition({ POS: attrs.LPOS });
  const derived = dominantAxisFromPoints(apos, lpos) || new THREE.Vector3(1, 0, 0);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(viewer?.modelGroup?.matrixWorld || new THREE.Matrix4());
  return derived.applyMatrix3(normalMatrix).normalize();
}
function chooseLateralAxis(pipeAxis, verticalAxis) {
  const cross = new THREE.Vector3().crossVectors(pipeAxis, verticalAxis);
  if (cross.lengthSq() > 1e-8) return cross.normalize();
  return new THREE.Vector3(0, 0, 1);
}
function createMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: true });
}
function orientAlongY(mesh, direction) {
  const dir = direction.clone().normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}
function makeArrow(start, end, color, radius) {
  const group = new THREE.Group();
  const v = new THREE.Vector3().subVectors(end, start);
  const len = v.length();
  if (len <= 1e-6) return group;
  const dir = v.clone().normalize();
  const shaftLen = len * 0.72;
  const headLen = len * 0.28;
  const mat = createMaterial(color);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, shaftLen, 12), mat);
  shaft.position.copy(start.clone().add(dir.clone().multiplyScalar(shaftLen * 0.5)));
  orientAlongY(shaft, dir);
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 3.0, headLen, 16), mat);
  head.position.copy(start.clone().add(dir.clone().multiplyScalar(shaftLen + headLen * 0.5)));
  orientAlongY(head, dir);
  group.add(shaft, head);
  return group;
}
function makePlate(center, lateral, pipeAxis, vertical, size, color) {
  const geo = new THREE.BoxGeometry(size * 1.15, size * 0.14, size * 0.65);
  const mesh = new THREE.Mesh(geo, createMaterial(color, 0.92));
  mesh.position.copy(center.clone().add(vertical.clone().multiplyScalar(-size * 0.12)));
  const basis = new THREE.Matrix4().makeBasis(pipeAxis.clone().normalize(), vertical.clone().normalize(), lateral.clone().normalize());
  mesh.quaternion.setFromRotationMatrix(basis);
  return mesh;
}
function addLabel(group, text, at, size, visible) {
  if (typeof document === 'undefined') return;
  const div = document.createElement('div');
  div.className = 'rvm-support-symbol-label';
  div.textContent = text;
  div.style.cssText = `font:600 10px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:10px;background:rgba(8,16,28,.82);color:#e8f3ff;border:1px solid rgba(128,190,255,.45);white-space:nowrap;display:${visible ? 'block' : 'none'};`;
  const label = new CSS2DObject(div);
  label.name = `${group.name}_LABEL`;
  label.userData.supportSymbolLabel = true;
  label.position.copy(at.clone().add(new THREE.Vector3(0, size * 0.45, 0)));
  group.add(label);
}
function buildSymbol(kind, position, attrs, obj, scale, viewer, opts) {
  const vertical = new THREE.Vector3(0, 1, 0);
  const pipeAxis = resolvePipeAxis(attrs, viewer);
  const lateral = chooseLateralAxis(pipeAxis, vertical);
  const offset = Math.max(scale * opts.belowPipeFactor, 1);
  const base = position.clone().add(vertical.clone().multiplyScalar(-offset));
  const target = position.clone().add(vertical.clone().multiplyScalar(-Math.max(scale * 0.08, 0.5)));
  const group = new THREE.Group();
  const tag = supportTag(obj, attrs);
  group.name = `SUPPORT_SYMBOL_${tag || kind}`;
  group.userData = { supportSymbol: true, supportKind: kind, supportTag: tag, attributes: { ...attrs } };
  const radius = Math.max(scale * 0.025, 0.35);
  const label = `${tag || 'SUPPORT'} ${kind}`.trim();
  if (kind === 'REST') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0x2f80ed));
    group.add(makeArrow(base.clone().add(vertical.clone().multiplyScalar(-scale * 0.45)), target, 0x2f80ed, radius));
  } else if (kind === 'GUIDE') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0x30c48d));
    group.add(makeArrow(base.clone().add(lateral.clone().multiplyScalar(-scale * 0.78)), base.clone().add(lateral.clone().multiplyScalar(-scale * 0.14)), 0x30c48d, radius));
    group.add(makeArrow(base.clone().add(lateral.clone().multiplyScalar(scale * 0.78)), base.clone().add(lateral.clone().multiplyScalar(scale * 0.14)), 0x30c48d, radius));
  } else if (kind === 'LINESTOP' || kind === 'LIMIT') {
    const color = kind === 'LIMIT' ? 0xffb020 : 0xff6b35;
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, color));
    group.add(makeArrow(base.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.82)), base.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.14)), color, radius));
    group.add(makeArrow(base.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.82)), base.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.14)), color, radius));
  } else if (kind === 'ANCHOR') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0xd94cff));
    group.add(makeArrow(base.clone().add(vertical.clone().multiplyScalar(-scale * 0.45)), target, 0xd94cff, radius));
    group.add(makeArrow(base.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.78)), base, 0xd94cff, radius));
    group.add(makeArrow(base.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.78)), base, 0xd94cff, radius));
  } else {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0x8ea6c8));
  }
  addLabel(group, label, base, scale, opts.labelsVisible);
  return group;
}
function dedupeKey(obj, attrs, pos) {
  const id = obj?.userData?.canonicalObjectId || obj?.userData?.sourceObjectId || obj?.uuid;
  const tag = supportTag(obj, attrs);
  return `${tag || id || 'support'}:${pos.x.toFixed(1)}:${pos.y.toFixed(1)}:${pos.z.toFixed(1)}`.toUpperCase();
}
function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m?.dispose?.());
    }
    if (obj.element?.parentNode) obj.element.parentNode.removeChild(obj.element);
  });
}
export function setRvmSupportSymbolLabelsVisible(viewer, visible) {
  const root = viewer?.scene?.getObjectByName(SUPPORT_SYMBOL_GROUP_NAME);
  if (!root) return;
  root.traverse((obj) => {
    if (obj.userData?.supportSymbolLabel && obj.element) obj.element.style.display = visible ? 'block' : 'none';
  });
}
export function addRvmSupportSymbols(viewer, options = {}) {
  if (!viewer?.modelGroup || !viewer?.scene) return { created: 0, scanned: 0 };
  const opts = { ...DEFAULTS, ...options };
  const existing = viewer.scene.getObjectByName(SUPPORT_SYMBOL_GROUP_NAME);
  if (existing) { viewer.scene.remove(existing); disposeObject(existing); }
  const symbolRoot = new THREE.Group();
  symbolRoot.name = SUPPORT_SYMBOL_GROUP_NAME;
  symbolRoot.userData.supportSymbolRoot = true;
  const modelBox = new THREE.Box3().setFromObject(viewer.modelGroup);
  const size = modelBox.isEmpty() ? new THREE.Vector3(1000, 1000, 1000) : modelBox.getSize(new THREE.Vector3());
  const diag = Math.max(size.length(), 1);
  const scale = Math.max(opts.minScale, Math.min(opts.maxScale, diag * opts.symbolScaleFactor));
  const seen = new Set();
  let scanned = 0;
  viewer.modelGroup.updateMatrixWorld(true);
  viewer.modelGroup.traverse((obj) => {
    if (!obj || obj.userData?.supportSymbol) return;
    const attrs = getAttrs(obj);
    if (!isSupportObject(obj, attrs)) return;
    const kind = normalizeSupportKind(supportSearchText(obj, attrs));
    if (!kind) return;
    const pos = getSymbolPosition(obj, attrs, viewer);
    if (!pos) return;
    const key = dedupeKey(obj, attrs, pos);
    if (seen.has(key)) return;
    seen.add(key);
    scanned += 1;
    symbolRoot.add(buildSymbol(kind, pos, attrs, obj, scale, viewer, opts));
  });
  if (symbolRoot.children.length > 0) viewer.scene.add(symbolRoot);
  return { created: symbolRoot.children.length, scanned, labelsVisible: opts.labelsVisible };
}
export function installRvmSupportSymbolPatch() {
  if (RvmViewer3D.prototype[PATCH_FLAG]) return;
  const originalSetModel = RvmViewer3D.prototype.setModel;
  RvmViewer3D.prototype.setModel = function patchedSetModel(model, upAxis = 'Y') {
    originalSetModel.call(this, model, upAxis);
    this.supportSymbolDiagnostics = addRvmSupportSymbols(this, { upAxis, labelsVisible: false });
  };
  RvmViewer3D.prototype.setSupportSymbolLabelsVisible = function setSupportSymbolLabelsVisible(visible) {
    setRvmSupportSymbolLabelsVisible(this, visible);
  };
  RvmViewer3D.prototype[PATCH_FLAG] = true;
}
installRvmSupportSymbolPatch();
