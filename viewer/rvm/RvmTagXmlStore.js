import { state, saveStickyState } from '../core/state.js';
import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';
import { RvmDiagnostics } from './RvmDiagnostics.js';

export class RvmTagXmlStore {
  /**
   * Create a new tag.
   */
  static create(viewer, payload) {
    if (!state.rvm || !state.rvm.activeBundle) {
      throw new Error("Cannot create tag without an active bundle.");
    }

    const { canonicalObjectId, text, severity, viewStateRef } = payload;
    const identityEntry = state.rvm.identityMap ? state.rvm.identityMap.lookupByCanonical(canonicalObjectId) : null;
    const sourceObjectId = identityEntry ? identityEntry.sourceObjectId : canonicalObjectId;

    const tag = {
      id: `TAG-${crypto.randomUUID()}`,
      canonicalObjectId,
      sourceObjectId,
      anchorType: 'object',
      text,
      severity: severity || 'medium',
      viewStateRef: viewStateRef || null,
      status: 'active'
    };

    if (!Array.isArray(state.rvm.tags)) {
      state.rvm.tags = [];
    }

    state.rvm.tags.push(tag);
    saveStickyState();

    if (viewer && viewer.addTag) {
      viewer.addTag(tag);
    }

    emit(RuntimeEvents.RVM_TAG_CREATED, tag);
    return tag;
  }

  /**
   * Delete a tag.
   */
  static deleteTag(viewer, tagId) {
    if (!state.rvm || !Array.isArray(state.rvm.tags)) return;

    const idx = state.rvm.tags.findIndex(t => t.id === tagId);
    if (idx !== -1) {
      state.rvm.tags.splice(idx, 1);
      saveStickyState();

      if (viewer && viewer.removeTag) {
        viewer.removeTag(tagId);
      }

      emit(RuntimeEvents.RVM_TAG_DELETED, { id: tagId });
    }
  }

  /**
   * Jumps the viewer to the specific tag's saved view or object.
   */
  static jumpToTag(viewer, tagId) {
     if (!state.rvm || !Array.isArray(state.rvm.tags)) return;
     const tag = state.rvm.tags.find(t => t.id === tagId);
     if (!tag) return;

     if (tag.viewStateRef && viewer.setSavedView) {
        // Assume RvmSavedViews handles the lookup from viewStateRef to full view
        const savedViews = state.rvm.savedViews || [];
        const view = savedViews.find(v => v.id === tag.viewStateRef);
        if (view) {
            viewer.setSavedView(view);
            return;
        }
     }

     // Fallback to jumping to object
     if (viewer.selectByCanonicalId && viewer.fitSelection) {
         viewer.selectByCanonicalId(tag.canonicalObjectId);
         viewer.fitSelection();
     }
  }

  /**
   * Export tags to XML string
   */
  static exportXml() {
     if (!state.rvm || !state.rvm.activeBundle) return '';
     const doc = document.implementation.createDocument(null, 'ReviewTags');
     const root = doc.documentElement;
     root.setAttribute('schemaVersion', 'rvm-review-tags/v1');
     root.setAttribute('bundleId', state.rvm.activeBundle);

     const tags = state.rvm.tags || [];
     for (const t of tags) {
        const tagEl = doc.createElement('Tag');
        tagEl.setAttribute('id', t.id);

        const canEl = doc.createElement('CanonicalObjectId');
        canEl.textContent = t.canonicalObjectId;
        tagEl.appendChild(canEl);

        const srcEl = doc.createElement('SourceObjectId');
        srcEl.textContent = t.sourceObjectId;
        tagEl.appendChild(srcEl);

        const ancEl = doc.createElement('AnchorType');
        ancEl.textContent = t.anchorType;
        tagEl.appendChild(ancEl);

        const txtEl = doc.createElement('Text');
        txtEl.textContent = t.text;
        tagEl.appendChild(txtEl);

        const sevEl = doc.createElement('Severity');
        sevEl.textContent = t.severity;
        tagEl.appendChild(sevEl);

        if (t.viewStateRef) {
           const vsEl = doc.createElement('ViewStateRef');
           vsEl.textContent = t.viewStateRef;
           tagEl.appendChild(vsEl);
        }

        root.appendChild(tagEl);
     }

     const serializer = new XMLSerializer();
     return serializer.serializeToString(doc);
  }

  /**
   * Import tags from XML string
   */
  static importXml(viewer, xmlString) {
      if (!state.rvm || !state.rvm.activeBundle) return;
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'application/xml');

      const parserError = doc.querySelector('parsererror');
      if (parserError) {
          throw new Error('XML parsing failed');
      }

      const root = doc.documentElement;
      if (root.tagName !== 'ReviewTags') return;

      const xmlBundleId = root.getAttribute('bundleId');
      if (xmlBundleId && xmlBundleId !== state.rvm.activeBundle) {
          RvmDiagnostics.report('warning', 'Bundle ID mismatch on Tag Import', `Expected ${state.rvm.activeBundle}, got ${xmlBundleId}`);
      }

      const tagsList = doc.getElementsByTagName('Tag');
      if (!Array.isArray(state.rvm.tags)) {
          state.rvm.tags = [];
      }

      for (let i = 0; i < tagsList.length; i++) {
          const el = tagsList[i];
          const id = el.getAttribute('id') || `TAG-${crypto.randomUUID()}`;
          const canonicalObjectId = el.querySelector('CanonicalObjectId')?.textContent || '';
          const sourceObjectId = el.querySelector('SourceObjectId')?.textContent || '';
          const anchorType = el.querySelector('AnchorType')?.textContent || 'object';
          const text = el.querySelector('Text')?.textContent || '';
          const severity = el.querySelector('Severity')?.textContent || 'medium';
          const viewStateRef = el.querySelector('ViewStateRef')?.textContent || null;

          // Check if it already exists, avoid duplicates based on ID
          if (state.rvm.tags.find(t => t.id === id)) continue;

          let status = 'active';

          if (state.rvm.identityMap) {
             const entry = state.rvm.identityMap.lookupByCanonical(canonicalObjectId);
             if (!entry) {
                 status = 'unresolved';
                 RvmDiagnostics.report('warning', 'Unresolved Tag', `Canonical ID ${canonicalObjectId} not found in model.`);
             }
          }

          const tag = { id, canonicalObjectId, sourceObjectId, anchorType, text, severity, viewStateRef, status };
          state.rvm.tags.push(tag);

          if (viewer && viewer.addTag) {
              viewer.addTag(tag);
          }

          emit(RuntimeEvents.RVM_TAG_CREATED, tag);
      }

      saveStickyState();
  }
}
