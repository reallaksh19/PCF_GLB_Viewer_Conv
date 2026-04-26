import * as THREE from 'three';

/**
 * Manages sectioning (clipping planes) for the RVM Viewer.
 */
export class RvmSectioning {
  constructor(viewer) {
    this.viewer = viewer;
    this.mode = 'OFF';
    this.clipPlanes = [];
    this.boxPadding = 0;
    this.planeOffset = 0;
    this.originalBounds = null;
  }

  setMode(mode) {
    const normalized = String(mode || 'OFF').toUpperCase();
    this.mode = normalized;

    if (!this.viewer.modelGroup) return;

    if (this.originalBounds === null) {
      const box = new THREE.Box3().setFromObject(this.viewer.modelGroup);
      if (!box.isEmpty()) {
        this.originalBounds = box.clone();
      }
    }

    if (normalized === 'BOX') {
      this.buildBoxSection(this.viewer.modelGroup);
    } else if (normalized === 'PLANE_UP') {
      this.buildPlaneUpSection(this.viewer.modelGroup);
    } else {
      this.clipPlanes = [];
    }

    this.applyCurrentSectionClipping();
  }

  disableSection() {
    this.setMode('OFF');
  }

  buildBoxSection(modelGroup) {
    if (!modelGroup || !this.originalBounds) return;
    const box = this.originalBounds.clone();

    // Apply padding if needed
    if (this.boxPadding !== 0) {
      box.expandByScalar(-this.boxPadding);
    }

    this._applyBoxPlanes(box);
  }

  buildPlaneUpSection(modelGroup) {
    if (!modelGroup || !this.originalBounds) return;
    const box = this.originalBounds.clone();
    const centre = box.getCenter(new THREE.Vector3());
    const cut = centre.y + this.planeOffset;
    const normal = new THREE.Vector3(0, -1, 0);
    this.clipPlanes = [new THREE.Plane(normal, cut)];
  }

  setSectionBoxPadding(n) {
    this.boxPadding = n;
    if (this.mode === 'BOX') {
      this.buildBoxSection(this.viewer.modelGroup);
      this.applyCurrentSectionClipping();
    }
  }

  setSectionPlaneOffset(n) {
    this.planeOffset = n;
    if (this.mode === 'PLANE_UP') {
      this.buildPlaneUpSection(this.viewer.modelGroup);
      this.applyCurrentSectionClipping();
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
  }

  applyCurrentSectionClipping() {
    if (!this.viewer.modelGroup || !this.viewer.renderer) return;
    const enabled = this.mode !== 'OFF' && this.clipPlanes.length > 0;

    // localClippingEnabled is assumed to be true on the renderer (set in RvmViewer3D)

    this.viewer.modelGroup.traverse((obj) => {
      if (!obj?.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) {
        m.clippingPlanes = enabled ? this.clipPlanes : null;
        m.needsUpdate = true;
      }
    });
  }
}
