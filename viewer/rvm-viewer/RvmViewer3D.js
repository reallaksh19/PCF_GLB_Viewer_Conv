import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

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
        this.perspCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100000);
        this.perspCamera.position.set(100, 100, 100);
        this.perspCamera.lookAt(0, 0, 0);
        this.perspCamera.up.set(0, 1, 0);

        // Orthographic Camera setup
        const aspect = width / height;
        const frustumSize = 1000;
        this.orthoCamera = new THREE.OrthographicCamera(
            -frustumSize * aspect / 2, frustumSize * aspect / 2,
            frustumSize / 2, -frustumSize / 2,
            0.1, 100000
        );
        this.orthoCamera.position.set(100, 100, 100);
        this.orthoCamera.lookAt(0, 0, 0);
        this.orthoCamera.up.set(0, 1, 0);

        this.camera = this.perspCamera;
        this._isOrthographic = false;

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

        // Pointer events for tools
        this._bindToolEvents();
    }

    _hoveredMesh = null;
    _hoveredOriginalEmissive = null;

    _clearMeasure() {
        if (this._measureLine) {
            this.scene.remove(this._measureLine);
            this._measureLine = null;
        }
        if (this._measureLabel) {
            this.scene.remove(this._measureLabel);
            this._measureLabel = null;
        }
    }

    _bindToolEvents() {
        let isDragging = false;
        let startPoint = { x: 0, y: 0 };
        let marqueeBox = null;

        let measureStart = null;

        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            if (this._navMode === 'zoom' && e.button === 0) {
                isDragging = true;
                startPoint = { x: e.offsetX, y: e.offsetY };
                marqueeBox = document.createElement('div');
                marqueeBox.style.cssText = `position: absolute; border: 2px dashed #4a9eff; background: rgba(74, 158, 255, 0.2); left: ${startPoint.x}px; top: ${startPoint.y}px; width: 0; height: 0; pointer-events: none;`;
                this._toolsOverlay.appendChild(marqueeBox);
                this.controls.enabled = false;
            }

            if (this._navMode === 'measure' && e.button === 0) {
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2(
                    (e.offsetX / this.container.clientWidth) * 2 - 1,
                    -(e.offsetY / this.container.clientHeight) * 2 + 1
                );
                raycaster.setFromCamera(mouse, this.camera);
                const intersects = raycaster.intersectObject(this.modelGroup, true);

                if (intersects.length > 0) {
                    const pt = intersects[0].point;
                    if (!measureStart) {
                        this._clearMeasure();
                        measureStart = pt;
                    } else {
                        const dist = measureStart.distanceTo(pt);

                        const geom = new THREE.BufferGeometry().setFromPoints([measureStart, pt]);
                        const mat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2, depthTest: false });
                        this._measureLine = new THREE.Line(geom, mat);
                        this._measureLine.renderOrder = 999;
                        this.scene.add(this._measureLine);

                        const div = document.createElement('div');
                        div.className = 'rvm-measure-label';
                        div.style.cssText = 'background: rgba(0,0,0,0.8); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; pointer-events: none; border: 1px solid #ff0000;';
                        div.textContent = dist.toFixed(3) + ' m';

                        // Support for CSS2DObject
                        if (typeof CSS2DObject !== 'undefined') {
                            this._measureLabel = new CSS2DObject(div);
                        } else if (window.THREE && window.THREE.CSS2DObject) {
                            this._measureLabel = new window.THREE.CSS2DObject(div);
                        } else {
                            this._measureLabel = new THREE.Object3D();
                            this._measureLabel.isCSS2DObject = true;
                        }

                        if (this._measureLabel) {
                            const mid = measureStart.clone().lerp(pt, 0.5);
                            this._measureLabel.position.copy(mid);
                            this.scene.add(this._measureLabel);
                        }

                        measureStart = null;
                    }
                }
            }
        });

        this.renderer.domElement.addEventListener('pointermove', (e) => {
            if (isDragging && marqueeBox && this._navMode === 'zoom') {
                const currentPoint = { x: e.offsetX, y: e.offsetY };
                const left = Math.min(startPoint.x, currentPoint.x);
                const top = Math.min(startPoint.y, currentPoint.y);
                const width = Math.abs(currentPoint.x - startPoint.x);
                const height = Math.abs(currentPoint.y - startPoint.y);
                marqueeBox.style.left = left + 'px';
                marqueeBox.style.top = top + 'px';
                marqueeBox.style.width = width + 'px';
                marqueeBox.style.height = height + 'px';
            }

            // Interactive Hover
            if (!isDragging && this._navMode !== 'zoom' && this._navMode !== 'measure') {
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2(
                    (e.offsetX / this.container.clientWidth) * 2 - 1,
                    -(e.offsetY / this.container.clientHeight) * 2 + 1
                );
                raycaster.setFromCamera(mouse, this.camera);
                const intersects = raycaster.intersectObject(this.modelGroup, true);

                if (intersects.length > 0) {
                    const mesh = intersects[0].object;
                    if (this._hoveredMesh !== mesh) {
                        if (this._hoveredMesh && this._hoveredMesh.material && this._hoveredMesh.material.emissive) {
                            this._hoveredMesh.material.emissive.setHex(this._hoveredOriginalEmissive);
                        }
                        this._hoveredMesh = mesh;
                        if (mesh.material && mesh.material.emissive) {
                            this._hoveredOriginalEmissive = mesh.material.emissive.getHex();
                            mesh.material.emissive.setHex(0x555555); // Highlight
                        }
                    }
                } else if (this._hoveredMesh) {
                    if (this._hoveredMesh.material && this._hoveredMesh.material.emissive) {
                        this._hoveredMesh.material.emissive.setHex(this._hoveredOriginalEmissive);
                    }
                    this._hoveredMesh = null;
                }
            }
        });

        this.renderer.domElement.addEventListener('pointerup', (e) => {
            if (this._navMode === 'zoom' && isDragging) {
                isDragging = false;
                if (marqueeBox) {
                    const width = parseInt(marqueeBox.style.width) || 0;
                    const height = parseInt(marqueeBox.style.height) || 0;

                    this._toolsOverlay.removeChild(marqueeBox);
                    marqueeBox = null;

                    if (width > 10 && height > 10) {
                        const canvasWidth = this.container.clientWidth;
                        const canvasHeight = this.container.clientHeight;
                        const zoomFactorX = canvasWidth / width;
                        const zoomFactorY = canvasHeight / height;
                        const zoomFactor = Math.min(zoomFactorX, zoomFactorY);

                        const boxCenter = new THREE.Vector2(
                            ((startPoint.x + e.offsetX) / 2 / canvasWidth) * 2 - 1,
                            -((startPoint.y + e.offsetY) / 2 / canvasHeight) * 2 + 1
                        );

                        const raycaster = new THREE.Raycaster();
                        raycaster.setFromCamera(boxCenter, this.camera);

                        // Move camera forward along ray by a factor related to the area
                        const dist = this.camera.position.distanceTo(this.controls.target);
                        const forwardDist = dist * (1 - 1/zoomFactor);

                        this.camera.position.addScaledVector(raycaster.ray.direction, forwardDist);
                        this.controls.target.addScaledVector(raycaster.ray.direction, forwardDist);
                        this.controls.update();
                    }
                    this.setNavMode('orbit'); // Auto exit tool
                }
            }
        });

        this.renderer.domElement.addEventListener('dblclick', (e) => {
            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2(
                (e.offsetX / this.container.clientWidth) * 2 - 1,
                -(e.offsetY / this.container.clientHeight) * 2 + 1
            );
            raycaster.setFromCamera(mouse, this.camera);
            const intersects = raycaster.intersectObject(this.modelGroup, true);

            if (intersects.length > 0) {
                const object = intersects[0].object;
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                this.controls.target.copy(center);

                const maxDim = Math.max(size.x, size.y, size.z, 1.0); // Fallback if size is 0
                const fitHeightDistance = maxDim / (2 * Math.tan(Math.PI * this.camera.fov / 360));
                const fitWidthDistance = fitHeightDistance / this.camera.aspect;
                const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.5;

                const direction = this.controls.target.clone().sub(this.camera.position).normalize().multiplyScalar(-distance);
                this.camera.position.copy(this.controls.target).add(direction);

                this.controls.update();
            }
        });
    }

    // ── Model Loading ──────────────────────────────────────────────────

    // We assume the model loaded is a Three.js Group/Object3D.

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


        if (this._isOrthographic) {
            const aspect = width / height;
            const frustumSize = (this.orthoCamera.top - this.orthoCamera.bottom); // roughly maintain height
            this.orthoCamera.left = -frustumSize * aspect / 2;
            this.orthoCamera.right = frustumSize * aspect / 2;
            this.orthoCamera.top = frustumSize / 2;
            this.orthoCamera.bottom = -frustumSize / 2;
            this.orthoCamera.updateProjectionMatrix();
        } else {
            this.perspCamera.aspect = width / height;
            this.perspCamera.updateProjectionMatrix();
        }
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
        let fitHeightDistance;
        if (this._isOrthographic) {
            fitHeightDistance = maxSize * 1.2;
        } else {
            fitHeightDistance = maxSize / (2 * Math.atan(Math.PI * this.camera.fov / 360));
        }
        const aspect = this._isOrthographic ? (this.orthoCamera.right - this.orthoCamera.left) / (this.orthoCamera.top - this.orthoCamera.bottom) : this.perspCamera.aspect;
        const fitWidthDistance = fitHeightDistance / aspect;
        const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance);

        const direction = this.controls.target.clone().sub(this.camera.position).normalize().multiplyScalar(-1);
        if(direction.lengthSq() < 0.0001) direction.set(0, 0, 1);

        this.controls.target.copy(center);
        this.camera.position.copy(center).add(direction.multiplyScalar(distance));

        if (this._isOrthographic) {
            this.orthoCamera.left = -distance * aspect / 2;
            this.orthoCamera.right = distance * aspect / 2;
            this.orthoCamera.top = distance / 2;
            this.orthoCamera.bottom = -distance / 2;
        }
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
        this._isOrthographic = !this._isOrthographic;

        const oldCamera = this.camera;
        this.camera = this._isOrthographic ? this.orthoCamera : this.perspCamera;

        this.camera.position.copy(oldCamera.position);
        this.camera.quaternion.copy(oldCamera.quaternion);

        if (this._isOrthographic) {
            // Estimate frustum size based on distance to target to keep apparent size roughly similar
            const distance = this.controls.target.distanceTo(this.perspCamera.position);
            const fov = this.perspCamera.fov * Math.PI / 180;
            const frustumHeight = 2 * distance * Math.tan(fov / 2);
            const aspect = this.container.clientWidth / this.container.clientHeight;

            this.orthoCamera.left = -frustumHeight * aspect / 2;
            this.orthoCamera.right = frustumHeight * aspect / 2;
            this.orthoCamera.top = frustumHeight / 2;
            this.orthoCamera.bottom = -frustumHeight / 2;
        }

        this.camera.updateProjectionMatrix();

        this.controls.object = this.camera;
        this.controls.update();
        this.selection._camera = this.camera; // update selection camera
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
            case 'ISO_NW': this.camera.position.set(center.x - dist, center.y + dist, center.z - dist); break;
            case 'ISO_NE': this.camera.position.set(center.x + dist, center.y + dist, center.z - dist); break;
            case 'ISO_SW': this.camera.position.set(center.x - dist, center.y + dist, center.z + dist); break;
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

    getCameraState() {
        return {
            position: this.camera.position.clone(),
            target: this.controls.target.clone()
        };
    }

    setCameraState(state) {
        if (!state) return;
        if (state.position) this.camera.position.copy(state.position);
        if (state.target) this.controls.target.copy(state.target);
        this.controls.update();
    }

    addTag(tag) {
        if (!tag || !tag.worldPosition) return;
        const div = document.createElement('div');
        div.className = 'rvm-tag-label';
        div.textContent = tag.text || tag.id;
        div.dataset.tagId = tag.id;

        // Use global CSS2DObject constructor if available, else omit (e.g. headless tests)
        if (typeof CSS2DObject !== 'undefined') {
            const label = new CSS2DObject(div);
            label.position.set(tag.worldPosition.x, tag.worldPosition.y, tag.worldPosition.z);
            label.name = `TAG_${tag.id}`;
            this.scene.add(label);
        } else if (window.THREE && window.THREE.CSS2DObject) {
            const label = new window.THREE.CSS2DObject(div);
            label.position.set(tag.worldPosition.x, tag.worldPosition.y, tag.worldPosition.z);
            label.name = `TAG_${tag.id}`;
            this.scene.add(label);
        } else {
            // Stub for node environments
            const label = new THREE.Object3D();
            label.position.set(tag.worldPosition.x, tag.worldPosition.y, tag.worldPosition.z);
            label.name = `TAG_${tag.id}`;
            label.isCSS2DObject = true;
            this.scene.add(label);
        }
    }

    removeTag(tagId) {
        const obj = this.scene.getObjectByName(`TAG_${tagId}`);
        if (obj) {
            this.scene.remove(obj);
        }
    }

    jumpToTag(tagId) {
        if (!this.tagStore) return;
        const tag = this.tagStore.getTag(tagId);
        if (tag && tag.cameraState) {
            this.setCameraState(tag.cameraState);
        }
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
        this.perspCamera = null;
        this.orthoCamera = null;
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
