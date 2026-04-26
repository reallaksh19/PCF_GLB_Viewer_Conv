/**
 * Controls visibility of objects in the RVM Viewer.
 */
export class RvmVisibilityController {
  constructor(viewer, identityMap) {
    this.viewer = viewer;
    this.identityMap = identityMap;
  }

  isolate(canonicalIds) {
    if (!this.viewer.modelGroup || !this.identityMap) return;

    // Convert canonical IDs to a Set of render object IDs for fast lookup
    const renderIdsToIsolate = new Set();
    for (const canonicalId of canonicalIds) {
      const renderIds = this.identityMap.renderIdsFromCanonical(canonicalId);
      if (renderIds) {
        for (const renderId of renderIds) {
          renderIdsToIsolate.add(renderId);
        }
      }
    }

    this.viewer.modelGroup.traverse((obj) => {
      if (obj.isMesh) {
        obj.visible = renderIdsToIsolate.has(obj.name) || renderIdsToIsolate.has(obj.uuid);
      }
    });
  }

  showAll() {
    if (!this.viewer.modelGroup) return;
    this.viewer.modelGroup.traverse((obj) => {
      if (obj.isMesh) {
        obj.visible = true;
      }
    });
  }

  hide(canonicalIds) {
    if (!this.viewer.modelGroup || !this.identityMap) return;

    const renderIdsToHide = new Set();
    for (const canonicalId of canonicalIds) {
      const renderIds = this.identityMap.renderIdsFromCanonical(canonicalId);
      if (renderIds) {
        for (const renderId of renderIds) {
          renderIdsToHide.add(renderId);
        }
      }
    }

    this.viewer.modelGroup.traverse((obj) => {
      if (obj.isMesh) {
        if (renderIdsToHide.has(obj.name) || renderIdsToHide.has(obj.uuid)) {
          obj.visible = false;
        }
      }
    });
  }
}
