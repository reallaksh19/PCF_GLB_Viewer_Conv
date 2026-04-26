import assert from 'assert/strict';
import { RvmIdentityMap } from '../../../rvm/RvmIdentityMap.js';
import { RvmMetadataIndex } from '../../../rvm/RvmMetadataIndex.js';
import { RvmSearchIndex } from '../../../rvm/RvmSearchIndex.js';
import { RvmTreeModel } from '../../../rvm/RvmTreeModel.js';
import { JSDOM } from 'jsdom';

// Setup basic DOM environment for testing
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;

// Mock 3-node RvmIndex
const mockNodes = [
  {
    sourceObjectId: 'RVM:100',
    canonicalObjectId: 'OBJ:100',
    renderObjectIds: ['mesh_100'],
    parentCanonicalObjectId: null,
    name: 'Main Pipe System',
    path: '/Main Pipe System',
    kind: 'System',
    attributes: { SYSTEM_TYPE: 'Cooling', ZONE: 'ZoneA' }
  },
  {
    sourceObjectId: 'RVM:101',
    canonicalObjectId: 'OBJ:101',
    renderObjectIds: ['mesh_101'],
    parentCanonicalObjectId: 'OBJ:100',
    name: 'Pipe A',
    path: '/Main Pipe System/Pipe A',
    kind: 'Pipe',
    attributes: { PIPE_NAME: 'Pipe A', FLUID: 'Water' }
  },
  {
    sourceObjectId: 'RVM:102',
    canonicalObjectId: 'OBJ:102',
    renderObjectIds: ['mesh_102'],
    parentCanonicalObjectId: 'OBJ:101',
    name: 'Valve B',
    path: '/Main Pipe System/Pipe A/Valve B',
    kind: 'Equipment',
    attributes: { SPEC: 'ValveSpec', STATUS: 'Open' }
  }
];

const identityMap = RvmIdentityMap.fromNodes(mockNodes);

async function runTests() {
  console.log('Running RvmSearch tests...');

  // Test RvmSearchIndex
  const searchIndex = new RvmSearchIndex();
  await searchIndex.build(mockNodes, identityMap);

  assert.equal(searchIndex._index.length, 3, 'build index from 3-node RvmIndex → 3 entries');
  console.log('✅ build index from 3-node RvmIndex → 3 entries');

  const pipeResults = searchIndex.search('pipe');
  // "pipe" is present in OBJ:100 (name "Main Pipe System", path "/Main Pipe System")
  // "pipe" is present in OBJ:101 (name "Pipe A", path "/Main Pipe System/Pipe A", PIPE_NAME "Pipe A")
  // "pipe" is present in OBJ:102 (path "/Main Pipe System/Pipe A/Valve B")
  assert.equal(pipeResults.length, 3, 'query "pipe" matches case-insensitive');
  const matchedIds = pipeResults.map(r => r.canonicalObjectId);
  assert.ok(matchedIds.includes('OBJ:100') && matchedIds.includes('OBJ:101') && matchedIds.includes('OBJ:102'));
  console.log('✅ query "pipe" matches nodes whose attributes contain "pipe" (case-insensitive)');

  const emptyResults = searchIndex.search('');
  assert.equal(emptyResults.length, 0, 'query "" returns empty array');
  console.log('✅ query "" returns empty array (not all nodes)');

  const unknownResults = searchIndex.search('xylophone');
  assert.equal(unknownResults.length, 0, 'query for unknown term returns []');
  console.log('✅ query for unknown term returns []');

  // Checking renderObjectIds match identity map
  const pipeAResult = pipeResults.find(r => r.canonicalObjectId === 'OBJ:101');
  assert.deepEqual(pipeAResult.renderObjectIds, identityMap.renderIdsFromCanonical('OBJ:101'));
  console.log('✅ renderObjectIds[] from search result matches identity map');

  // Test RvmTreeModel
  const treeModel = new RvmTreeModel();
  treeModel.build(mockNodes);

  const container = document.createElement('div');
  let selectedId = null;
  let fitCalled = false;

  const mockViewer = {
    selectByCanonicalId: (id) => { selectedId = id; },
    fitSelection: () => { fitCalled = true; }
  };

  treeModel.render(container, mockViewer);

  // Trigger click on Pipe A label
  const labels = container.querySelectorAll('.rvm-tree-label');
  const pipeALabel = Array.from(labels).find(l => l.textContent === 'Pipe A');

  const clickEvent = new dom.window.MouseEvent('click', { bubbles: true });
  pipeALabel.dispatchEvent(clickEvent);

  assert.equal(selectedId, 'OBJ:101', 'click in tree → selectByCanonicalId called with correct id');
  assert.ok(fitCalled, 'click in tree → fitSelection called');
  console.log('✅ click in tree → selectByCanonicalId called with correct id');

  // Test RvmMetadataIndex
  const rvmIndex = { nodes: mockNodes };
  const metadataIndex = new RvmMetadataIndex(identityMap, rvmIndex);

  const meshAttrResult = metadataIndex.lookupByRenderId('mesh_102');
  assert.equal(meshAttrResult.canonicalObjectId, 'OBJ:102');
  assert.equal(meshAttrResult.attributes.SPEC, 'ValveSpec');
  console.log('✅ click in scene (renderObjectId) → correct attributes returned for that mesh');

  const attrContainer = document.createElement('div');
  metadataIndex.renderAttributesPanel(attrContainer, meshAttrResult);

  const highlightRow = attrContainer.querySelector('.rvm-pdms-highlight');
  assert.ok(highlightRow, 'attribute panel should highlight SPEC field');
  assert.ok(highlightRow.textContent.includes('SPEC'), 'highlighted row is SPEC field');

  // also test ZONE field highlight on OBJ:100
  const zoneResult = metadataIndex.lookupByRenderId('mesh_100');
  const attrContainer2 = document.createElement('div');
  metadataIndex.renderAttributesPanel(attrContainer2, zoneResult);
  const zoneRow = attrContainer2.querySelector('.rvm-pdms-highlight');
  assert.ok(zoneRow, 'attribute panel should highlight ZONE field');
  assert.ok(zoneRow.textContent.includes('ZONE'), 'highlighted row is ZONE field');

  console.log('✅ attribute panel renders ZONE field with highlight class');

  console.log('All search/metadata/tree unit tests passed! 🎉');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
