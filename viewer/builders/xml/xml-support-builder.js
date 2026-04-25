import { CanonicalSupport } from '../../canonical/CanonicalSupport.js';
import { FidelityClass } from '../../canonical/FidelityClass.js';

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function supportDirectionFromAxis(axisCosines) {
  if (!axisCosines) return '';
  const x = num(axisCosines.x); const y = num(axisCosines.y); const z = num(axisCosines.z);
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ay >= ax && ay >= az) return y >= 0 ? 'UP' : 'DOWN';
  if (az >= ax && az >= ay) return z >= 0 ? 'SOUTH' : 'NORTH';
  return x >= 0 ? 'EAST' : 'WEST';
}

export function supportKindFromRestraint(rawText = '') {
  const t = String(rawText || '').toUpperCase();
  if (/ANC(HOR)?|FIX(ED)?|RIGID/.test(t)) return 'ANCHOR';
  if (/GUIDE|GDE|SLIDE/.test(t)) return 'GUIDE';
  if (/SPRING|HANGER/.test(t)) return 'SPRING';
  if (/REST|RST|STOP/.test(t)) return 'REST';
  if (/CA100/.test(t)) return 'GUIDE';
  if (/CA150|CA250/.test(t)) return 'REST';
  return 'REST';
}

export function buildXmlSupports({ assemblyId, xmlRestraints = [], nodeIndex = new Map() }) {
  return xmlRestraints
    .filter((r) => Number.isFinite(Number(r?.node)) && nodeIndex.has(String(r.node)))
    .map((r, idx) => {
      const nodeId = nodeIndex.get(String(r.node));
      const rawName = String(r.supportBlock || r.rawType || r.type || '').trim();
      return new CanonicalSupport({
        id: `SUP-${assemblyId}-${idx + 1}`,
        assemblyId,
        hostRefType: 'NODE',
        hostRef: nodeId,
        hostRefConfidence: 1,
        rawAttributes: { ...r },
        derivedAttributes: {
          supportKind: supportKindFromRestraint(rawName),
          supportDirection: supportDirectionFromAxis(r.axisCosines),
        },
        normalized: {
          supportFamily: rawName.startsWith('CA') ? 'CA' : 'GENERIC',
          supportCode: rawName,
          supportKind: supportKindFromRestraint(rawName),
          supportDirection: supportDirectionFromAxis(r.axisCosines),
          supportDofs: Array.isArray(r.dofs) ? [...r.dofs] : [],
        },
        directionSource: r.supportDirection ? 'RAW' : 'DERIVED',
        classificationSource: rawName ? 'MAPPED' : 'HEURISTIC',
        sourceRefs: [{ format: 'XML', sourceId: `RESTRAINT:${r.node}` }],
        fidelity: FidelityClass.RECONSTRUCTED,
        exportHints: {
          pcf: { preferRaw: true, fallbackToDerived: true },
          pcfx: { includeRaw: true, includeDerived: true, includeNormalized: true },
          glb: { includeRaw: true, includeNormalized: true },
        },
      });
    });
}
