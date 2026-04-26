import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { RvmSectioning } from './RvmSectioning.js';
import { RvmVisibilityController } from './RvmVisibilityController.js';
import { RvmSelectionAdapter } from './RvmSelectionAdapter.js';

/**
 * 3D Viewer core for RVM mode.
 */
export class RvmViewer3D {
  constructor(container, identityMap) {
    this.container = container;
    this.identityMap = identityMap;
    this._navMode = 'orbit';
    this._isDisposed = false;
    this._reqFrameId = null;
    this._isPerspective = true;

    // Initialize core components
    this._initScene();

    // Sub-modules
    this.sectioning = new RvmSectioning(this);
    this.visibility = new RvmVisibilityController(this, identityMap);
    this.selection = new RvmSelectionAdapter(this, identityMap);

    // Initial resize
    this._onResize();

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => {
      this._onResize();
    });
    this._resizeObserver.observe(this.container);

    // Start render loop
    this._animate();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x222222);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    // Camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000000);
    this.camera.position.set(100, 100, 100);

    this.orthoCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000000);
    this.orthoCamera.position.copy(this.camera.position);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.localClippingEnabled = true;
    this.container.appendChild(this.renderer.domElement);

    // CSS2DRenderer
    this.cssRenderer = new CSS2DRenderer();
    this.cssRenderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.top = '0px';
    this.cssRenderer.domElement.style.pointerEvents = 'none';
    this.container.appendChild(this.cssRenderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 1, 1).normalize();
    this.scene.add(dirLight);
  }

  _onResize() {
    if (this._isDisposed) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;

    this.renderer.setSize(width, height);
    this.cssRenderer.setSize(width, height);

    const aspect = width / height;

    if (this.camera) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    if (this.orthoCamera) {
      const frustumSize = 200; // Will be scaled properly in fitAll
      this.orthoCamera.left = -frustumSize * aspect / 2;
      this.orthoCamera.right = frustumSize * aspect / 2;
      this.orthoCamera.top = frustumSize / 2;
      this.orthoCamera.bottom = -frustumSize / 2;
      this.orthoCamera.updateProjectionMatrix();
    }

    this._queueOverlayRefresh();
  }

  _animate = () => {
    if (this._isDisposed) return;
    this._reqFrameId = requestAnimationFrame(this._animate);

    this.controls.update();
    const activeCamera = this._isPerspective ? this.camera : this.orthoCamera;

    this.renderer.render(this.scene, activeCamera);
    this.cssRenderer.render(this.scene, activeCamera);
  };

  _queueOverlayRefresh() {
    // Hooks for sub-modules to update UI overlays if needed
  }

  /**
   * Loads the model into the scene.
   */
  loadModel(glbScene, manifest) {
    this.modelGroup.clear();
    this.modelGroup.add(glbScene);

    const upAxis = manifest?.runtime?.upAxis || 'Y';
    if (upAxis === 'Z') {
      this.modelGroup.rotation.x = -Math.PI / 2;
    } else {
      this.modelGroup.rotation.x = 0;
    }
    this.modelGroup.updateMatrixWorld(true);

    this.fitAll();
  }

  // --- dispatchViewerCommand Surface ---

  fitAll() {
    if (!this.modelGroup) return;
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = this.camera.fov * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

    this.camera.position.set(center.x, center.y, center.z + cameraZ);
    this.orthoCamera.position.copy(this.camera.position);

    this.controls.target.copy(center);
    this.controls.update();

    // Update ortho frustum size
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.orthoCamera.left = -maxDim * aspect / 2;
    this.orthoCamera.right = maxDim * aspect / 2;
    this.orthoCamera.top = maxDim / 2;
    this.orthoCamera.bottom = -maxDim / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  fitSelection() {
    if (!this.modelGroup) return;
    const selectedRenderIds = new Set();
    const canonicalId = this.selection.getSelection();
    if (canonicalId && this.identityMap) {
      const rIds = this.identityMap.renderIdsFromCanonical(canonicalId);
      if (rIds) rIds.forEach(id => selectedRenderIds.add(id));
    }

    if (selectedRenderIds.size === 0) {
      return this.fitAll();
    }

    const box = new THREE.Box3();
    this.modelGroup.traverse((obj) => {
      if (obj.isMesh && (selectedRenderIds.has(obj.name) || selectedRenderIds.has(obj.uuid))) {
        box.expandByObject(obj);
      }
    });

    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = this.camera.fov * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

    this.camera.position.set(center.x, center.y, center.z + cameraZ);
    this.orthoCamera.position.copy(this.camera.position);

    this.controls.target.copy(center);
    this.controls.update();

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.orthoCamera.left = -maxDim * aspect / 2;
    this.orthoCamera.right = maxDim * aspect / 2;
    this.orthoCamera.top = maxDim / 2;
    this.orthoCamera.bottom = -maxDim / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  setSectionMode(mode) {
    this.sectioning.setMode(mode);
  }

  disableSection() {
    this.sectioning.disableSection();
  }

  getNavMode() {
    return this._navMode;
  }

  setNavMode(mode) {
    this._navMode = mode;
    // Currently only 'orbit' is fully implemented in controls
  }

  toggleProjection() {
    this._isPerspective = !this._isPerspective;
    const activeCamera = this._isPerspective ? this.camera : this.orthoCamera;
    this.controls.object = activeCamera;
    this.controls.update();
  }

  snapToPreset(preset) {
    // Basic implementation for snapToPreset
    if (!this.modelGroup) return;
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) * 1.5;

    let offset = new THREE.Vector3(0, 0, d);
    switch (preset) {
      case 'TOP': offset.set(0, d, 0); break;
      case 'BOTTOM': offset.set(0, -d, 0); break;
      case 'FRONT': offset.set(0, 0, d); break;
      case 'BACK': offset.set(0, 0, -d); break;
      case 'LEFT': offset.set(-d, 0, 0); break;
      case 'RIGHT': offset.set(d, 0, 0); break;
      case 'ISO': offset.set(d, d, d).normalize().multiplyScalar(d); break;
    }

    this.camera.position.copy(center).add(offset);
    this.orthoCamera.position.copy(this.camera.position);
    this.controls.target.copy(center);
    this.controls.update();
  }

  clearSelection() {
    this.selection.clearSelection();
  }

  isolateSelection() {
    const canonicalId = this.selection.getSelection();
    if (canonicalId) {
      this.visibility.isolate([canonicalId]);
    }
  }

  showAll() {
    this.visibility.showAll();
  }

  selectByCanonicalId(id) {
    this.selection.selectByCanonicalId(id);
  }

  getSelection() {
    return this.selection.getSelection();
  }

  setSavedView(view) {
    // Restore camera and section states from saved view
    if (view.camera) {
      this.camera.position.set(view.camera.position.x, view.camera.position.y, view.camera.position.z);
      this.camera.quaternion.set(view.camera.quaternion.x, view.camera.quaternion.y, view.camera.quaternion.z, view.camera.quaternion.w);
      this.controls.target.set(view.camera.target.x, view.camera.target.y, view.camera.target.z);
      this.controls.update();
    }
    if (view.projection) {
      this._isPerspective = view.projection === 'perspective';
      this.controls.object = this._isPerspective ? this.camera : this.orthoCamera;
    }
    if (view.navMode) {
      this.setNavMode(view.navMode);
    }
    if (view.sectionState && view.sectionState.mode) {
      this.setSectionMode(view.sectionState.mode);
    } else {
      this.disableSection();
    }
    this.visibility.showAll();
    if (view.isolatedCanonicalObjectIds && view.isolatedCanonicalObjectIds.length > 0) {
      this.visibility.isolate(view.isolatedCanonicalObjectIds);
    } else if (view.hiddenCanonicalObjectIds && view.hiddenCanonicalObjectIds.length > 0) {
      this.visibility.hide(view.hiddenCanonicalObjectIds);
    }
    if (view.selectedCanonicalObjectId) {
      this.selectByCanonicalId(view.selectedCanonicalObjectId);
    } else {
      this.clearSelection();
    }
  }

  getSavedView() {
    return {
      camera: {
        position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        quaternion: { x: this.camera.quaternion.x, y: this.camera.quaternion.y, z: this.camera.quaternion.z, w: this.camera.quaternion.w },
        target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z }
      },
      projection: this._isPerspective ? 'perspective' : 'orthographic',
      navMode: this._navMode,
      sectionState: { mode: this.sectioning.mode },
      hiddenCanonicalObjectIds: [], // Would populate from visibility tracking
      isolatedCanonicalObjectIds: [],
      selectedCanonicalObjectId: this.selection.getSelection(),
      overlayMode: { tags: true, attributes: false }
    };
  }

  dispose() {
    this._isDisposed = true;
    if (this._reqFrameId) {
      cancelAnimationFrame(this._reqFrameId);
      this._reqFrameId = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    this.controls.dispose();

    if (this.renderer && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.cssRenderer && this.cssRenderer.domElement.parentNode) {
      this.cssRenderer.domElement.parentNode.removeChild(this.cssRenderer.domElement);
    }

    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m.dispose());
        } else {
          object.material.dispose();
        }
      }
      if (object.texture) object.texture.dispose();
    });

    this.renderer.dispose();

    // Release refs
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.orthoCamera = null;
    this.renderer = null;
    this.cssRenderer = null;
    this.controls = null;
    this.modelGroup = null;
    this.identityMap = null;
    this.sectioning = null;
    this.visibility = null;
    this.selection = null;
  }
}
