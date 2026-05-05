/* Fitting-preserving StagedJSON -> PSI116 XML converter. */
const BORES = ['HBOR', 'TBOR', 'ABORE', 'LBORE', 'DTXR', 'BORE', 'NBORE'];
const TYPE_MAP = [
  [/WELDOLET|SOCKOLET|THREDOLET|SWEEPOLET|\bOLET\b/i, 'OLET'],
  [/\bVALV(E)?\b/i, 'VALV'],
  [/\bFLAN(GE)?\b/i, 'FLAN'],
  [/\bGASK(ET)?\b/i, 'GASK'],
  [/\b(ELBO(W)?|BEND)\b/i, 'ELBO'],
  [/\bTEE\b/i, 'TEE'],
  [/\bREDU(CER)?\b/i, 'REDU'],
  [/\b(ATTA|SUPP|SUPPORT)\b/i, 'ATTA'],
  [/\b(PIPE|TUBI)\b/i, 'PIPE'],
];
const ENDPOINT_TYPES = new Set(['PIPE', 'VALV', 'FLAN', 'GASK', 'REDU', 'TEE', 'OLET', 'ELBO', 'ATTA']);

const text = (v) => (v === undefined || v === null ? '' : String(v));
const esc = (v) => text(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const mm = (v) => {
  const m = text(v).replace(/mm/gi, ' ').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const fmt = (v, d = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return (n.toFixed(d).replace(/\.?0+$/, '') || '0');
};
const basename = (name) => (text(name).trim() || 'STAGED_JSON').replace(/\.[^.]+$/, '');

function attrs(item) {
  return {
    ...(item?.attributes && typeof item.attributes === 'object' ? item.attributes : {}),
    ...(item?.attr && typeof item.attr === 'object' ? item.attr : {}),
    ...(item?.attrs && typeof item.attrs === 'object' ? item.attrs : {}),
  };
}
function first(obj, keys) {
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null && text(obj[k]).trim() !== '') return obj[k];
  return '';
}
function directionalPoint(s) {
  const t = text(s).trim().split(/\s+/g).filter(Boolean);
  if (t.length < 2) return null;
  const p = { x: 0, y: 0, z: 0 };
  let ok = false;
  for (let i = 0; i < t.length - 1; i += 2) {
    const a = t[i].toUpperCase(); const v = mm(t[i + 1]);
    if (!Number.isFinite(v)) continue;
    if (a === 'E') { p.x = v; ok = true; } else if (a === 'W') { p.x = -v; ok = true; }
    else if (a === 'N') { p.y = v; ok = true; } else if (a === 'S') { p.y = -v; ok = true; }
    else if (a === 'U') { p.z = v; ok = true; } else if (a === 'D') { p.z = -v; ok = true; }
  }
  return ok ? p : null;
}
function point(v) {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v) && v.length >= 3) {
    const p = { x: Number(v[0]), y: Number(v[1]), z: Number(v[2]) };
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null;
  }
  if (typeof v === 'object') {
    const p = { x: Number(v.x ?? v.X), y: Number(v.y ?? v.Y), z: Number(v.z ?? v.Z) };
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null;
  }
  const dir = directionalPoint(v); if (dir) return dir;
  const vals = text(v).match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  return vals.length >= 3 ? { x: vals[0], y: vals[1], z: vals[2] } : null;
}
function dist(a, b) {
  const p = point(a), q = point(b); if (!p || !q) return 0;
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
}
function pickPoint(item, a, keys) {
  for (const k of keys) { const p = point(a[k] ?? item?.[k]); if (p) return p; }
  return null;
}
function points(item) {
  const a = attrs(item);
  return {
    apos: pickPoint(item, a, ['APOS', 'A_POS', 'EP1', 'END1', 'START', 'START_POINT', 'POS_START', 'POSSTART']),
    lpos: pickPoint(item, a, ['LPOS', 'L_POS', 'EP2', 'END2', 'END', 'END_POINT', 'POS_END', 'POSEND']),
    pos: pickPoint(item, a, ['POS', 'POSITION', 'COORDS', 'CO_ORDS', 'CO_ORD', 'POSS']),
    cpos: pickPoint(item, a, ['CPOS', 'CP', 'CENTER', 'CENTRE', 'CENTER_POINT', 'CENTRE_POINT']),
    bpos: pickPoint(item, a, ['BPOS', 'BP', 'BRANCH_POINT', 'BRANCH1_POINT', 'BPOS1', 'TEE_POINT']),
  };
}
function componentType(item) {
  const a = attrs(item);
  const source = [item?.type, item?.kind, item?.name, a.TYPE, a.STYP, a.SPRE, a.PTYPE, a.GTYPE, a.CATL, a.DETAIL]
    .map(text).join(' ');
  for (const [rx, type] of TYPE_MAP) if (rx.test(source)) return type;
  return 'UNKNOWN';
}
function bore(a, fallback) {
  for (const k of BORES) { const v = mm(a[k]); if (Number.isFinite(v) && v > 0) return v; }
  return fallback;
}
function bendRadius(item, ps) {
  const a = attrs(item);
  const explicit = mm(first(a, ['BENDRADIUS', 'BEND_RADIUS', 'BRAD', 'RADI', 'RADIUS']));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const c = ps.cpos || ps.pos;
  if (c && ps.apos && ps.lpos) return Math.min(dist(c, ps.apos), dist(c, ps.lpos));
  return 0;
}
function xmlNode(item, type, endpoint, position, ctx, extra = {}) {
  const a = attrs(item);
  return {
    nodeNumber: extra.nodeNumber ?? -1,
    nodeName: extra.nodeName ?? text(first(a, ['NAME', 'TAG', 'TAGNO', 'ITEMCODE', 'PARTNO']) || item?.name || ''),
    endpoint,
    rigid: extra.rigid ?? null,
    componentType: type,
    weight: num(a.WEIG ?? a.WEIGHT, 0),
    componentRefNo: text(first(a, ['REF', 'REFNO', 'COMPONENTREFNO', 'DBREF', 'CA97', 'CA98']) || item?.ref || item?.id || ctx.ref),
    connectionType: text(first(a, ['CONNECTIONTYPE', 'CONN', 'CONNECTION', 'CREF', 'CTYP'])),
    outsideDiameter: bore(a, ctx.defaultDiameter),
    wallThickness: Math.max(0, num(mm(a.WTHK ?? a.WALLTHK ?? a.WALL_THICKNESS), ctx.defaultWallThickness)),
    corrosionAllowance: Math.max(0, num(mm(a.CORA ?? a.CORROSIONALLOWANCE), ctx.defaultCorrosionAllowance)),
    insulationThickness: Math.max(0, num(mm(a.INSU ?? a.INSULATIONTHICKNESS), ctx.defaultInsulationThickness)),
    position,
    bendRadius: extra.bendRadius ?? 0,
    bendType: extra.bendType ?? null,
    sif: num(a.SIF, 0),
  };
}
function expand(item, ctx) {
  const type = componentType(item); if (!ENDPOINT_TYPES.has(type)) return [];
  const ps = points(item); const base = ps.pos || ps.cpos || ps.apos || ps.lpos || ps.bpos;
  if (!base) return [];
  const out = []; const push = (ep, p, extra = {}) => { if (p) out.push(xmlNode(item, type, ep, p, ctx, extra)); };
  if (type === 'ELBO') {
    const r = bendRadius(item, ps);
    push(1, ps.apos || base, { bendRadius: r, bendType: 0 });
    push(0, ps.cpos || ps.pos || base, { nodeNumber: ctx.nextNode(), nodeName: '', bendRadius: r, bendType: 1 });
    push(2, ps.lpos || base, { bendRadius: r, bendType: 0 });
  } else if (type === 'OLET') {
    const header = ps.pos || ps.cpos || ps.apos || base;
    push(1, ps.apos || header); push(3, ps.bpos || ps.lpos || header);
    push(0, header, { nodeNumber: ctx.nextNode(), nodeName: '' }); push(2, ps.lpos || header);
  } else if (type === 'TEE') {
    const center = ps.pos || ps.cpos || base;
    push(1, ps.apos || center); push(3, ps.bpos || center);
    push(0, center, { nodeNumber: ctx.nextNode(), nodeName: '' }); push(2, ps.lpos || center);
  } else if (type === 'ATTA') {
    push(0, base, { nodeNumber: ctx.nextNode() });
  } else if (ps.apos && ps.lpos) {
    push(1, ps.apos); push(2, ps.lpos);
  } else push(0, base, { nodeNumber: ctx.nextNode() });
  return out;
}
function nodeBlock(lines, n) {
  lines.push('      <Node>');
  lines.push(`        <NodeNumber>${n.nodeNumber}</NodeNumber>`);
  lines.push(`        <NodeName>${esc(n.nodeName)}</NodeName>`);
  lines.push(`        <Endpoint>${n.endpoint}</Endpoint>`);
  if (n.rigid !== null && n.rigid !== undefined) lines.push(`        <Rigid>${n.rigid}</Rigid>`);
  lines.push(`        <ComponentType>${esc(n.componentType)}</ComponentType>`);
  lines.push(`        <Weight>${fmt(n.weight, 3)}</Weight>`);
  lines.push(`        <ComponentRefNo>${esc(n.componentRefNo)}</ComponentRefNo>`);
  lines.push(`        <ConnectionType>${esc(n.connectionType)}</ConnectionType>`);
  lines.push(`        <OutsideDiameter>${fmt(n.outsideDiameter, 3)}</OutsideDiameter>`);
  lines.push(`        <WallThickness>${fmt(n.wallThickness, 3)}</WallThickness>`);
  lines.push(`        <CorrosionAllowance>${fmt(n.corrosionAllowance, 3)}</CorrosionAllowance>`);
  lines.push(`        <InsulationThickness>${fmt(n.insulationThickness, 3)}</InsulationThickness>`);
  lines.push(`        <Position>${fmt(n.position.x, 2)} ${fmt(n.position.y, 2)} ${fmt(n.position.z, 2)}</Position>`);
  lines.push(`        <BendRadius>${fmt(n.bendRadius ?? 0, 3)}</BendRadius>`);
  if (n.bendType !== undefined && n.bendType !== null && n.bendType !== '') lines.push(`        <BendType>${n.bendType}</BendType>`);
  lines.push(`        <SIF>${n.sif ?? 0}</SIF>`);
  lines.push('      </Node>');
}
function branchesOf(h) {
  const input = Array.isArray(h) ? h : [h]; const branches = [];
  for (const e of input) {
    if (!e || typeof e !== 'object') continue;
    if (Array.isArray(e.children)) branches.push(e);
    else if (Array.isArray(e.items)) branches.push({ ...e, children: e.items });
    else if (Array.isArray(e.branches)) branches.push(...e.branches);
  }
  return branches;
}
export function buildPsiXmlFromStagedJsonHierarchy(hierarchy, inputName = 'STAGED_JSON.json', options = {}) {
  const branches = branchesOf(hierarchy); if (!branches.length) throw new Error('Staged JSON has no branch children.');
  const project = basename(inputName); let nodeNo = Math.max(1, Math.trunc(num(options.nodeStart, 10)));
  const step = Math.max(1, Math.trunc(num(options.nodeStep, 10))); let ref = 1; let nodeCount = 0; let skipped = 0;
  const ctxBase = {
    defaultDiameter: Math.max(0.001, num(options.defaultDiameter, 100)),
    defaultWallThickness: Math.max(0, num(options.defaultWallThickness, 0.01)),
    defaultCorrosionAllowance: Math.max(0, num(options.defaultCorrosionAllowance, 0)),
    defaultInsulationThickness: Math.max(0, num(options.defaultInsulationThickness, 0)),
    nextNode: () => { const n = nodeNo; nodeNo += step; return n; },
  };
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<PipeStressExport xmlns="http://aveva.com/pipeStress116.xsd">'];
  lines.push(`  <DateTime>${esc(new Date().toISOString())}</DateTime>`, `  <Source>${esc(options.source || 'AVEVA PSI')}</Source>`, '  <Version>0.0.0.0</Version>', '  <UserName>browser-runtime</UserName>');
  lines.push(`  <Purpose>${esc(options.purpose || 'RMSS staged JSON conversion')}</Purpose>`, `  <ProjectName>${esc(project)}</ProjectName>`, `  <MDBName>/${esc(project)}</MDBName>`, `  <TitleLine>${esc(options.titleLine || 'RMSS StagedJSON Output')}</TitleLine>`);
  lines.push('  <!-- Configuration information -->', '  <RestrainOpenEnds>No</RestrainOpenEnds>', '  <AmbientTemperature>0</AmbientTemperature>', '  <Pipe>', `    <FullName>/${esc(project)}</FullName>`, '    <Ref></Ref>');
  for (const br of branches) {
    const ba = attrs(br); lines.push('    <Branch>', `      <Branchname>${esc(br.name || br.path || br.fullName || ba.NAME || 'B1')}</Branchname>`);
    lines.push('      <Temperature><Temperature1>-100000</Temperature1><Temperature2>-100000</Temperature2><Temperature3>-100000</Temperature3><Temperature4>-100000</Temperature4><Temperature5>-100000</Temperature5><Temperature6>-100000</Temperature6><Temperature7>-100000</Temperature7><Temperature8>-100000</Temperature8><Temperature9>-100000</Temperature9></Temperature>');
    lines.push('      <Pressure><Pressure1>0</Pressure1><Pressure2>0</Pressure2><Pressure3>0</Pressure3><Pressure4>0</Pressure4><Pressure5>0</Pressure5><Pressure6>0</Pressure6><Pressure7>0</Pressure7><Pressure8>0</Pressure8><Pressure9>0</Pressure9></Pressure>', '      <MaterialNumber>0</MaterialNumber>', '      <InsulationDensity>0</InsulationDensity>', '      <FluidDensity>0</FluidDensity>');
    for (const child of br.children || []) {
      const nodes = expand(child, { ...ctxBase, ref: `AUTO-${ref++}` });
      if (!nodes.length) { skipped += 1; continue; }
      for (const n of nodes) { nodeBlock(lines, n); nodeCount += 1; }
    }
    lines.push('    </Branch>');
  }
  lines.push('  </Pipe>', `  <!-- StagedJSON fitting-preserving converter generated ${nodeCount} Node records; skipped ${skipped} non-positioned/non-piping items. -->`, '</PipeStressExport>');
  return lines.join('\n');
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/xml;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
function installPanel() {
  if (typeof document === 'undefined') return;
  const root = document.querySelector('#tab-content'); if (!root || root.querySelector('[data-sjxml-preserve-panel]')) return;
  if (!/Model Converter|StagedJSON\s*->\s*XML/i.test(root.textContent || '')) return;
  const panel = document.createElement('section'); panel.className = 'model-converters-card'; panel.dataset.sjxmlPreservePanel = '1'; panel.style.marginTop = '12px';
  panel.innerHTML = '<h3>StagedJSON -> XML (preserve fittings)</h3><p class="muted">Preserves VALV, FLAN, GASK, ELBO/BEND, OLET, TEE and ATTA using the existing PSI116 Node XML structure.</p><label class="model-converters-label"><span>Staged JSON</span><input type="file" accept=".json,.JSON" data-sjxml-file></label><div class="model-converters-actions"><button class="btn-primary" type="button" data-sjxml-run>Convert preserving fittings</button></div><pre data-sjxml-status style="white-space:pre-wrap;max-height:160px;overflow:auto;"></pre>';
  root.appendChild(panel); const status = panel.querySelector('[data-sjxml-status]');
  panel.querySelector('[data-sjxml-run]').addEventListener('click', async () => {
    try {
      const file = panel.querySelector('[data-sjxml-file]').files[0]; if (!file) throw new Error('Select a staged JSON file first.');
      const xml = buildPsiXmlFromStagedJsonHierarchy(JSON.parse(await file.text()), file.name, {});
      const counts = ['VALV', 'FLAN', 'GASK', 'ELBO', 'OLET', 'TEE', 'ATTA'].map((t) => `${t}: ${(xml.match(new RegExp(`<ComponentType>${t}</ComponentType>`, 'g')) || []).length}`).join(' | ');
      status.textContent = `Conversion complete. ${counts}`; download(`${basename(file.name)}.xml`, xml);
    } catch (e) { status.textContent = `Conversion failed: ${e?.message || e}`; }
  });
}
export function installStagedJsonFittingPreserver() {
  if (typeof document === 'undefined') return;
  installPanel(); new MutationObserver(installPanel).observe(document.body, { childList: true, subtree: true });
}
if (typeof window !== 'undefined') {
  window.PCF_STAGEDJSON_XML_FITTING_PRESERVER = { buildPsiXmlFromStagedJsonHierarchy, installStagedJsonFittingPreserver };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installStagedJsonFittingPreserver, { once: true });
  else installStagedJsonFittingPreserver();
}
