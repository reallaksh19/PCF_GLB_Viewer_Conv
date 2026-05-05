import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RvmViewer3D } from './RvmViewer3D.js';

const PATCH_FLAG = Symbol.for('pcf-glb-rvm-support-symbols-patched');
const SUPPORT_SYMBOL_GROUP_NAME = '__RVM_SUPPORT_SYMBOLS__';
const SUPPORT_KIND_RX = /\b(GUIDE|LINE\s*STOP|LINESTOP|LIMIT\s*STOP|LIMIT|RESTING|REST|SHOE|BP|BASE\s*PLATE|ANCHOR|FIXED|STOPPER|STOP)\b/i;
const SUPPORT_TAG_RX = /\bPS[-_\s]?[A-Z0-9][A-Z0-9._/\-]*\b/i;

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
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

function supportSearchText(obj, attrs) {
  return [
    obj?.name,
    obj?.userData?.name,
    obj?.userData?.type,
    obj?.userData?.kind,
    obj?.userData?.canonicalObjectId,
    attrs.TYPE,
    attrs.STYP,
    attrs.DTXR,
    attrs.CMPSUPTYPE,
    attrs.CMPSUPREFN,
    attrs.NAME,
    attrs.TAG,
    attrs.TAGNO,
    attrs.SKEY,
    attrs.SPRE,
    attrs.DESCRIPTION,
    attrs.DESC,
    attrs.CONNECTIONTYPE,
  ].map(asText).join(' ');
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
  const values = [obj?.name, obj?.userData?.name, obj?.userData?.canonicalObjectId, attrs.NAME, attrs.TAG, attrs.TAGNO, attrs.CMPSUPREFN, attrs.REF, attrs.REFNO, attrs.DBREF, attrs.SKEY, attrs.SPRE, attrs.DESCRIPTION, attrs.DESC];
  for (const value of values) {
    const m = SUPPORT_TAG_RX.exec(asText(value));
    if (m) return m[0].replace(/\s+/g, '-');
  }
  return asText(attrs.NAME || obj?.name || 'SUPPORT').trim();
}

function isSupportObject(obj, attrs) {
  const text = supportSearchText(obj, attrs);
  const typeText = String(attrs.TYPE || obj?.userData?.type || obj?.userData?.kind || '').toUpperCase();
  return typeText === 'SUPPORT' || typeText === 'ATTA' || typeText === 'ANCI' || /\bSUPPORT\b|\bATTA\b|\bANCI\b/i.test(text) || SUPPORT_KIND_RX.test(text);
}

function getPosition(obj, attrs) {
  for (const key of ['POS', 'POSITION', 'COORDS', 'CO_ORDS', 'CO_ORD', 'BPOS', 'BP', 'APOS', 'LPOS']) {
    const p = normalizeCoord(attrs[key]);
    if (p) return p;
  }
  const box = new THREE.Box3().setFromObject(obj);
  if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
  return null;
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

function resolvePipeAxis(attrs) {
  const explicit = axisFromName(attrs.PIPE_AXIS || attrs.ROUTE_AXIS || attrs.AXIS || attrs.DIRECTION || attrs.DIR);
  if (explicit) return explicit.normalize();
  const apos = normalizeCoord(attrs.APOS);
  const lpos = normalizeCoord(attrs.LPOS);
  const derived = dominantAxisFromPoints(apos, lpos);
  return (derived || new THREE.Vector3(1, 0, 0)).normalize();
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
  const shaftCenter = start.clone().add(dir.clone().multiplyScalar(shaftLen * 0.5));
  shaft.position.copy(shaftCenter);
  orientAlongY(shaft, dir);
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 3.0, headLen, 16), mat);
  const headCenter = start.clone().add(dir.clone().multiplyScalar(shaftLen + headLen * 0.5));
  head.position.copy(headCenter);
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

function addLabel(group, text, at, size) {
  const div = document.createElement('div');
  div.className = 'rvm-support-symbol-label';
  div.textContent = text;
  div.style.cssText = 'font:600 11px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:10px;background:rgba(8,16,28,.82);color:#e8f3ff;border:1px solid rgba(128,190,255,.45);white-space:nowrap;';
  const label = new CSS2DObject(div);
  label.position.copy(at.clone().add(new THREE.Vector3(0, size * 0.55, 0)));
  group.add(label);
}

