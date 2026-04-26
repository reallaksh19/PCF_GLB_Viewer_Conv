const DEFAULT_PCF_MAPPING = {
  'T1': 'COMPONENT-ATTRIBUTE2',
  'T2': '',
  'T3': '',
  'T4': '',
  'T5': '',
  'T6': '',
  'T7': '',
  'T8': '',
  'T9': '',
  'P1': 'COMPONENT-ATTRIBUTE1',
  'P2': '',
  'P3': '',
  'P4': '',
  'P5': '',
  'P6': '',
  'P7': '',
  'P8': '',
  'P9': '',
  'PHYDRO': 'COMPONENT-ATTRIBUTE10',
  'MATERIAL': 'COMPONENT-ATTRIBUTE3',
  'WALLTHK': 'COMPONENT-ATTRIBUTE4',
  'INSULTHK': 'COMPONENT-ATTRIBUTE5',
  'INSULDENS': 'COMPONENT-ATTRIBUTE6',
  'CORRALLW': 'COMPONENT-ATTRIBUTE7',
  'WEIGHT': 'COMPONENT-ATTRIBUTE8',
  'FLUIDDENS': 'COMPONENT-ATTRIBUTE9',
  'LINENUM': 'PIPELINE-REFERENCE',
  'CLADTHK': '',
  'CLADDENS': '',
  'REFRTHK': '',
  'REFRDENS': ''
};

export function getPcfMapping() {
  const saved = localStorage.getItem('pcfMapping');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return { ...DEFAULT_PCF_MAPPING };
}

export function savePcfMapping(mapping) {
  localStorage.setItem('pcfMapping', JSON.stringify(mapping));
}

export function getCaesarMatchAttribute() {
  return localStorage.getItem('caesarMatchAttribute') || 'lineNo';
}

export function saveCaesarMatchAttribute(attr) {
  localStorage.setItem('caesarMatchAttribute', attr);
}

// ─── Support Kind Map ─────────────────────────────────────────────────────────
// Maps SKEY values (PCF support catalog codes) → kind: REST | GUIDE | ANCHOR | SPRING
// Used as Tier 1.5 in _resolveSupportKind (after explicit SUPPORT-KIND, before direction heuristic)

const DEFAULT_SUPPORT_KIND_MAP = {
  'CA150': 'REST',
  'CA100': 'GUIDE',
};

export function getSupportKindMap() {
  const saved = localStorage.getItem('supportKindMap');
  if (saved) {
    try { return JSON.parse(saved); } catch {}
  }
  return { ...DEFAULT_SUPPORT_KIND_MAP };
}

export function saveSupportKindMap(map) {
  localStorage.setItem('supportKindMap', JSON.stringify(map));
}
