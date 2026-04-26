import assert from 'assert/strict';
import { RvmIdentityMap } from '../../../rvm/RvmIdentityMap.js';
import { RvmMetadataIndex } from '../../../rvm/RvmMetadataIndex.js';
import { RvmSearchIndex } from '../../../rvm/RvmSearchIndex.js';
import { RvmTreeModel } from '../../../rvm/RvmTreeModel.js';

// Setup Mock DOM
global.document = {
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            textContent: '',
            innerHTML: '',
            children: [],
            classList: {
                add: (cls) => {
                    if (el.className) el.className += ' ' + cls;
                    else el.className = cls;
                }
            },
            appendChild: (child) => {
                el.children.push(child);
            },
            addEventListener: (evt, cb) => {
                if (!el._listeners) el._listeners = {};
                if (!el._listeners[evt]) el._listeners[evt] = [];
                el._listeners[evt].push(cb);
            },
            click: () => {
                if (el._listeners && el._listeners['click']) {
                    el._listeners['click'].forEach(cb => cb({ stopPropagation: () => {} }));
                }
            },
            querySelectorAll: (sel) => {
                const results = [];
                function traverse(node) {
                    if (sel.startsWith('.')) {
                        const cls = sel.substring(1);
                        if (node.className && node.className.includes(cls)) {
                            results.push(node);
                        }
                    }
                    if (node.children) {
                        node.children.forEach(traverse);
                    }
                }
                traverse(el);
                return results;
            }
        };
        return el;
    }
};


const mockIndex = {
  schemaVersion: 'rvm-index/v1',
  nodes: [
    {
      sourceObjectId: 'RVM:100',
      canonicalObjectId: 'RVM:100',
      renderObjectIds: ['mesh_0', 'mesh_1'],
      parentCanonicalObjectId: null,
      name: 'PIPE-A',
      path: '/AREA1/PIPE-A',
      kind: 'pipe',
      attributes: { NPD: '6in', ZONE: 'Area1' },
    },
    {
      sourceObjectId: 'RVM:200',
      canonicalObjectId: 'RVM:200',
      renderObjectIds: ['mesh_2'],
      parentCanonicalObjectId: 'RVM:100',
      name: 'ELBOW-01',
      path: '/AREA1/PIPE-A/ELBOW-01',
      kind: 'fitting',
      attributes: { SPEC: 'A106' },
    },
    {
      sourceObjectId: 'RVM:300',
      canonicalObjectId: 'RVM:300',
      renderObjectIds: ['mesh_3'],
      parentCanonicalObjectId: 'RVM:100',
      name: 'FLANGE-01',
      path: '/AREA1/PIPE-A/FLANGE-01',
      kind: 'fitting',
      attributes: { TYPE: 'WeldNeck' },
    }
  ]
};

function test(name, fn) {
  try {
    const res = fn();
    if (res instanceof Promise) {
        return res.then(() => {
             console.log(`  ✅ ${name}`);
        }).catch(e => {
             console.error(`  ❌ ${name}\n     ${e.stack}`);
             process.exit(1);
        })
    } else {
        console.log(`  ✅ ${name}`);
    }
  } catch (e) {
    console.error(`  ❌ ${name}\n     ${e.stack}`);
    process.exit(1);
  }
}

async function runTests() {
  const identityMap = RvmIdentityMap.fromNodes(mockIndex.nodes);
  const metadataIndex = new RvmMetadataIndex(mockIndex, identityMap);
  const searchIndex = new RvmSearchIndex(metadataIndex);
  await searchIndex.build();

  // ✅ build index from 3-node RvmIndex → 3 entries
  test('build index from 3-node RvmIndex → 3 entries', () => {
    assert.equal(searchIndex.entries.length, 3);
  });

  // ✅ query "pipe" matches nodes whose attributes contain "pipe" (case-insensitive)
  test('query "pipe" matches nodes whose attributes contain "pipe" (case-insensitive)', () => {
    const results = searchIndex.search('pipe');
    assert.equal(results.length, 3); // All 3 have 'pipe' in their path
  });

  test('query "a106" matches one node', () => {
    const results = searchIndex.search('a106');
    assert.equal(results.length, 1);
    assert.equal(results[0].canonicalObjectId, 'RVM:200');
  });

  // ✅ query "" returns empty array (not all nodes)
  test('query "" returns empty array', () => {
    const results = searchIndex.search('');
    assert.equal(results.length, 0);
  });

  // ✅ query for unknown term returns []
  test('query for unknown term returns []', () => {
    const results = searchIndex.search('nonexistent');
    assert.equal(results.length, 0);
  });

  // ✅ renderObjectIds[] from search result matches identity map
  test('renderObjectIds[] from search result matches identity map', () => {
    const results = searchIndex.search('WeldNeck');
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].renderObjectIds, ['mesh_3']);
  });

  // ✅ click in tree → selectByCanonicalId called with correct id
  test('click in tree → selectByCanonicalId called with correct id', () => {
    const tree = new RvmTreeModel(metadataIndex);
    const container = global.document.createElement('div');
    tree.render(container);

    let selectedId = null;
    tree.onNodeSelected = (id) => { selectedId = id; };

    // Find ELBOW-01 label
    const labels = container.querySelectorAll('.rvm-tree-label');
    let elbowLabel;
    for (const label of labels) {
      if (label.textContent === 'ELBOW-01') elbowLabel = label;
    }

    elbowLabel.click();
    assert.equal(selectedId, 'RVM:200');
  });

  // ✅ click in scene (renderObjectId) → correct attributes returned for that mesh
  test('click in scene (renderObjectId) → correct attributes returned for that mesh', () => {
    const attrs = metadataIndex.getAttributesByRenderId('mesh_2');
    assert.deepEqual(attrs, { SPEC: 'A106' });
  });

  // ✅ attribute panel renders ZONE field with highlight class
  test('attribute panel renders ZONE field with highlight class', () => {
    const container = global.document.createElement('div');
    metadataIndex.renderAttributesPanel(container, 'RVM:100');

    const highlightedCells = container.querySelectorAll('.rvm-attr-highlight');
    // We expect both ZONE and NPD to be highlighted, wait, NPD is in the knownFields too!
    // Set(['ZONE', 'SPEC', 'NPD', 'PIPE_NAME', 'ELEMENT_TYPE'])
    // So 2 cells will be highlighted.
    assert.equal(highlightedCells.length, 2);
    const textContents = highlightedCells.map(c => c.textContent);
    assert.ok(textContents.includes('ZONE'));
    assert.ok(textContents.includes('NPD'));
  });

  console.log('✅ rvm-search unit tests passed.');
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
