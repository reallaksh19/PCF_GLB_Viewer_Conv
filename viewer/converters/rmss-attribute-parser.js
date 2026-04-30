/**
 * Parses PDMS/AVEVA RMSS_ATTRIBUTE.TXT files.
 * Segregates items as children based on OWNER (Parent) and includes specific attributes.
 */

function parseCoord(str) {
  if (!str) return null;
  const res = { x: 0, y: 0, z: 0 };
  const parts = str.trim().split(' ');
  for (let i = 0; i < parts.length; i += 2) {
    const axis = parts[i];
    if (i + 1 >= parts.length) break;
    let valStr = parts[i+1];
    let val = parseFloat(valStr.replace('mm', ''));
    if (axis === 'E') res.x = val;
    else if (axis === 'W') res.x = -val;
    else if (axis === 'N') res.y = val;
    else if (axis === 'S') res.y = -val;
    else if (axis === 'U') res.z = val;
    else if (axis === 'D') res.z = -val;
  }
  return res;
}

function parseRmssAttributes(content) {
  const lines = content.split('\n');
  let currentObj = null;
  const allObjects = [];

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('NEW ')) {
      if (currentObj) allObjects.push(currentObj);
      currentObj = { id: t.substring(4).trim(), attributes: {} };
    } else if (t === 'END') {
      if (currentObj) {
        allObjects.push(currentObj);
        currentObj = null;
      }
    } else if (currentObj && t.includes(':=')) {
      const idx = t.indexOf(':=');
      const key = t.substring(0, idx).trim().replace(/^:/, ''); // remove leading colon
      const val = t.substring(idx + 2).trim();
      currentObj.attributes[key] = val;
    }
  }
  if (currentObj) allObjects.push(currentObj);

  const branches = allObjects.filter(o => o.attributes.TYPE === 'BRAN');
  const relevantComponents = allObjects.filter(o =>
    ['VALV', 'FLAN', 'ELBO', 'TEE', 'OLET', 'GASK', 'ATTA'].includes(o.attributes.TYPE)
  );

  const branchMap = new Map();
  for (const b of branches) {
    const name = b.attributes.NAME || b.id;
    if (!name) continue;

    branchMap.set(name, {
      name: name,
      type: 'BRANCH',
      bore: b.attributes.HBOR || b.attributes.TBOR || 'Unknown',
      children: []
    });
  }

  for (const comp of relevantComponents) {
    const owner = comp.attributes.OWNER;
    if (owner && branchMap.has(owner)) {

      const t = comp.attributes.TYPE;
      let node = {
        name: comp.attributes.NAME || comp.id,
        type: t,
        attributes: {}
      };

      const apos = parseCoord(comp.attributes.APOS);
      const lpos = parseCoord(comp.attributes.LPOS);

      if (t === 'VALV') {
        node.attributes = { APOS: apos, LPOS: lpos };
      } else if (t === 'FLAN') {
        node.attributes = { DTXR: comp.attributes.DTXR, APOS: apos, LPOS: lpos };
      } else if (t === 'ELBO' || t === 'TEE' || t === 'OLET') {
        node.attributes = { ANGL: comp.attributes.ANGL, DTXR: comp.attributes.DTXR, APOS: apos, LPOS: lpos };
      } else if (t === 'GASK') {
        node.attributes = { DTXR: comp.attributes.DTXR, APOS: apos, LPOS: lpos };
      } else if (t === 'ATTA') {
        if (comp.attributes.CMPSUPTYPE) {
          node.type = 'SUPPORT';
          node.attributes = {
            NAME: comp.attributes.NAME,
            CMPSUPREFN: comp.attributes.CMPSUPREFN,
            CMPSUPTYPE: comp.attributes.CMPSUPTYPE,
            APOS: apos,
            LPOS: lpos
          };
        } else {
          continue; // Skip non-support ATTAs
        }
      }

      branchMap.get(owner).children.push(node);
    }
  }

  // Filter out branches that have no relevant children
  const finalBranches = Array.from(branchMap.values()).filter(b => b.children.length > 0);

  // Sort components within branches to ensure sequential traversal for drawing pipes
  for (const b of finalBranches) {
    if (b.children.length < 2) continue;

    const sorted = [];
    const pool = new Set(b.children);

    // Pick a starting point (e.g. the one with fewest other components near its APOS)
    // For simplicity, we just pick the first component in the original list
    let current = b.children[0];
    sorted.push(current);
    pool.delete(current);

    const getDist = (p1, p2) => {
        if (!p1 || !p2) return Infinity;
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
    };

    while (pool.size > 0) {
        let bestNext = null;
        let minTargetDist = Infinity;

        const currentLpos = current.attributes.LPOS || current.attributes.APOS;

        for (const candidate of pool) {
            const candidateApos = candidate.attributes.APOS;
            if (!candidateApos) continue;
            const dist = getDist(currentLpos, candidateApos);
            if (dist < minTargetDist) {
                minTargetDist = dist;
                bestNext = candidate;
            }
        }

        if (!bestNext) {
            // Broken chain, just grab any remaining
            bestNext = Array.from(pool)[0];
        }

        sorted.push(bestNext);
        pool.delete(bestNext);
        current = bestNext;
    }
    b.children = sorted;
  }

  return finalBranches;
}

// Ensure we export it properly for both ES modules and CommonJS
export { parseRmssAttributes };

// Simple CLI usage (only if run natively in node without ES module system)
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: node rmss-attribute-parser.js <path_to_RMSS_ATTRIBUTE.TXT>");
    process.exit(1);
  }
  const fileContent = fs.readFileSync(args[0], 'utf-8');
  const result = parseRmssAttributes(fileContent);
  console.log(JSON.stringify(result, null, 2));
}
