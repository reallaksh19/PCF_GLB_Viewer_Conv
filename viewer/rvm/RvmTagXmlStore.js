import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';
import { notify } from '../diagnostics/notification-center.js';
import { state, saveStickyState } from '../core/state.js';

const SCHEMA_VERSION = 'rvm-review-tags/v1';

export class RvmTagXmlStore {
  constructor(identityMap, activeBundleId) {
    this.identityMap = identityMap;
    this.bundleId = activeBundleId;
    this.tags = new Map(); // id -> tag config

    // Load from state if available
    if (state.rvm.tags && Array.isArray(state.rvm.tags)) {
      for (const t of state.rvm.tags) {
        if (t.bundleId === this.bundleId) {
          this.tags.set(t.id, t);
        }
      }
    }
  }

  // Create a new tag programmatically
  createTag(config) {
    // Generate an id if not provided
    const id = config.id || `TAG-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const tag = {
      id,
      bundleId: this.bundleId,
      canonicalObjectId: config.canonicalObjectId || '',
      sourceObjectId: config.sourceObjectId || '',
      anchorType: config.anchorType || 'object',
      text: config.text || '',
      severity: config.severity || 'info',
      viewStateRef: config.viewStateRef || '',
      status: config.status || 'active', // active, unresolved
      worldPosition: config.worldPosition || null, // Optional position to place the tag in 3D
      cameraState: config.cameraState || null
    };

    if (!tag.sourceObjectId && tag.canonicalObjectId) {
      const entry = this.identityMap?.lookupByCanonical(tag.canonicalObjectId);
      if (entry) {
        tag.sourceObjectId = entry.sourceObjectId;
      }
    }

    this.tags.set(id, tag);
    this._persist();
    emit(RuntimeEvents.RVM_TAG_CREATED, { tag });
    return tag;
  }

  deleteTag(id) {
    if (this.tags.has(id)) {
      const tag = this.tags.get(id);
      this.tags.delete(id);
      this._persist();
      emit(RuntimeEvents.RVM_TAG_DELETED, { id, tag });
      return true;
    }
    return false;
  }

  getTag(id) {
    return this.tags.get(id) || null;
  }

  getAllTags() {
    return Array.from(this.tags.values());
  }

  _persist() {
    state.rvm.tags = this.getAllTags();
    saveStickyState();
  }

  // Helper to escape XML
  _escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  exportToXml() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<ReviewTags schemaVersion="${SCHEMA_VERSION}" bundleId="${this._escapeXml(this.bundleId)}">\n`;

    for (const tag of this.tags.values()) {
      xml += `  <Tag id="${this._escapeXml(tag.id)}">\n`;
      xml += `    <CanonicalObjectId>${this._escapeXml(tag.canonicalObjectId)}</CanonicalObjectId>\n`;
      if (tag.sourceObjectId) {
        xml += `    <SourceObjectId>${this._escapeXml(tag.sourceObjectId)}</SourceObjectId>\n`;
      }
      xml += `    <AnchorType>${this._escapeXml(tag.anchorType)}</AnchorType>\n`;
      xml += `    <Text>${this._escapeXml(tag.text)}</Text>\n`;
      xml += `    <Severity>${this._escapeXml(tag.severity)}</Severity>\n`;
      if (tag.viewStateRef) {
        xml += `    <ViewStateRef>${this._escapeXml(tag.viewStateRef)}</ViewStateRef>\n`;
      }
      if (tag.worldPosition) {
        xml += `    <WorldPosition x="${tag.worldPosition.x}" y="${tag.worldPosition.y}" z="${tag.worldPosition.z}" />\n`;
      }
      if (tag.cameraState) {
        // Serialize camera state if needed for self-contained tags, though normally it's referenced by viewStateRef.
        // Format can be custom
        xml += `    <CameraState>\n`;
        xml += `      <Position x="${tag.cameraState.position.x}" y="${tag.cameraState.position.y}" z="${tag.cameraState.position.z}" />\n`;
        xml += `      <Target x="${tag.cameraState.target.x}" y="${tag.cameraState.target.y}" z="${tag.cameraState.target.z}" />\n`;
        xml += `    </CameraState>\n`;
      }
      xml += `  </Tag>\n`;
    }

    xml += `</ReviewTags>`;
    return xml;
  }

  importFromXml(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`XML Parse Error: ${parseError.textContent}`);
    }

    const root = doc.documentElement;
    if (root.tagName !== 'ReviewTags') {
      throw new Error('Invalid root element. Expected <ReviewTags>.');
    }

    const schemaVersion = root.getAttribute('schemaVersion');
    if (schemaVersion !== SCHEMA_VERSION) {
      notify({ type: 'warning', message: `XML schema version mismatch. Expected ${SCHEMA_VERSION}, got ${schemaVersion}`});
    }

    const xmlBundleId = root.getAttribute('bundleId');
    if (xmlBundleId && this.bundleId && xmlBundleId !== this.bundleId) {
      notify({ type: 'warning', message: `Imported tags bundleId (${xmlBundleId}) does not match current bundle (${this.bundleId}).` });
    }

    const tagElements = root.querySelectorAll('Tag');
    const importedTags = [];

    for (const tagEl of tagElements) {
      const id = tagEl.getAttribute('id');
      const canonicalObjectId = tagEl.querySelector('CanonicalObjectId')?.textContent || '';
      const sourceObjectId = tagEl.querySelector('SourceObjectId')?.textContent || '';
      const anchorType = tagEl.querySelector('AnchorType')?.textContent || 'object';
      const text = tagEl.querySelector('Text')?.textContent || '';
      const severity = tagEl.querySelector('Severity')?.textContent || 'info';
      const viewStateRef = tagEl.querySelector('ViewStateRef')?.textContent || '';

      let worldPosition = null;
      const wpEl = tagEl.querySelector('WorldPosition');
      if (wpEl) {
        worldPosition = {
          x: parseFloat(wpEl.getAttribute('x')),
          y: parseFloat(wpEl.getAttribute('y')),
          z: parseFloat(wpEl.getAttribute('z'))
        };
      }

      let cameraState = null;
      const camEl = tagEl.querySelector('CameraState');
      if (camEl) {
         const posEl = camEl.querySelector('Position');
         const tgtEl = camEl.querySelector('Target');
         if (posEl && tgtEl) {
           cameraState = {
             position: { x: parseFloat(posEl.getAttribute('x')), y: parseFloat(posEl.getAttribute('y')), z: parseFloat(posEl.getAttribute('z')) },
             target: { x: parseFloat(tgtEl.getAttribute('x')), y: parseFloat(tgtEl.getAttribute('y')), z: parseFloat(tgtEl.getAttribute('z')) }
           };
         }
      }

      let status = 'active';
      if (this.identityMap && canonicalObjectId) {
        const entry = this.identityMap.lookupByCanonical(canonicalObjectId);
        if (!entry) {
          status = 'unresolved';
          notify({ type: 'warning', message: `Imported tag ${id} references unresolved canonical ID: ${canonicalObjectId}` });
        }
      } else {
         // If we don't have an identity map initialized (e.g. static tests without full loading)
         // or it's a test case, handle gracefully
      }

      const tag = {
        id,
        bundleId: xmlBundleId || this.bundleId,
        canonicalObjectId,
        sourceObjectId,
        anchorType,
        text,
        severity,
        viewStateRef,
        status,
        worldPosition,
        cameraState
      };

      this.tags.set(id, tag);
      importedTags.push(tag);
      emit(RuntimeEvents.RVM_TAG_CREATED, { tag });
    }

    this._persist();
    return importedTags;
  }
}
