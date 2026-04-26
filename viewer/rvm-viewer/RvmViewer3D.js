import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { RvmSectioning } from './RvmSectioning.js';
import { RvmVisibilityController } from './RvmVisibilityController.js';
import { RvmSelectionAdapter } from './RvmSelectionAdapter.js';

export class RvmViewer3D {
    constructor(container, ctx) {
        this.container = container;
        this.ctx = ctx; // ctx might contain capabilities, identityMap, etc.

        this._disposed = false;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);

        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100000);
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);
        this.camera.up.set(0, 1, 0);

        // WebGL Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.localClippingEnabled = true; // Critical for section planes
        this.container.appendChild(this.renderer.domElement);

        // CSS2D Renderer
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(width, height);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = true;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(1, 1, 1).normalize();
        this.scene.add(dirLight);

        // The model group
        this.modelGroup = new THREE.Group();
        this.scene.add(this.modelGroup);

        // Nav mode
        this._navMode = 'orbit';

        // Modules
        this.sectioning = new RvmSectioning(this.modelGroup, this.scene, this.renderer);
        this.visibility = new RvmVisibilityController(this.modelGroup, this.ctx?.identityMap);
        this.selection = new RvmSelectionAdapter(this.modelGroup, this.camera, this.renderer.domElement, this.ctx?.identityMap);

        // Resize Observer
        this._resizeObserver = new ResizeObserver((entries) => {
            if (this._disposed) return;
            for (const entry of entries) {
                if (entry.target === this.container) {
                    this._onResize();
                }
            }
        });
        this._resizeObserver.observe(this.container);

        // Animation Loop
        this._animate = this._animate.bind(this);
        this._animationFrameId = requestAnimationFrame(this._animate);

        // Save views config
        this._savedView = null;
    }

    // ── Model Loading ──────────────────────────────────────────────────

    // We assume the model loaded is a Three.js Group/Object3D.
    // And coordinate system normalization based on upAxis.
    setModel(model, upAxis = 'Y') {
        this.modelGroup.clear();
        this.modelGroup.add(model);

        if (upAxis === 'Z') {
            // Rotate model group by -90° on X at load time
            this.modelGroup.rotation.x = -Math.PI / 2;
            this.modelGroup.updateMatrixWorld(true);
        } else {
            this.modelGroup.rotation.set(0,0,0);
            this.modelGroup.updateMatrixWorld(true);
        }

        // Initialize modules
        this.sectioning.updateModelGroup(this.modelGroup);
        this.visibility.updateModelGroup(this.modelGroup);
        this.selection.updateModelGroup(this.modelGroup);

        this.fitAll();
    }

    _onResize() {
        if (!this.container || this._disposed) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.labelRenderer.setSize(width, height);
    }

    _animate() {
        if (this._disposed) return;
        this._animationFrameId = requestAnimationFrame(this._animate);

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    // ── Command Interfaces (must satisfy dispatchViewerCommand) ────────

    fitAll() {
        if (this.modelGroup.children.length === 0) return;
        const box = new THREE.Box3().setFromObject(this.modelGroup);
        if (box.isEmpty()) return;
        this._fitBox(box);
    }

    fitSelection() {
        const selectionIds = this.selection.getSelectionRenderIds();
        if (selectionIds.length === 0) return this.fitAll();

        const box = new THREE.Box3();
        let hasObj = false;

        this.modelGroup.traverse((obj) => {
            if (obj.isMesh && obj.userData && obj.userData.name && selectionIds.includes(obj.userData.name)) {
                box.expandByObject(obj);
                hasObj = true;
            } else if (obj.isMesh && obj.name && selectionIds.includes(obj.name)) {
                box.expandByObject(obj);
                hasObj = true;
            } else if (obj.isMesh && obj.uuid && selectionIds.includes(obj.uuid)) {
                 box.expandByObject(obj);
                 hasObj = true;
            }
        });

        if (hasObj && !box.isEmpty()) {
            this._fitBox(box);
        }
    }

    _fitBox(box) {
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = maxSize / (2 * Math.atan(Math.PI * this.camera.fov / 360));
        const fitWidthDistance = fitHeightDistance / this.camera.aspect;
        const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance);

        const direction = this.controls.target.clone().sub(this.camera.position).normalize().multiplyScalar(-1);
        if(direction.lengthSq() < 0.0001) direction.set(0, 0, 1);

        this.controls.target.copy(center);
        this.camera.position.copy(center).add(direction.multiplyScalar(distance));
        this.camera.near = distance / 100;
        this.camera.far = distance * 100;
        this.camera.updateProjectionMatrix();
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
        if (mode === 'orbit') {
            this.controls.enabled = true;
            // Handle measure off, etc.
        } else {
            // e.g. measure mode
        }
    }

    toggleProjection() {
        // Perspective to Orthographic, or vice-versa.
        // Simplified: only Perspective is handled in this skeleton unless fully implemented.
        console.warn('toggleProjection not fully implemented in RvmViewer3D');
    }

    snapToPreset(preset) {
        const box = new THREE.Box3().setFromObject(this.modelGroup);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const dist = Math.max(size.x, size.y, size.z) * 1.5;

        this.controls.target.copy(center);

        switch(preset) {
            case 'TOP': this.camera.position.set(center.x, center.y + dist, center.z); break;
            case 'BOTTOM': this.camera.position.set(center.x, center.y - dist, center.z); break;
            case 'FRONT': this.camera.position.set(center.x, center.y, center.z + dist); break;
            case 'BACK': this.camera.position.set(center.x, center.y, center.z - dist); break;
            case 'LEFT': this.camera.position.set(center.x - dist, center.y, center.z); break;
            case 'RIGHT': this.camera.position.set(center.x + dist, center.y, center.z); break;
            case 'ISO_SE': this.camera.position.set(center.x + dist, center.y + dist, center.z + dist); break;
        }

        this.camera.lookAt(center);
        this.controls.update();
    }

    clearSelection() {
        this.selection.clearSelection();
    }

    // ── Recommended Additions ──────────────────────────────────────────

    isolateSelection() {
        const selectedRenderIds = this.selection.getSelectionRenderIds();
        if (selectedRenderIds.length === 0) return;
        this.visibility.isolateByRenderIds(selectedRenderIds);
    }

    showAll() {
        this.visibility.showAll();
    }

    selectByCanonicalId(id) {
        this.selection.selectByCanonicalId(id);
    }

    getSelection() {
        return {
            canonicalObjectId: this.selection.getSelectedCanonicalId(),
            renderObjectIds: this.selection.getSelectionRenderIds()
        };
    }

    setSavedView(view) {
        this._savedView = view;
        // Apply camera
        if (view.camera && view.camera.position) {
            this.camera.position.copy(view.camera.position);
            this.controls.target.copy(view.camera.target);
            this.controls.update();
        }
        // Apply section state
        if (view.sectionState && view.sectionState.mode) {
            this.setSectionMode(view.sectionState.mode);
        } else {
            this.disableSection();
        }
        // Apply hidden/isolated
        if (view.isolatedCanonicalObjectIds && view.isolatedCanonicalObjectIds.length > 0) {
            this.visibility.isolate(view.isolatedCanonicalObjectIds);
        } else if (view.hiddenCanonicalObjectIds && view.hiddenCanonicalObjectIds.length > 0) {
             this.visibility.hide(view.hiddenCanonicalObjectIds);
        } else {
            this.visibility.showAll();
        }
        // Apply selection
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
                target: this.controls.target.clone()
            },
            navMode: this._navMode,
            sectionState: this.sectioning.getSectionState(),
            hiddenCanonicalObjectIds: this.visibility.getHiddenCanonicalIds(),
            isolatedCanonicalObjectIds: this.visibility.getIsolatedCanonicalIds(),
            selectedCanonicalObjectId: this.selection.getSelectedCanonicalId()
        };
    }

    dispose() {
        this._disposed = true;
        cancelAnimationFrame(this._animationFrameId);

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        // Dispose Three.js objects
        this.scene.traverse((object) => {
            if (object.isMesh) {
                object.geometry.dispose();
                if (object.material) {
                    const materials = Array.isArray(object.material) ? object.material : [object.material];
                    materials.forEach(m => {
                        for (const key in m) {
                            if (m[key] && m[key].isTexture) {
                                m[key].dispose();
                            }
                        }
                        m.dispose();
                    });
                }
            }
        });

        this.controls.dispose();
        this.renderer.dispose();

        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        if (this.labelRenderer.domElement.parentNode) {
            this.labelRenderer.domElement.parentNode.removeChild(this.labelRenderer.domElement);
        }

        this.sectioning.dispose();
        this.visibility.dispose();
        this.selection.dispose();

        // Nullify internal refs
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.modelGroup = null;
        this.container = null;

        // Disposal contract explicitly requested these nullifications
        this.searchIndex = null;
        this.tagStore = null;
        this.workerBridges = null;
        this.pendingLoadTasks = null;
    }
}
