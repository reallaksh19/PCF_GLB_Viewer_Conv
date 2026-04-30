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

        // Marquee Zoom
        this.marqueeModeEnabled = false;
        this.marqueeElement = document.createElement('div');
        this.marqueeElement.style.position = 'absolute';
        this.marqueeElement.style.border = '1px dashed #fff';
        this.marqueeElement.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        this.marqueeElement.style.pointerEvents = 'none';
        this.marqueeElement.style.display = 'none';
        this.container.appendChild(this.marqueeElement);
        this.isMarqueeDragging = false;
        this.marqueeStart = { x: 0, y: 0 };
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this.container.addEventListener('pointerdown', this._onPointerDown);
        this.container.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);

        // Measurement Tool
        this.measureModeEnabled = false;
        this.measurePoints = [];
        this.measureLine = null;
        this.measureLabels = [];
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this._onCanvasClick = this._onCanvasClick.bind(this);
        this.container.addEventListener('click', this._onCanvasClick);

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



    _onPointerDown(event) {
        if (!this.marqueeModeEnabled) return;
        if (event.button !== 0) return; // Only left click
        this.isMarqueeDragging = true;
        const rect = this.container.getBoundingClientRect();
        this.marqueeStart.x = event.clientX - rect.left;
        this.marqueeStart.y = event.clientY - rect.top;
        this.marqueeElement.style.left = this.marqueeStart.x + 'px';
        this.marqueeElement.style.top = this.marqueeStart.y + 'px';
        this.marqueeElement.style.width = '0px';
        this.marqueeElement.style.height = '0px';
        this.marqueeElement.style.display = 'block';
    }

    _onPointerMove(event) {
        if (!this.isMarqueeDragging) return;
        const rect = this.container.getBoundingClientRect();
        const currentX = event.clientX - rect.left;
        const currentY = event.clientY - rect.top;

        const left = Math.min(this.marqueeStart.x, currentX);
        const top = Math.min(this.marqueeStart.y, currentY);
        const width = Math.abs(currentX - this.marqueeStart.x);
        const height = Math.abs(currentY - this.marqueeStart.y);

        this.marqueeElement.style.left = left + 'px';
        this.marqueeElement.style.top = top + 'px';
        this.marqueeElement.style.width = width + 'px';
        this.marqueeElement.style.height = height + 'px';
    }

    _onPointerUp(event) {
        if (!this.isMarqueeDragging) return;
        this.isMarqueeDragging = false;
        this.marqueeElement.style.display = 'none';

        const rect = this.container.getBoundingClientRect();
        const endX = event.clientX - rect.left;
        const endY = event.clientY - rect.top;

        const width = Math.abs(endX - this.marqueeStart.x);
        const height = Math.abs(endY - this.marqueeStart.y);

        // Ignore small clicks
        if (width < 5 || height < 5) return;

        const minX = Math.min(this.marqueeStart.x, endX);
        const maxX = Math.max(this.marqueeStart.x, endX);
        const minY = Math.min(this.marqueeStart.y, endY);
        const maxY = Math.max(this.marqueeStart.y, endY);

        // Convert 2D rect to frustum points on an arbitrary plane to find bounding sphere
        // For a true marquee zoom, we want to set the camera such that these screen coordinates map to the viewport edges.
        // A simpler robust approach: cast rays from the 4 corners, find intersections, get bounding box of those points, and fit it.

        const corners = [
            { x: (minX / rect.width) * 2 - 1, y: -(minY / rect.height) * 2 + 1 }, // Top Left
            { x: (maxX / rect.width) * 2 - 1, y: -(minY / rect.height) * 2 + 1 }, // Top Right
            { x: (maxX / rect.width) * 2 - 1, y: -(maxY / rect.height) * 2 + 1 }, // Bottom Right
            { x: (minX / rect.width) * 2 - 1, y: -(maxY / rect.height) * 2 + 1 }  // Bottom Left
        ];

        const intersectPoints = [];
        for (const corner of corners) {
            this.raycaster.setFromCamera(corner, this.camera);
            const intersects = this.raycaster.intersectObjects(this.scene.children, true);
            const valid = intersects.find(i => i.object.type === 'Mesh' || i.object.type === 'Line');
            if (valid) {
                intersectPoints.push(valid.point);
            }
        }

        if (intersectPoints.length > 0) {
            const box = new THREE.Box3();
            for (const pt of intersectPoints) {
                box.expandByPoint(pt);
            }

            // Add some padding
            const center = new THREE.Vector3();
            box.getCenter(center);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            box.expandByScalar(maxDim * 0.1);

            this._fitBox(box);
        } else {
             // Fallback if no geometry was intersected: just move the camera forward
             this.controls.target.add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
             this.camera.position.add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
             this.controls.update();
        }
    }

    _fitBox(box) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));

        // Adjust for aspect ratio
        cameraZ /= Math.min(1, this.camera.aspect);

        const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(cameraZ);
        this.camera.position.copy(center).add(offset);
        this.camera.lookAt(center);
        this.controls.target.copy(center);
        this.controls.update();
    }
