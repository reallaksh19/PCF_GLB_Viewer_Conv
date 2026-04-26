export class RvmVisibilityController {
    constructor(viewer) {
        this.viewer = viewer;
        this.hiddenCanonicalIds = new Set();
        this.isolatedCanonicalIds = new Set();
        this.isIsolating = false;
    }

    isolate(canonicalIds) {
        if (!Array.isArray(canonicalIds)) canonicalIds = [canonicalIds];
        this.isolatedCanonicalIds = new Set(canonicalIds);
        this.hiddenCanonicalIds.clear();
        this.isIsolating = true;
        this._updateVisibility();
    }

    showAll() {
        this.isolatedCanonicalIds.clear();
        this.hiddenCanonicalIds.clear();
        this.isIsolating = false;
        this._updateVisibility();
    }

    hide(canonicalIds) {
        if (!Array.isArray(canonicalIds)) canonicalIds = [canonicalIds];
        this.isIsolating = false;
        this.isolatedCanonicalIds.clear();
        canonicalIds.forEach(id => this.hiddenCanonicalIds.add(id));
        this._updateVisibility();
    }

    _updateVisibility() {
        if (!this.viewer._componentGroup || !this.viewer._identityMap) return;

        this.viewer._componentGroup.traverse((obj) => {
            if (obj.isMesh && obj.userData && obj.userData.renderObjectId) {
                const canonicalId = this.viewer._identityMap.canonicalFromRender(obj.userData.renderObjectId);
                if (!canonicalId) return;

                if (this.isIsolating) {
                    obj.visible = this.isolatedCanonicalIds.has(canonicalId);
                } else {
                    obj.visible = !this.hiddenCanonicalIds.has(canonicalId);
                }
            }
        });
    }

    getHidden() {
        return Array.from(this.hiddenCanonicalIds);
    }

    getIsolated() {
        return Array.from(this.isolatedCanonicalIds);
    }

    restoreState(state) {
        if (!state) return;
        if (state.isolated && state.isolated.length > 0) {
            this.isolate(state.isolated);
        } else if (state.hidden && state.hidden.length > 0) {
            this.hide(state.hidden);
        } else {
            this.showAll();
        }
    }
}
