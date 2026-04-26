import * as THREE from 'three';

/**
 * Handles selection, picking, and highlighting for the RVM Viewer.
 */
export class RvmSelectionAdapter {
  constructor(viewer, identityMap) {
    this.viewer = viewer;
    this.identityMap = identityMap;
    this.selectedCanonicalId = null;
    this.searchedCanonicalIds = new Set();
  }

  setIdentityMap(map) {
    this.identityMap = map;
  }

  selectByCanonicalId(canonicalId) {
    if (this.selectedCanonicalId === canonicalId) return;
    this.selectedCanonicalId = canonicalId;
    this._applyHighlights();
  }

  getSelection() {
    return this.selectedCanonicalId;
  }

  clearSelection() {
    if (this.selectedCanonicalId === null) return;
    this.selectedCanonicalId = null;
    this._applyHighlights();
  }

  setSearchedIds(canonicalIds) {
    this.searchedCanonicalIds = new Set(canonicalIds || []);
    this._applyHighlights();
  }

  clearSearch() {
    if (this.searchedCanonicalIds.size === 0) return;
    this.searchedCanonicalIds.clear();
    this._applyHighlights();
  }

  _applyHighlights() {
    if (!this.viewer.modelGroup || !this.identityMap) return;

    // Resolve IDs to render IDs
    const selectedRenderIds = new Set();
    if (this.selectedCanonicalId) {
      const rIds = this.identityMap.renderIdsFromCanonical(this.selectedCanonicalId);
      if (rIds) rIds.forEach(id => selectedRenderIds.add(id));
    }

    const searchedRenderIds = new Set();
    for (const canonicalId of this.searchedCanonicalIds) {
      const rIds = this.identityMap.renderIdsFromCanonical(canonicalId);
      if (rIds) rIds.forEach(id => searchedRenderIds.add(id));
    }

    this.viewer.modelGroup.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const isSelected = selectedRenderIds.has(obj.name) || selectedRenderIds.has(obj.uuid);
        const isSearched = searchedRenderIds.has(obj.name) || searchedRenderIds.has(obj.uuid);

        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) {
          if (m.emissive) {
            if (isSelected) {
              m.emissive.setHex(0x2244cc);
            } else if (isSearched) {
              m.emissive.setHex(0x884400);
            } else {
              m.emissive.setHex(0x000000);
            }
          }
        }
      }
    });

    this.viewer._queueOverlayRefresh?.();
  }
}
