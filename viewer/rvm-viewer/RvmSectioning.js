import * as THREE from 'three';

export class RvmSectioning {
    constructor(modelGroup, scene, renderer) {
        this.modelGroup = modelGroup;
        this.scene = scene;
        this.renderer = renderer;

        this._sectionMode = 'OFF';
        this._clipPlanes = [];
        this._sectionBounds = null;
        this._padding = 0;
        this._offset = 0;

        // Visual helpers (lines/planes) can be added here
        this._helpersGroup = new THREE.Group();
        this.scene.add(this._helpersGroup);
    }

    updateModelGroup(modelGroup) {
        this.modelGroup = modelGroup;
        if (this._sectionMode !== 'OFF') {
            this.setSectionMode(this._sectionMode);
        }
    }

    setSectionMode(mode) {
        const normalized = mode?.toUpperCase() || 'OFF';
        this._sectionMode = normalized;

        if (normalized === 'BOX') {
            this.buildBoxSection(this.modelGroup);
        } else if (normalized === 'PLANE_UP') {
            this.buildPlaneUpSection(this.modelGroup);
        } else {
            this.disableSection();
        }
    }

    disableSection() {
        this._sectionMode = 'OFF';
        this._clipPlanes = [];
        this._helpersGroup.clear();
        this._applyCurrentSectionClipping();
    }

    getSectionState() {
        return { mode: this._sectionMode, padding: this._padding, offset: this._offset };
    }

    buildBoxSection(modelGroup) {
        if (!modelGroup) return;
        const box = new THREE.Box3().setFromObject(modelGroup);
        if (box.isEmpty()) return;

        box.expandByScalar(-this._padding); // shrink box by padding
        this._sectionBounds = box.clone();


        box.expandByScalar(-this._padding); // shrink box by padding
        this._sectionBounds = box.clone();

        this._applyBoxPlanes(box);
        this._renderSectionBoxVisual(box);
    }

    buildPlaneUpSection(modelGroup) {
        if (!modelGroup) return;
        const box = new THREE.Box3().setFromObject(modelGroup);
        if (box.isEmpty()) return;
        this._sectionBounds = box.clone();

        const centre = box.getCenter(new THREE.Vector3());
        const cut = centre.y + this._offset;

        // Plane normal facing downwards (so anything ABOVE is clipped)
        // Adjust based on upAxis if needed, assuming Y-up for cut plane normal:
        const normal = new THREE.Vector3(0, -1, 0);
        this._clipPlanes = [new THREE.Plane(normal, cut)];

        this._applyCurrentSectionClipping();
        this._renderSectionPlaneVisual(normal, cut, box);
    }

    setSectionBoxPadding(n) {
        this._padding = n;
        if (this._sectionMode === 'BOX') {
            this.buildBoxSection(this.modelGroup);
        }
    }

    setSectionPlaneOffset(n) {
        this._offset = n;
        if (this._sectionMode === 'PLANE_UP') {
            this.buildPlaneUpSection(this.modelGroup);
        }
    }

    _applyBoxPlanes(box) {
        const min = box.min;
        const max = box.max;
        this._clipPlanes = [
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
        if (!this.modelGroup || !this.renderer) return;
        const enabled = this._sectionMode !== 'OFF' && this._clipPlanes.length > 0;


        // Ensure local clipping is true
        this.renderer.localClippingEnabled = true;

        this.modelGroup.traverse((obj) => {
            if (!obj?.material) return;
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of materials) {
                m.clippingPlanes = enabled ? this._clipPlanes : [];
                m.clipIntersection = false;
                m.needsUpdate = true;
            }
        });
    }

    _renderSectionBoxVisual(box) {
        this._helpersGroup.clear();
        const helper = new THREE.Box3Helper(box, 0xffff00);
        this._helpersGroup.add(helper);
    }

    _renderSectionPlaneVisual(normal, constant, box) {
        this._helpersGroup.clear();
        const plane = new THREE.Plane(normal, constant);
        const size = box.getSize(new THREE.Vector3()).length();
        const helper = new THREE.PlaneHelper(plane, size, 0xffff00);
        this._helpersGroup.add(helper);
    }

    dispose() {
        this.disableSection();
    }
}