_onCanvasClick(event) {
        if (!this.measureModeEnabled) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        // Filter out helper objects
        const validIntersects = intersects.filter(i => i.object.type === 'Mesh' || i.object.type === 'Line');

        if (validIntersects.length > 0) {
            const point = validIntersects[0].point;
            this.measurePoints.push(point);

            if (this.measurePoints.length === 1) {
                // First point selected, show a marker
                this._createMeasureMarker(point, "P1");
            } else if (this.measurePoints.length === 2) {
                // Second point selected, draw line and distance
                this._createMeasureMarker(point, "P2");
                this._drawMeasureLine(this.measurePoints[0], this.measurePoints[1]);
            } else {
                // Reset and start over
                this.clearMeasurement();
                this.measurePoints.push(point);
                this._createMeasureMarker(point, "P1");
            }
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        }
    }

    _createMeasureMarker(point, text) {
        const div = document.createElement('div');
        div.className = 'rvm-measure-label';
        div.textContent = text;
        div.style.background = '#222';
        div.style.color = '#fff';
        div.style.padding = '2px 4px';
        div.style.borderRadius = '3px';
        div.style.fontSize = '10px';
        div.style.pointerEvents = 'none';

        let label;
        if (typeof CSS2DObject !== 'undefined') {
            label = new CSS2DObject(div);
        } else if (window.THREE && window.THREE.CSS2DObject) {
            label = new window.THREE.CSS2DObject(div);
        }

        if (label) {
            label.position.copy(point);
            this.scene.add(label);
            this.measureLabels.push(label);
        }
    }

    _drawMeasureLine(p1, p2) {
        const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2, depthTest: false });
        this.measureLine = new THREE.Line(geometry, material);
        this.scene.add(this.measureLine);

        const dist = p1.distanceTo(p2);

        // Midpoint label
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        this._createMeasureMarker(mid, `${dist.toFixed(3)} m`);
    }

    clearMeasurement() {
        if (this.measureLine) {
            this.scene.remove(this.measureLine);
            if(this.measureLine.geometry) this.measureLine.geometry.dispose();
            if(this.measureLine.material) this.measureLine.material.dispose();
            this.measureLine = null;
        }
        for (const label of this.measureLabels) {
            this.scene.remove(label);
        }
        this.measureLabels = [];
        this.measurePoints = [];
    }
getNavMode() {
        return this._navMode;
    }

    setNavMode(mode) {
        this._navMode = mode;
        if (mode === 'orbit') {
            this.controls.enabled = true;
            this.measureModeEnabled = false;
            this.clearMeasurement();
        } else if (mode === 'pan') {
            this.controls.enabled = true;
            this.measureModeEnabled = false;
            this.clearMeasurement();
        } else if (mode === 'select') {
            this.controls.enabled = true;
            this.measureModeEnabled = false;
            this.clearMeasurement();
        } else if (mode === 'Measure') {
            this.controls.enabled = false;
            this.measureModeEnabled = true;
            this.marqueeModeEnabled = false;
        } else if (mode === 'Zoom') {
            this.controls.enabled = false;
            this.measureModeEnabled = false;
            this.marqueeModeEnabled = true;
            this.clearMeasurement();
        } else {
            this.controls.enabled = true;
            this.measureModeEnabled = false;
            this.marqueeModeEnabled = false;
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
        this.container.removeEventListener('click', this._onCanvasClick);
        this.container.removeEventListener('pointerdown', this._onPointerDown);
        this.container.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        if (this.marqueeElement && this.marqueeElement.parentNode) {
            this.marqueeElement.parentNode.removeChild(this.marqueeElement);
        }
        this.clearMeasurement();
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
