import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RvmSectioning } from './RvmSectioning.js';
import { RvmVisibilityController } from './RvmVisibilityController.js';
import { RvmSelectionAdapter } from './RvmSelectionAdapter.js';
import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';

export class RvmViewer3D {
    constructor(containerEl, options = {}) {
        this.container = containerEl;
        this.options = options || {};
        this.viewerConfig = this.options.viewerConfig || {};

        // Context resources
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this._css2dRenderer = null;
        this._animId = null;

        // RVM specific parts
        this._componentGroup = null;
        this._identityMap = options.identityMap || null;
        this._upAxis = options.upAxis || 'Y';

        // View / Navigation modes
        this._navMode = 'orbit';
        this._projectionMode = 'perspective';
        this._perspCamera = null;
        this._orthoCamera = null;

        // Managers
        this.sectioning = new RvmSectioning(this);
        this.visibility = new RvmVisibilityController(this);
        this.selection = new RvmSelectionAdapter(this);

        this._savedCameraStates = new Map();

        this._init();
    }

    _init() {
        // Setup base Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x222222);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        const rect = this.container.getBoundingClientRect();
        this.renderer.setSize(rect.width || 800, rect.height || 600);
        this.renderer.localClippingEnabled = true; // REQUIRED for sectioning
        this.container.appendChild(this.renderer.domElement);

        // Setup CSS2DRenderer
        this._css2dRenderer = new CSS2DRenderer();
        this._css2dRenderer.setSize(rect.width || 800, rect.height || 600);
        this._css2dRenderer.domElement.style.position = 'absolute';
        this._css2dRenderer.domElement.style.top = '0px';
        this._css2dRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this._css2dRenderer.domElement);