function buildSymbol(kind, position, attrs, obj, scale) {
  const vertical = new THREE.Vector3(0, 1, 0);
  const pipeAxis = resolvePipeAxis(attrs);
  const lateral = chooseLateralAxis(pipeAxis, vertical);
  const base = position.clone().add(vertical.clone().multiplyScalar(-scale * 1.2));
  const target = position.clone().add(vertical.clone().multiplyScalar(-scale * 0.15));
  const group = new THREE.Group();
  group.name = `SUPPORT_SYMBOL_${supportTag(obj, attrs) || kind}`;
  group.userData = {
    supportSymbol: true,
    supportKind: kind,
    supportTag: supportTag(obj, attrs),
    attributes: { ...attrs },
  };
  const radius = Math.max(scale * 0.035, 1);
  const label = `${supportTag(obj, attrs) || 'SUPPORT'} ${kind}`.trim();

  if (kind === 'REST') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0x2f80ed));
    group.add(makeArrow(base.clone().add(vertical.clone().multiplyScalar(-scale * 0.55)), target, 0x2f80ed, radius));
  } else if (kind === 'GUIDE') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0x30c48d));
    const left = base.clone().add(lateral.clone().multiplyScalar(-scale * 0.95));
    const right = base.clone().add(lateral.clone().multiplyScalar(scale * 0.95));
    group.add(makeArrow(left, base.clone().add(lateral.clone().multiplyScalar(-scale * 0.16)), 0x30c48d, radius));
    group.add(makeArrow(right, base.clone().add(lateral.clone().multiplyScalar(scale * 0.16)), 0x30c48d, radius));
  } else if (kind === 'LINESTOP' || kind === 'LIMIT') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, kind === 'LIMIT' ? 0xffb020 : 0xff6b35));
    const color = kind === 'LIMIT' ? 0xffb020 : 0xff6b35;
    const a = base.clone().add(pipeAxis.clone().multiplyScalar(-scale * 1.05));
    const b = base.clone().add(pipeAxis.clone().multiplyScalar(scale * 1.05));
    group.add(makeArrow(a, base.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.18)), color, radius));
    group.add(makeArrow(b, base.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.18)), color, radius));
  } else if (kind === 'ANCHOR') {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0xd94cff));
    group.add(makeArrow(base.clone().add(vertical.clone().multiplyScalar(-scale * 0.55)), target, 0xd94cff, radius));
    group.add(makeArrow(base.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.95)), base, 0xd94cff, radius));
    group.add(makeArrow(base.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.95)), base, 0xd94cff, radius));
  } else {
    group.add(makePlate(base, lateral, pipeAxis, vertical, scale, 0x8ea6c8));
  }
  addLabel(group, label, base, scale);
  return group;
}

function dedupeKey(obj, attrs, pos) {
  const tag = supportTag(obj, attrs);
  if (tag) return `tag:${tag.toUpperCase()}`;
  const id = obj?.userData?.canonicalObjectId || obj?.userData?.sourceObjectId || obj?.name;
  if (id) return `id:${id}`;
  return `pos:${pos.x.toFixed(1)}:${pos.y.toFixed(1)}:${pos.z.toFixed(1)}`;
}

export function addRvmSupportSymbols(viewer, options = {}) {
  if (!viewer?.modelGroup) return { created: 0, scanned: 0 };
  const existing = viewer.modelGroup.getObjectByName(SUPPORT_SYMBOL_GROUP_NAME);
  if (existing) viewer.modelGroup.remove(existing);
  const symbolRoot = new THREE.Group();
  symbolRoot.name = SUPPORT_SYMBOL_GROUP_NAME;
  const modelBox = new THREE.Box3().setFromObject(viewer.modelGroup);
  const diag = modelBox.isEmpty() ? 1000 : Math.max(modelBox.getSize(new THREE.Vector3()).length(), 1);
  const scale = Math.max(25, Math.min(650, diag * 0.0075));
  const seen = new Set();
  let scanned = 0;
  viewer.modelGroup.traverse((obj) => {
    if (!obj || obj === symbolRoot || obj.userData?.supportSymbol) return;
    const attrs = getAttrs(obj);
    if (!isSupportObject(obj, attrs)) return;
    const kind = normalizeSupportKind(supportSearchText(obj, attrs)) || 'SUPPORT';
    const pos = getPosition(obj, attrs);
    if (!pos) return;
    const key = dedupeKey(obj, attrs, pos);
    if (seen.has(key)) return;
    seen.add(key);
    scanned += 1;
    symbolRoot.add(buildSymbol(kind, pos, attrs, obj, scale));
  });
  if (symbolRoot.children.length > 0) viewer.modelGroup.add(symbolRoot);
  return { created: symbolRoot.children.length, scanned };
}

export function installRvmSupportSymbolPatch() {
  if (RvmViewer3D.prototype[PATCH_FLAG]) return;
  const originalSetModel = RvmViewer3D.prototype.setModel;
  RvmViewer3D.prototype.setModel = function patchedSetModel(model, upAxis = 'Y') {
    originalSetModel.call(this, model, upAxis);
    this.supportSymbolDiagnostics = addRvmSupportSymbols(this, { upAxis });
  };
  RvmViewer3D.prototype[PATCH_FLAG] = true;
}

installRvmSupportSymbolPatch();
