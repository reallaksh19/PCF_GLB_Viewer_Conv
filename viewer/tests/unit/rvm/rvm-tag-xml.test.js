import assert from 'assert/strict';
import { JSDOM } from 'jsdom';

// Setup DOM for DOMParser and XMLSerializer
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

// Mock localStorage and crypto before importing state
global.localStorage = { getItem: () => null, setItem: () => {} };
if (!global.window) global.window = { localStorage: global.localStorage };
if (!global.crypto) global.crypto = { randomUUID: () => Math.random().toString() };

import { RvmTagXmlStore } from '../../../rvm/RvmTagXmlStore.js';
import { RvmSavedViews } from '../../../rvm/RvmSavedViews.js';
import { state } from '../../../core/state.js';
import { RvmIdentityMap } from '../../../rvm/RvmIdentityMap.js';
import { notifications, clearNotifications } from '../../../diagnostics/notification-center.js';

const mockViewer = {
    addedTags: [],
    removedTags: [],
    selectedIds: [],
    fitted: 0,
    lastLoadedView: null,
    addTag: (tag) => mockViewer.addedTags.push(tag),
    removeTag: (id) => mockViewer.removedTags.push(id),
    selectByCanonicalId: (id) => mockViewer.selectedIds.push(id),
    fitSelection: () => mockViewer.fitted++,
    setSavedView: (view) => mockViewer.lastLoadedView = view,
    getCameraState: () => ({ x: 1, y: 2, z: 3 })
};

async function runTests() {
  console.log('--- rvm-tag-xml.test.js ---');

  state.rvm.activeBundle = 'bundle-test-123';
  state.rvm.tags = [];
  state.rvm.savedViews = [];
  state.rvm.identityMap = new RvmIdentityMap();
  state.rvm.identityMap.add({ sourceObjectId: 'RVM:1', canonicalObjectId: 'OBJ:KNOWN', renderObjectIds: [] });

  try {
    clearNotifications();
    mockViewer.addedTags = [];

    // 1. create tag → serialise → parse → same fields round-trip
    // XML escaping: title with <>&" chars survives round-trip
    const createdTag = RvmTagXmlStore.create(mockViewer, {
        canonicalObjectId: 'OBJ:KNOWN',
        text: 'Test <>&" Text',
        severity: 'high',
        viewStateRef: 'VIEW-999'
    });

    assert.strictEqual(state.rvm.tags.length, 1);
    assert.strictEqual(mockViewer.addedTags.length, 1);

    const xml = RvmTagXmlStore.exportXml();
    // 2. export XML is well-formed
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    assert.ok(!doc.querySelector('parsererror'));

    // reset state
    state.rvm.tags = [];
    mockViewer.addedTags = [];

    // import
    RvmTagXmlStore.importXml(mockViewer, xml);
    assert.strictEqual(state.rvm.tags.length, 1);
    const restored = state.rvm.tags[0];

    assert.strictEqual(restored.canonicalObjectId, 'OBJ:KNOWN');
    assert.strictEqual(restored.text, 'Test <>&" Text');
    assert.strictEqual(restored.severity, 'high');
    assert.strictEqual(restored.viewStateRef, 'VIEW-999');
    assert.strictEqual(restored.status, 'active');

    console.log('✅ create tag → serialise → parse → same fields round-trip');
    console.log('✅ export XML is well-formed (parseable by DOMParser without error)');
    console.log('✅ XML escaping: title with <>&" chars survives round-trip');

    // 3. import XML with unknown canonicalObjectId → tag kept, status="unresolved"
    const unknownXml = `<ReviewTags schemaVersion="rvm-review-tags/v1" bundleId="bundle-test-123">
        <Tag id="TAG-UNKNOWN">
            <CanonicalObjectId>OBJ:UNKNOWN</CanonicalObjectId>
            <SourceObjectId>RVM:UNKNOWN</SourceObjectId>
            <Text>Unknown Object Tag</Text>
        </Tag>
    </ReviewTags>`;

    state.rvm.tags = [];
    clearNotifications();
    RvmTagXmlStore.importXml(mockViewer, unknownXml);

    assert.strictEqual(state.rvm.tags.length, 1);
    assert.strictEqual(state.rvm.tags[0].status, 'unresolved');
    await new Promise(r => setTimeout(r, 0)); // wait for diagnostics to async emit
    assert.ok(notifications.some(n => (n.message && n.message.includes('not found in model')) || (n.details && typeof n.details === 'string' && n.details.includes('not found in model'))));
    console.log('✅ import XML with unknown canonicalObjectId → tag kept, status="unresolved"');

    // 4. import XML with known canonicalObjectId → tag status unchanged (active)
    const knownXml = `<ReviewTags schemaVersion="rvm-review-tags/v1" bundleId="bundle-test-123">
        <Tag id="TAG-KNOWN-2">
            <CanonicalObjectId>OBJ:KNOWN</CanonicalObjectId>
            <SourceObjectId>RVM:1</SourceObjectId>
            <Text>Known Object Tag</Text>
        </Tag>
    </ReviewTags>`;

    state.rvm.tags = [];
    clearNotifications();
    RvmTagXmlStore.importXml(mockViewer, knownXml);
    assert.strictEqual(state.rvm.tags.length, 1);
    assert.strictEqual(state.rvm.tags[0].status, 'active');
    console.log('✅ import XML with known canonicalObjectId → tag status unchanged');

    // 5. delete tag → removed from store and from viewer labels
    const tagIdToDelete = state.rvm.tags[0].id;
    mockViewer.removedTags = [];
    RvmTagXmlStore.deleteTag(mockViewer, tagIdToDelete);
    assert.strictEqual(state.rvm.tags.length, 0);
    assert.ok(mockViewer.removedTags.includes(tagIdToDelete));
    console.log('✅ delete tag → removed from store and from viewer labels');

    // 6. jumpToTag → viewer.setCameraState called with saved camera
    // We will create a saved view and link it to a tag to test
    const view = RvmSavedViews.saveView(mockViewer, 'JumpView');
    const jumpTag = RvmTagXmlStore.create(mockViewer, {
        canonicalObjectId: 'OBJ:KNOWN',
        text: 'Jump target',
        viewStateRef: view.id
    });

    mockViewer.lastLoadedView = null;
    RvmTagXmlStore.jumpToTag(mockViewer, jumpTag.id);
    assert.strictEqual(mockViewer.lastLoadedView.id, view.id);
    console.log('✅ jumpToTag → viewer.setSavedView called with saved view');

    // 7. bundleId in XML matches loaded bundle's bundleId
    const badBundleXml = `<ReviewTags schemaVersion="rvm-review-tags/v1" bundleId="bundle-bad">
        <Tag id="TAG-BAD-BUNDLE">
            <CanonicalObjectId>OBJ:KNOWN</CanonicalObjectId>
        </Tag>
    </ReviewTags>`;

    clearNotifications();
    RvmTagXmlStore.importXml(mockViewer, badBundleXml);
    await new Promise(r => setTimeout(r, 0)); // wait for diagnostics to async emit
    assert.ok(notifications.some(n => (n.message && n.message.includes('Bundle ID mismatch')) || (n.details && typeof n.details === 'string' && n.details.includes('Bundle ID mismatch'))));
    console.log('✅ bundleId in XML matches loaded bundle\'s bundleId (warns on mismatch)');

  } catch (err) {
    console.error('❌ tests failed', err);
    process.exitCode = 1;
  }
}

runTests();