        // Cameras
        const aspect = (rect.width || 800) / (rect.height || 600);
        this._perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100000);
        this._orthoCamera = new THREE.OrthographicCamera(-aspect * 100, aspect * 100, 100, -100, 0.1, 100000);

        this.camera = this._perspCamera;
        this.camera.position.set(1000, 1000, 1000);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Lights
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight1.position.set(1, 1, 1).normalize();
        this.scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight2.position.set(-1, 0.5, -1).normalize();
        this.scene.add(dirLight2);

        const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambLight);

        // Component group setup
        this._componentGroup = new THREE.Group();
        if (this._upAxis === 'Z') {
             this._componentGroup.rotation.x = -Math.PI / 2;
        }
        this.scene.add(this._componentGroup);

        this._bindResize();
        this._startRenderLoop();
    }

    _bindResize() {
        this._onResize = () => {
            if (!this.container || !this.renderer) return;
            const rect = this.container.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const aspect = rect.width / rect.height;

            this._perspCamera.aspect = aspect;
            this._perspCamera.updateProjectionMatrix();

            const frustumSize = 1000; // dynamic depending on bounds
            this._orthoCamera.left = -frustumSize * aspect / 2;
            this._orthoCamera.right = frustumSize * aspect / 2;
            this._orthoCamera.top = frustumSize / 2;
            this._orthoCamera.bottom = -frustumSize / 2;
            this._orthoCamera.updateProjectionMatrix();

            this.renderer.setSize(rect.width, rect.height);
            this._css2dRenderer.setSize(rect.width, rect.height);
        };
        window.addEventListener('resize', this._onResize);
    }

    _startRenderLoop() {
        const render = () => {
            if (!this.renderer) return;
            this._animId = requestAnimationFrame(render);
            if (this.controls) this.controls.update();
            this.renderer.render(this.scene, this.camera);
            if (this._css2dRenderer) this._css2dRenderer.render(this.scene, this.camera);
        };
        this._animId = requestAnimationFrame(render);
    }

    // Model Load
    loadModel(gltfModel) {
        if (!this._componentGroup) return;
        this._componentGroup.clear();
        this._componentGroup.add(gltfModel);

        // Process geometry materials
        this._componentGroup.traverse((child) => {
            if (child.isMesh) {
                if (child.material) {
                    child.material = child.material.clone();
                }
            }
        });

        this.fitAll();
        emit(RuntimeEvents.RVM_MODEL_LOADED, { loaded: true });
    }

    // Required Commands (satisfies viewer-commands.js)

    fitAll() {
        if (!this._componentGroup || !this.camera || !this.controls) return;
        const box = new THREE.Box3().setFromObject(this._componentGroup);
        if (box.isEmpty()) return;

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this._perspCamera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.2; // Zoom out a little

        const direction = this.camera.position.clone().sub(this.controls.target).normalize();
        if (direction.lengthSq() < 0.01) direction.set(0, 0, 1);

        this._perspCamera.position.copy(center).add(direction.multiplyScalar(cameraZ));
        this._perspCamera.lookAt(center);
        this._perspCamera.updateProjectionMatrix();

        if (this._projectionMode === 'perspective') {
             this.camera = this._perspCamera;
        }

        this.controls.target.copy(center);
        this.controls.update();
    }

    fitSelection() {
        const selectedMeshes = this.selection.getSelectedMeshes();
        if (!selectedMeshes || selectedMeshes.length === 0) {
            return this.fitAll();
        }

        const box = new THREE.Box3();
        selectedMeshes.forEach(mesh => box.expandByObject(mesh));
        if (box.isEmpty()) return;

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z, 100);
        const fov = this._perspCamera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;

        const direction = this.camera.position.clone().sub(this.controls.target).normalize();
        if (direction.lengthSq() < 0.01) direction.set(0, 0, 1);

        this.camera.position.copy(center).add(direction.multiplyScalar(cameraZ));
        this.camera.lookAt(center);
        this.camera.updateProjectionMatrix();

        this.controls.target.copy(center);
        this.controls.update();
    }

    setSectionMode(mode) {
        this.sectioning.setSectionMode(mode);
    }

    disableSection() {
        this.sectioning.disableSection();
    }

    getNavMode() {
        return this._navMode;
    }

    setNavMode(mode) {
        this._navMode = mode;
        if (this.selection) {
            this.selection.setActive(mode === 'select');
        }
    }

    toggleProjection() {
        this._projectionMode = this._projectionMode === 'perspective' ? 'orthographic' : 'perspective';
        const next = this._projectionMode === 'perspective' ? this._perspCamera : this._orthoCamera;
        if (next && this.camera) {
            next.position.copy(this.camera.position);
            next.up.copy(this.camera.up);
            if (this.controls) {
                next.lookAt(this.controls.target);
                this.controls.object = next;
            }
            this.camera = next;
            this.camera.updateProjectionMatrix();
        }
    }

    snapToPreset(preset) {
        if (!this._componentGroup) return;
        const box = new THREE.Box3().setFromObject(this._componentGroup);
        if (box.isEmpty()) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim * 1.5;

        const positions = {
            isoNW: new THREE.Vector3(-dist, dist, -dist),
            isoNE: new THREE.Vector3(dist, dist, -dist),
            isoSW: new THREE.Vector3(-dist, dist, dist),
            isoSE: new THREE.Vector3(dist, dist, dist)
        };

        const pos = positions[preset] || positions.isoSE;

        this.camera.position.copy(center).add(pos);
        this.camera.lookAt(center);
        if (this.controls) {
             this.controls.target.copy(center);
             this.controls.update();
        }
    }

    clearSelection() {
        this.selection.clearSelection();
    }

    // Recommended Additions

    isolateSelection() {
        const selectedIds = this.selection.getSelectedCanonicalIds();
        if (selectedIds.length > 0) {
            this.visibility.isolate(selectedIds);
        }
    }

    showAll() {
        this.visibility.showAll();
    }

    selectByCanonicalId(id) {
        this.selection.selectByCanonicalId(id);
    }

    getSelection() {
        return this.selection.getSelection(); // { canonicalObjectId: ..., renderObjectIds: [...] }
    }

    setSavedView(view) {
        if (!view) return;
        // Restore view properties...
        if (view.camera) {
            this.camera.position.copy(view.camera.position || this.camera.position);
            this.camera.quaternion.copy(view.camera.quaternion || this.camera.quaternion);
            if (this.controls && view.camera.target) {
                this.controls.target.copy(view.camera.target);
                this.controls.update();
            }
        }
        if (view.projection && view.projection !== this._projectionMode) {
             this.toggleProjection();
        }
        if (view.navMode) {
            this.setNavMode(view.navMode);
        }
        if (view.sectionState) {
            this.sectioning.restoreState(view.sectionState);
        }
        this.visibility.restoreState({ hidden: view.hiddenCanonicalObjectIds, isolated: view.isolatedCanonicalObjectIds });
        if (view.selectedCanonicalObjectId) {
             this.selectByCanonicalId(view.selectedCanonicalObjectId);
        } else {
             this.clearSelection();
        }
    }

    getSavedView() {
        return {
            camera: {
                position: this.camera.position.clone(),
                quaternion: this.camera.quaternion.clone(),
                target: this.controls.target.clone()
            },
            projection: this._projectionMode,
            navMode: this._navMode,
            sectionState: this.sectioning.getState(),
            hiddenCanonicalObjectIds: this.visibility.getHidden(),
            isolatedCanonicalObjectIds: this.visibility.getIsolated(),
            selectedCanonicalObjectId: this.selection.getSelectedCanonicalId()
        };
    }

    // Lifecycle

    dispose() {
        if (this._animId) cancelAnimationFrame(this._animId);
        window.removeEventListener('resize', this._onResize);

        if (this.controls) this.controls.dispose();
        if (this.selection) this.selection.dispose();

        if (this.scene) {
            this.scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    mats.forEach(m => {
                        if (m.map) m.map.dispose();
                        if (m.lightMap) m.lightMap.dispose();
                        if (m.bumpMap) m.bumpMap.dispose();
                        if (m.normalMap) m.normalMap.dispose();
                        if (m.specularMap) m.specularMap.dispose();
                        if (m.envMap) m.envMap.dispose();
                        m.dispose();
                    });
                }
            });
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement?.parentNode === this.container) {
                this.container.removeChild(this.renderer.domElement);
            }
        }

        if (this._css2dRenderer) {
             if (this._css2dRenderer.domElement?.parentNode === this.container) {
                  this.container.removeChild(this._css2dRenderer.domElement);
             }
        }

        // Nullify everything
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this._componentGroup = null;
        this.sectioning = null;
        this.visibility = null;
        this.selection = null;
        this._identityMap = null;
    }
}
