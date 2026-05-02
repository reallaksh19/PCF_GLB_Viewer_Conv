/**
 * viewer-3d.js — Three.js 3D visualization of PCF components (vanilla JS)
 * Ported from 3Dmodelgeneratorforpcf_Viewer.jsx (React/R3F) to raw Three.js.
 *
 * Exports:
 *   PcfViewer3D class
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EditorCore } from '../editor/core/EditorCore.js';

// ── Color palette ──────────────────────────────────────────────────
const COLORS = {
    PIPE: 0x1e90ff,  // Dodger Blue
    FLANGE: 0xff4500,  // Orange Red
    VALVE: 0x32cd32,  // Lime Green
    TEE: 0xffd700,  // Gold
    ELBOW: 0x8a2be2,  // Blue Violet
    SUPPORT: 0x808080,  // Grey
    ANCI: 0x808080,
    BEND: 0x8a2be2,
    REDUCER: 0xff69b4,  // Hot Pink
    UNKNOWN: 0xd3d3d3,  // Light Grey
};

// ── Coordinate mapping (PCF → Three.js) ────────────────────────────
// PCF: X=East, Y=North, Z=Up
// Three: X=right, Y=up, Z=towards viewer
const mapCoord = (p) => {
    if (!p) return null;
    return new THREE.Vector3(-p.y, p.z, -p.x);
};

// ── Cylinder helper ────────────────────────────────────────────────
function createCylinder(startVec, endVec, radius, color) {
    const diff = new THREE.Vector3().subVectors(endVec, startVec);
    const length = diff.length();
    if (length < 0.1) return null;

    const mid = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const axis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(axis, diff.clone().normalize());

    const geo = new THREE.CylinderGeometry(radius, radius, length, 16);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.copy(quat);
    return mesh;
}

// ── Disc (flat cylinder) helper ────────────────────────────────────
function createDisc(pos, normal, outerRadius, thickness, color) {
    const geo = new THREE.CylinderGeometry(outerRadius, outerRadius, thickness, 20);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    // Align cylinder Y-axis to normal
    const axis = new THREE.Vector3(0, 1, 0);
    mesh.quaternion.setFromUnitVectors(axis, normal.clone().normalize());
    return mesh;
}

function createSphere(pos, radius, color) {
    const geo = new THREE.SphereGeometry(radius, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    return mesh;
}

// ── Box (for fixed support) helper ─────────────────────────────────
function createBox(pos, hw, color, wireframe = false) {
    const geo = new THREE.BoxGeometry(hw, hw, hw);
    const mat = wireframe
        ? new THREE.MeshBasicMaterial({ color, wireframe: true })
        : new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    return mesh;
}

// ── Main class ─────────────────────────────────────────────────────

export class PcfViewer3D {
    /**
     * @param {HTMLElement} containerEl — DOM element to render into
     */
    constructor(containerEl) {
        this.container = containerEl;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this._animId = null;
        this._componentGroup = null;
        this.editor = null;

        this._init();

        // Initialize Editor Addon
        this.editor = new EditorCore(this);
    }

    /** @private */
    _init() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1c2030);

        // Camera — Orthographic
        const aspect = w / h;
        const frustum = 5000;
        this.camera = new THREE.OrthographicCamera(
            -frustum * aspect, frustum * aspect,
            frustum, -frustum,
            -50000, 50000
        );
        this.camera.position.set(5000, 5000, 5000);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Controls (OrbitControls loaded via importmap)
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        // C3: Refresh clipping planes on every orbit/pan so geometry never disappears
        this.controls.addEventListener('change', () => {
            if (this._componentGroup) {
                const box = new THREE.Box3().setFromObject(this._componentGroup);
                if (!box.isEmpty()) {
                    const sz = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(sz.x, sz.y, sz.z, 1);
                    this.camera.near = -maxDim * 20;
                    this.camera.far = maxDim * 20;
                    this.camera.updateProjectionMatrix();
                }
            }
        });

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        const point = new THREE.PointLight(0xffffff, 0.8);
        point.position.set(2000, 4000, 2000);
        this.scene.add(point);

        const dir = new THREE.DirectionalLight(0xffffff, 1.0);
        dir.position.set(-1000, 5000, -2000);
        this.scene.add(dir);

        // Grid + Axes
        const grid = new THREE.GridHelper(10000, 20, 0x3a4255, 0x252a3a);
        grid.position.y = -500;
        this.scene.add(grid);

        const axes = new THREE.AxesHelper(1000);
        this.scene.add(axes);

        // Resize handler
        this._onResize = () => {
            const nw = this.container.clientWidth;
            const nh = this.container.clientHeight;
            const nAspect = nw / nh;
            this.camera.left = -frustum * nAspect;
            this.camera.right = frustum * nAspect;
            this.camera.top = frustum;
            this.camera.bottom = -frustum;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(nw, nh);
        };
        window.addEventListener('resize', this._onResize);

        // ViewCube (top-right) and Axis Gizmo (bottom-right)
        this._buildViewCube();
        this._buildAxisGizmo();

        // Start render loop
        this._animate();
    }

    /** @private */
    _animate() {
        this._animId = requestAnimationFrame(() => this._animate());
        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this._syncViewCube();
        this._syncAxisGizmo();
    }

    /** @private — Build HTML ViewCube overlay in top-right */
    _buildViewCube() {
        const size = 90;
        const cube = document.createElement('div');
        cube.id = 'pcf-view-cube';
        cube.style.cssText = `
            position:absolute;top:12px;right:12px;width:${size}px;height:${size}px;
            perspective:200px;cursor:pointer;user-select:none;z-index:10;
        `;
        const inner = document.createElement('div');
        inner.style.cssText = `
            width:100%;height:100%;position:relative;transform-style:preserve-3d;
            transition:transform 0.05s linear;
        `;
        const half = size / 2;
        const FACES = [
            { label: 'Top', rot: 'rotateX(-90deg)', bg: '#3b6ea5', cam: [0, 1, 0], up: [0, 0, -1] },
            { label: 'Bottom', rot: 'rotateX(90deg)', bg: '#2b5285', cam: [0, -1, 0], up: [0, 0, 1] },
            { label: 'Front', rot: 'translateZ(' + half + 'px)', bg: '#4a7c95', cam: [0, 0, 1], up: [0, 1, 0] },
            { label: 'Back', rot: 'rotateY(180deg) translateZ(' + half + 'px)', bg: '#4a7c95', cam: [0, 0, -1], up: [0, 1, 0] },
            { label: 'Right', rot: 'rotateY(90deg) translateZ(' + half + 'px)', bg: '#3a6e85', cam: [1, 0, 0], up: [0, 1, 0] },
            { label: 'Left', rot: 'rotateY(-90deg) translateZ(' + half + 'px)', bg: '#3a6e85', cam: [-1, 0, 0], up: [0, 1, 0] },
        ];
        for (const f of FACES) {
            const face = document.createElement('div');
            face.textContent = f.label;
            face.style.cssText = `
                position:absolute;width:${size}px;height:${size}px;
                display:flex;align-items:center;justify-content:center;
                font-size:11px;font-weight:700;color:#fff;background:${f.bg}cc;
                border:1px solid #ffffff33;box-sizing:border-box;
                transform:${f.rot};
                backface-visibility:visible;
            `;
            face.addEventListener('click', () => this._snapCamera(f.cam, f.up));
            inner.appendChild(face);
        }
        // Corners (8 isometric views) on the ViewCube
        const CORNERS = [
            { id: 'NE-Top', style: 'top:0;right:0', cam: [1, 1, -1], up: [0, 1, 0], label: '⬡' },
            { id: 'NW-Top', style: 'top:0;left:0', cam: [-1, 1, -1], up: [0, 1, 0], label: '⬡' },
            { id: 'SE-Top', style: 'top:0;right:0', cam: [1, 1, 1], up: [0, 1, 0], label: '⬡' },
            { id: 'SW-Top', style: 'top:0;left:0', cam: [-1, 1, 1], up: [0, 1, 0], label: '⬡' },
            { id: 'NE-Bot', style: 'bottom:0;right:0', cam: [1, -1, -1], up: [0, 1, 0], label: '⬡' },
            { id: 'NW-Bot', style: 'bottom:0;left:0', cam: [-1, -1, -1], up: [0, 1, 0], label: '⬡' },
            { id: 'SE-Bot', style: 'bottom:0;right:0', cam: [1, -1, 1], up: [0, 1, 0], label: '⬡' },
            { id: 'SW-Bot', style: 'bottom:0;left:0', cam: [-1, -1, 1], up: [0, 1, 0], label: '⬡' },
        ];
        // 4 unique positions (each corner of the square)
        const cornerPositions = [
            { style: 'top:-8px;right:-8px', cam: [1, 1, -1], up: [0, 1, 0] },
            { style: 'top:-8px;left:-8px', cam: [-1, 1, -1], up: [0, 1, 0] },
            { style: 'bottom:-8px;right:-8px', cam: [1, -1, 1], up: [0, 1, 0] },
            { style: 'bottom:-8px;left:-8px', cam: [-1, -1, 1], up: [0, 1, 0] },
        ];
        for (const cp of cornerPositions) {
            const corner = document.createElement('div');
            corner.title = 'ISO view';
            corner.style.cssText = `
                position:absolute;${cp.style};width:16px;height:16px;
                background:#ffffff22;border:1px solid #ffffff55;border-radius:50%;
                cursor:pointer;z-index:12;display:flex;align-items:center;justify-content:center;
                font-size:8px;color:#fff;
            `;
            corner.textContent = '◆';
            corner.addEventListener('click', (e) => { e.stopPropagation(); this._snapCamera(cp.cam, cp.up); });
            cube.appendChild(corner);
        }
        this._viewCubeInner = inner;
        // Ensure container is positioned
        if (getComputedStyle(this.container).position === 'static') {
            this.container.style.position = 'relative';
        }
        this.container.appendChild(cube);
    }

    /** Re-centre camera on geometry — public, called by UI Centre button */
    fitCamera() { this._fitCamera(); }

    /** @private — Snap camera to axis-aligned view */
    _snapCamera([cx, cy, cz], [ux, uy, uz]) {
        if (!this.controls) return;
        const box = new THREE.Box3();
        if (this._componentGroup) box.setFromObject(this._componentGroup);
        const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const size = box.isEmpty() ? 5000 : Math.max(...box.getSize(new THREE.Vector3()).toArray()) * 1.5;
        this.camera.position.set(
            centre.x + cx * size,
            centre.y + cy * size,
            centre.z + cz * size
        );
        this.camera.up.set(ux, uy, uz);
        this.camera.lookAt(centre);
        this.camera.updateProjectionMatrix();
        this.controls.target.copy(centre);
        this.controls.update();
    }

    /** @private — Sync ViewCube rotation with camera */
    _syncViewCube() {
        if (!this._viewCubeInner || !this.camera) return;
        const q = this.camera.quaternion;
        this._viewCubeInner.style.transform =
            `matrix3d(${new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()).elements.join(',')})`;
    }

    /** @private — Build axis gizmo in bottom-right */
    _buildAxisGizmo() {
        const container = document.createElement('div');
        container.id = 'pcf-axis-gizmo';
        container.style.cssText = `
            position:absolute;bottom:12px;right:12px;width:80px;height:80px;
            z-index:10;pointer-events:none;
        `;
        const canvas = document.createElement('canvas');
        canvas.width = 80; canvas.height = 80;
        container.appendChild(canvas);
        this.container.appendChild(container);
        this._axisGizmoCtx = canvas.getContext('2d');
    }

    /** @private — Redraw axis gizmo every frame */
    _syncAxisGizmo() {
        const ctx = this._axisGizmoCtx;
        if (!ctx || !this.camera) return;
        const W = 80, H = 80, cx = W / 2, cy = H / 2, len = 28;
        ctx.clearRect(0, 0, W, H);
        const axes = [
            { dir: new THREE.Vector3(1, 0, 0), color: '#ff4444', label: 'X' },
            { dir: new THREE.Vector3(0, 1, 0), color: '#44cc44', label: 'Y' },
            { dir: new THREE.Vector3(0, 0, 1), color: '#4488ff', label: 'Z' },
        ];
        for (const { dir, color, label } of axes) {
            const proj = dir.clone().applyQuaternion(this.camera.quaternion);
            const ex = cx + proj.x * len;
            const ey = cy - proj.y * len;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(label, ex + (ex > cx ? 2 : -10), ey + (ey > cy ? 10 : -2));
        }
    }


    /** @private */
    _wireFullscreen() {
        // Fullscreen is now handled by viewer-tab.js — kept for backward compatibility
    }

    /**
     * Clear old components and render new ones.
     * @param {object[]} components — from stitcher output
     */
    render(components) {
        // Remove old component group
        if (this._componentGroup) {
            this.scene.remove(this._componentGroup);
            this._componentGroup.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        }

        this._componentGroup = new THREE.Group();
        this._lastComponentsCache = components; // Cache for radius fallback references

        for (const comp of components) {
            const meshes = this._buildComponent(comp);
            meshes.forEach(m => { if (m) this._componentGroup.add(m); });
        }

        this.scene.add(this._componentGroup);

        // Auto-fit camera if components exist
        if (components.length > 0) this._fitCamera();
    }

    /** @private */
    _buildComponent(comp) {
        const { type, points, centrePoint, branch1Point, bore, coOrds } = comp;
        const radius = (bore || 50) / 2;
        const color = COLORS[type] ?? COLORS.UNKNOWN;

        let meshes = [];

        switch (type) {
            case 'PIPE':
                meshes = this._buildPipe(points, radius, color);
                break;
            case 'ELBOW':
            case 'BEND':
                meshes = this._buildElbow(points, centrePoint, radius, color);
                break;
            case 'TEE':
                meshes = this._buildTee(points, centrePoint, branch1Point, radius, color);
                break;
            case 'SUPPORT':
            case 'ANCI': {
                const pt = coOrds || (points && points[0]);
                if (pt) {
                    const pos = mapCoord(pt);

                    // Critical Fix: Supports often have bore=0 in PCF. 
                    // This causes radius=25, which hides the support *inside* a large pipe (e.g., bore=400).
                    // We must inherit a realistic radius so the support geometry wraps outside the pipe.
                    let supportRadius = radius;
                    if (bore === 0 || !bore) {
                        let maxR = 25;
                        if (this._lastComponentsCache) {
                            for (const c of this._lastComponentsCache) {
                                if (c.bore && c.bore > maxR * 2) maxR = c.bore / 2;
                            }
                        }
                        supportRadius = maxR;
                    }
                    meshes = this._buildSupport(pos, supportRadius, comp);
                }
                break;
            }
            case 'FLANGE':
                meshes = this._buildFlange(points, radius, color);
                break;
            case 'VALVE':
                meshes = this._buildValve(points, radius, color);
                break;
            default:
                meshes = this._buildGeneric(points, radius, color, type);
        }

        // Attach Component Data to all generated meshes for picking
        meshes.forEach(m => {
            if (m) m.userData = { ...comp };
        });

        return meshes;
    }

    /** @private */
    _buildPipe(points, radius, color) {
        if (!points || points.length < 2) return [];
        const s = mapCoord(points[0]);
        const e = mapCoord(points[1]);
        const cyl = createCylinder(s, e, radius, color);
        return cyl ? [cyl] : [];
    }

    /** @private */
    _buildElbow(points, centrePoint, radius, color) {
        if (!points || points.length < 2) return [];
        const p1 = mapCoord(points[0]);
        const p2 = mapCoord(points[1]);

        // Task 3: Use strictly 1.2 * pipe_radius for the corner sphere
        const cornerRadius = radius * 1.2;

        let c = centrePoint ? mapCoord(centrePoint) : null;
        if (!c) {
            console.warn(`[Viewer3D] System Log: Centre point missing for ELBOW/BEND between ${p1.x},${p1.y},${p1.z} and ${p2.x},${p2.y},${p2.z}`);
            // If we have points and we are an elbow but miss a centre point,
            // we will fallback to a straight line.
        }

        if (c) {
            const meshes = [];
            const leg1 = createCylinder(p1, c, radius, color);
            const leg2 = createCylinder(c, p2, radius, color);
            const sphere = createSphere(c, cornerRadius, color);
            if (leg1) meshes.push(leg1);
            if (leg2) meshes.push(leg2);
            if (sphere) meshes.push(sphere);
            return meshes;
        }

        // Fallback: straight line
        const cyl = createCylinder(p1, p2, radius, color);
        return cyl ? [cyl] : [];
    }

    /** @private */
    _buildTee(points, centrePoint, branch1Point, radius, color) {
        if (!centrePoint) return this._buildGeneric(points, radius, color, 'TEE');
        const c = mapCoord(centrePoint);
        const meshes = [];

        if (points && points[0]) {
            const p1 = mapCoord(points[0]);
            const leg = createCylinder(p1, c, radius, color);
            if (leg) meshes.push(leg);
        }
        if (points && points[1]) {
            const p2 = mapCoord(points[1]);
            const leg = createCylinder(c, p2, radius, color);
            if (leg) meshes.push(leg);
        }
        if (branch1Point) {
            const b = mapCoord(branch1Point);
            const leg = createCylinder(c, b, radius * 0.8, color);
            if (leg) meshes.push(leg);
        }

        // Sphere at junction
        meshes.push(createSphere(c, radius * 1.2, color));
        return meshes;
    }

    /** @private — Flange: two thick discs + thin web between EP1 and EP2 */
    _buildFlange(points, radius, color) {
        if (!points || points.length < 2) return [];
        const s = mapCoord(points[0]);
        const e = mapCoord(points[1]);
        const diff = new THREE.Vector3().subVectors(e, s);
        const len = diff.length();
        if (len < 0.1) return [];
        const normal = diff.clone().normalize();
        const discR = radius * 2.0;    // flange rim wider than pipe
        // Disc thickness: fixed visual size (half-bore), capped so discs never exceed 40% of span.
        // This prevents stretched-disc artefacts when EP1→EP2 span is large (e.g. pass-0 raw data).
        const discT = Math.min(radius * 0.5, len * 0.4);
        const webT  = Math.max(len - discT * 2, radius * 0.1); // web fills remaining gap
        const mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5);
        const q1 = s.clone().lerp(mid, 0.15);
        const q2 = e.clone().lerp(mid, 0.15);
        const meshes = [
            createDisc(q1, normal, discR, discT, color),
            createDisc(q2, normal, discR, discT, color),
            createCylinder(q1, q2, radius * 0.85, 0xaaaaaa),  // web (lighter)
        ];
        return meshes.filter(Boolean);
    }

    /** @private — Valve: two flanges + central sphere (ball valve silhouette) */
    _buildValve(points, radius, color) {
        if (!points || points.length < 2) return [];
        const s = mapCoord(points[0]);
        const e = mapCoord(points[1]);
        const mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5);
        const normal = new THREE.Vector3().subVectors(e, s).normalize();
        const fColor = COLORS.FLANGE;
        const discR = radius * 1.8;
        const discT = radius * 0.5;
        const q1 = s.clone().lerp(mid, 0.25);
        const q2 = e.clone().lerp(mid, 0.25);
        return [
            createDisc(q1, normal, discR, discT, fColor),
            createDisc(q2, normal, discR, discT, fColor),
            createSphere(mid, radius * 1.5, color),   // ball body
            createCylinder(q1, q2, radius * 0.7, 0xaaaaaa), // body tube
        ].filter(Boolean);
    }

    /** @private — Support graphic based on subtype */
    _buildSupport(pos, radius, comp) {
        const r = radius;
        const GREEN = 0x22c55e;

        // ── Support type classification ──────────────────────────────────
        const supName = String(
            comp.attributes?.['<SUPPORT_NAME>'] || comp.attributes?.SUPPORT_NAME || ''
        ).toUpperCase();
        const skey = String(comp.attributes?.SKEY || '').toUpperCase();
        const desc = String(comp.attributes?.['ITEM-DESCRIPTION'] || comp.attributes?.Description || '').toUpperCase();

        const isGuide  = /CA100/.test(supName) || /GUIDE/.test(desc) || /GUIDE/.test(skey);
        const isAnchor = !isGuide && (/ANCHOR|LINE[\s_-]?STOP|LIMIT[\s_-]?STOP/.test(desc) || /ANCH|LST|ANS/.test(skey));

        // ── SUPPORT-DIRECTION → arrow direction vector ───────────────────
        const dirKeyword = String(comp.attributes?.['SUPPORT-DIRECTION'] || 'DOWN').toUpperCase().trim();
        const DIR_MAP = {
            DOWN:  new THREE.Vector3( 0, -1,  0),
            UP:    new THREE.Vector3( 0,  1,  0),
            NORTH: new THREE.Vector3( 0,  0, -1),
            SOUTH: new THREE.Vector3( 0,  0,  1),
            EAST:  new THREE.Vector3( 1,  0,  0),
            WEST:  new THREE.Vector3(-1,  0,  0),
        };
        const arrowDir = DIR_MAP[dirKeyword] || new THREE.Vector3(0, -1, 0);

        // ── Find parent pipe direction (for anchor / guide lateral) ──────
        let pipeDir = new THREE.Vector3(1, 0, 0); // default East
        if (this._lastComponentsCache) {
            for (const c of this._lastComponentsCache) {
                if ((c.type || '').toUpperCase() !== 'PIPE' || !c.points || c.points.length < 2) continue;
                const p1 = mapCoord(c.points[0]);
                const p2 = mapCoord(c.points[1]);
                const ab = p2.clone().sub(p1);
                const len = ab.length();
                if (len < 1) continue;
                const dirN = ab.clone().divideScalar(len);
                const ac = pos.clone().sub(p1);
                const t = ac.dot(dirN);
                if (t < -1 || t > len + 1) continue;
                const perp = ac.clone().sub(dirN.clone().multiplyScalar(t));
                if (perp.length() < (c.bore || 300) * 0.6) { pipeDir = dirN; break; }
            }
        }

        // ── Arrow builder: cone + shaft, aligned with direction ──────────
        const makeArrow = (origin, dir, scale = 1) => {
            const d = dir.clone().normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const quat = new THREE.Quaternion().setFromUnitVectors(up, d);

            const shaftLen = r * 0.9 * scale;
            const shaftR   = r * 0.18 * scale;
            const coneH    = r * 1.0 * scale;
            const coneR    = r * 0.7 * scale;

            // Shaft centre = origin + d * shaftLen/2
            const shaftCentre = origin.clone().add(d.clone().multiplyScalar(shaftLen * 0.5));
            const shaftGeo = new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 8);
            const shaftMat = new THREE.MeshStandardMaterial({ color: GREEN });
            const shaft = new THREE.Mesh(shaftGeo, shaftMat);
            shaft.position.copy(shaftCentre);
            shaft.setRotationFromQuaternion(quat);

            // Cone tip = origin + d * (shaftLen + coneH/2)
            const coneCentre = origin.clone().add(d.clone().multiplyScalar(shaftLen + coneH * 0.5));
            const coneGeo = new THREE.ConeGeometry(coneR, coneH, 8);
            const coneMat = new THREE.MeshStandardMaterial({ color: GREEN });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.copy(coneCentre);
            cone.setRotationFromQuaternion(quat);

            return [shaft, cone];
        };

        if (isGuide) {
            // GUIDE (CA100): two lateral arrows pointing inward from both sides
            const side = new THREE.Vector3().crossVectors(pipeDir, new THREE.Vector3(0, 1, 0)).normalize();
            if (side.length() < 0.01) side.set(1, 0, 0);
            const offset = r * 2.5;
            const origin1 = pos.clone().add(side.clone().multiplyScalar(offset));
            const origin2 = pos.clone().add(side.clone().negate().multiplyScalar(offset));
            return [
                ...makeArrow(origin1, side.clone().negate()),
                ...makeArrow(origin2, side.clone()),
            ].filter(Boolean);
        }

        if (isAnchor) {
            // ANCHOR / LINE STOP: two arrows along pipe axis (opposing) + one perpendicular up
            const off = r * 1.5;
            const origin1 = pos.clone().add(pipeDir.clone().multiplyScalar(off));
            const origin2 = pos.clone().add(pipeDir.clone().negate().multiplyScalar(off));
            const originUp = pos.clone();
            return [
                ...makeArrow(origin1, pipeDir.clone()),
                ...makeArrow(origin2, pipeDir.clone().negate()),
                ...makeArrow(originUp, new THREE.Vector3(0, 1, 0), 0.8),
            ].filter(Boolean);
        }

        // REST (CA150 / default): single arrow in SUPPORT-DIRECTION
        return makeArrow(pos.clone(), arrowDir).filter(Boolean);
    }

    /** @private */
    _buildGeneric(points, radius, color, type) {
        if (!points || points.length < 2) return [];
        const s = mapCoord(points[0]);
        const e = mapCoord(points[1]);
        const r = radius;
        const cyl = createCylinder(s, e, r, color);
        return cyl ? [cyl] : [];
    }

    /** @private — auto-fit camera to scene bounds */
    _fitCamera() {
        const box = new THREE.Box3().setFromObject(this._componentGroup);
        if (box.isEmpty()) return;

        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        // Update orthographic frustum
        const aspect = this.container.clientWidth / (this.container.clientHeight || 1);
        const half = maxDim * 0.8;
        this.camera.left = -half * aspect;
        this.camera.right = half * aspect;
        this.camera.top = half;
        this.camera.bottom = -half;
        this.camera.near = -maxDim * 20;
        this.camera.far = maxDim * 20;
        this.camera.position.set(
            centre.x + maxDim,
            centre.y + maxDim,
            centre.z + maxDim
        );
        this.camera.lookAt(centre);
        this.camera.updateProjectionMatrix();

        if (this.controls) {
            this.controls.target.copy(centre);
            this.controls.update();
        }
    }

    /** Tear down — clean up all resources */
    dispose() {
        if (this._animId) cancelAnimationFrame(this._animId);
        window.removeEventListener('resize', this._onResize);
        if (this.controls) this.controls.dispose();

        // Dispose all geometries/materials
        this.scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement?.parentNode === this.container) {
                this.container.removeChild(this.renderer.domElement);
            }
        }
    }
}
