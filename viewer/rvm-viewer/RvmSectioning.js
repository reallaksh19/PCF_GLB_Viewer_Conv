import * as THREE from 'three';

export class RvmSectioning {
    constructor(viewer) {
        this.viewer = viewer;
        this.mode = 'OFF';
        this.clipPlanes = [];
        this.sectionBounds = null;
    }

    setSectionMode(mode) {
        const normalized = String(mode || 'OFF').toUpperCase();
        this.mode = normalized;
        if (normalized === 'BOX') {
            this.buildBoxSection();
        } else if (normalized === 'PLANE_UP') {
            this.buildPlaneUpSection();
        } else {
            this.disableSection();
        }
    }

    disableSection() {
        this.mode = 'OFF';
        this.clipPlanes = [];
        this.sectionBounds = null;
        this._applyCurrentSectionClipping();
    }

    buildBoxSection() {
        if (!this.viewer._componentGroup) return;
        const box = new THREE.Box3().setFromObject(this.viewer._componentGroup);
        if (box.isEmpty()) return;
        this.sectionBounds = box.clone();
        this._applyBoxPlanes(box);
    }

    buildPlaneUpSection() {
        if (!this.viewer._componentGroup) return;
        const box = new THREE.Box3().setFromObject(this.viewer._componentGroup);
        if (box.isEmpty()) return;
        this.sectionBounds = box.clone();
        const center = box.getCenter(new THREE.Vector3());
        const cut = center.y;
        const normal = new THREE.Vector3(0, -1, 0);
        this.clipPlanes = [new THREE.Plane(normal, cut)];
        this._applyCurrentSectionClipping();
    }

    setSectionBoxPadding(padding) {
        if (this.mode !== 'BOX' || !this.sectionBounds) return;
        const pad = Number(padding || 0);
        const box = this.sectionBounds.clone();
        box.expandByScalar(-pad);
        this._applyBoxPlanes(box);
    }

    setSectionPlaneOffset(offset) {
        if (this.mode !== 'PLANE_UP' || !this.sectionBounds) return;
        const center = this.sectionBounds.getCenter(new THREE.Vector3());
        const base = center.y;
        if (this.clipPlanes[0]) {
            this.clipPlanes[0].constant = base + Number(offset || 0);
            this._applyCurrentSectionClipping();
        }
    }

    _applyBoxPlanes(box) {
        const min = box.min;
        const max = box.max;
        this.clipPlanes = [
            new THREE.Plane(new THREE.Vector3(1, 0, 0), -min.x),
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), max.x),
            new THREE.Plane(new THREE.Vector3(0, 1, 0), -min.y),
            new THREE.Plane(new THREE.Vector3(0, -1, 0), max.y),
            new THREE.Plane(new THREE.Vector3(0, 0, 1), -min.z),
            new THREE.Plane(new THREE.Vector3(0, 0, -1), max.z),
        ];
        this._applyCurrentSectionClipping();
    }

    _applyCurrentSectionClipping() {
        if (!this.viewer._componentGroup || !this.viewer.renderer) return;
        const enabled = this.mode !== 'OFF' && this.clipPlanes.length > 0;
        this.viewer.renderer.localClippingEnabled = enabled;
        this.viewer._componentGroup.traverse((obj) => {
            if (!obj?.material) return;
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of materials) {
                m.clippingPlanes = enabled ? this.clipPlanes : null;
                m.needsUpdate = true;
            }
        });
    }

    getState() {
        if (this.mode === 'OFF') return null;
        return {
            mode: this.mode,
            clipPlanes: this.clipPlanes.map(p => ({ normal: p.normal.toArray(), constant: p.constant })),
            sectionBounds: this.sectionBounds ? { min: this.sectionBounds.min.toArray(), max: this.sectionBounds.max.toArray() } : null
        };
    }

    restoreState(state) {
        if (!state || state.mode === 'OFF') {
             this.disableSection();
             return;
        }
        this.mode = state.mode;
        if (state.sectionBounds) {
             this.sectionBounds = new THREE.Box3(
                 new THREE.Vector3().fromArray(state.sectionBounds.min),
                 new THREE.Vector3().fromArray(state.sectionBounds.max)
             );
        }
        if (state.clipPlanes) {
             this.clipPlanes = state.clipPlanes.map(p => new THREE.Plane(
                 new THREE.Vector3().fromArray(p.normal),
                 p.constant
             ));
        }
        this._applyCurrentSectionClipping();
    }
}
