import * as THREE from 'three';
import { RvmIdentityMap } from './RvmIdentityMap.js';
import { state } from '../core/state.js';
import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';

export class AvevaJsonLoader {
  constructor() {}

  async load(jsonData, ctx, asyncSession) {
    asyncSession.update('manifest', 10);

    // We create a mock manifest for the rest of the pipeline
    const manifest = {
      schemaVersion: 'rvm-bundle/v1',
      bundleId: 'Aveva-JSON-Import',
      source: { format: 'AVEVA-JSON', files: [] },
      artifacts: { glb: '' },
      runtime: { units: 'm', upAxis: 'Z', originOffset: [0, 0, 0], scale: 1 },
      modelClass: 'single-bundle'
    };

    asyncSession.update('glb', 30);

    const rootGroup = new THREE.Group();
    rootGroup.name = "AvevaRoot";

    const nodes = [];
    let nodeIdCounter = 1;

    // Material colors
    const matCache = new Map();
    const getMaterial = (matId) => {
        if (matCache.has(matId)) return matCache.get(matId);
        // Generate pseudo-random color based on id
        const color = new THREE.Color().setHSL((matId * 137.5) % 360 / 360, 0.7, 0.5);
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 });
        matCache.set(matId, mat);
        return mat;
    };

    function traverse(element, parentGroup, parentPath) {
        const id = `NODE-${nodeIdCounter++}`;
        const name = element.name || "Unnamed";
        const currentPath = parentPath ? `${parentPath}/${name}` : name;

        let nodeRecord = {
            id,
            sourceObjectId: currentPath,
            canonicalObjectId: currentPath,
            renderObjectIds: [],
            name: name,
            attributes: {}
        };

        // Extract attributes
        for (const [k, v] of Object.entries(element)) {
            if (k !== 'children' && k !== 'bbox' && k !== 'name') {
                nodeRecord.attributes[k] = String(v);
            }
        }

        const group = new THREE.Group();
        group.name = currentPath;

        // If it has a bbox, we draw a placeholder box for it
        if (element.bbox && Array.isArray(element.bbox) && element.bbox.length === 6) {
            // Draw bboxes for all nodes that have them.
            // But we scale down non-leaf nodes or make them wireframes so they don't occlude leaves?
            // Actually, in many of these exports, the parent nodes have bounding boxes that encompass all children.
            // If we draw solid boxes for parents, we hide the children.
            // Let's draw solid boxes for leaves, and wireframe boxes for parents!
            const [minX, minY, minZ, maxX, maxY, maxZ] = element.bbox;

            const width = Math.abs(maxX - minX);
            const height = Math.abs(maxY - minY);
            const depth = Math.abs(maxZ - minZ);

            // Only create if it has some volume (or a tiny minimum volume to ensure it renders)
            const w = Math.max(width, 0.01);
            const h = Math.max(height, 0.01);
            const d = Math.max(depth, 0.01);

            const isLeaf = !element.children || element.children.length === 0;

            // For Aveva dumps, components like PIPEs have bboxes, and their children (BRANCHes) have bboxes, and their children (ELBOWs, FLANGEs) have bboxes.
            // Typically, we only want the leaf components. Let's just render the leaf components as solid.
            // Also render PIPEs and BRANCHes themselves if they represent large straight sections,
            // but in the provided JSON, BRANCHes contain ELBOWs, FLANGEs, TEEs (the fittings).
            // The straight sections are usually gaps between the fittings in the tree.
            // To represent the full topo, we should render the BRANCH/PIPE bounding boxes as thin wireframes or semi-transparent cylinders!

            // Let's render everything that has a bbox, but use opacity for containers
            let geometry;
            let material = getMaterial(element.material || 1);
            const n = name.toUpperCase();

            let isContainer = !isLeaf;

            if (isContainer) {
                // For Pipes and Branches, render a very thin cylinder across their longest dimension to show connectivity
                if (n.includes('PIPE') || n.includes('BRANCH')) {
                    const maxDim = Math.max(w, h, d);
                    const radius = 0.05; // Thin line
                    geometry = new THREE.CylinderGeometry(radius, radius, maxDim, 8);
                    material = new THREE.MeshStandardMaterial({ color: 0x3d74c5, transparent: true, opacity: 0.5 });
                } else {
                    // Other containers: wireframe box
                    geometry = new THREE.BoxGeometry(w, h, d);
                    material = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.2 });
                }
            } else {

                // Determine shape based on naming convention heuristics
                if (n.includes('ELBOW') || n.includes('TEE') || n.includes('OLET') || n.includes('CROSS')) {
                    // Pipes/fittings: create a generic cylinder to represent them better than a box
                    // The longest dimension of the bbox is typically the pipe length
                    const maxDim = Math.max(w, h, d);
                    const radius = Math.min(w, h, d) / 2 || 0.1;
                    geometry = new THREE.CylinderGeometry(radius, radius, maxDim, 16);

                    // Color code fittings
                    if (n.includes('ELBOW') || n.includes('BEND')) material = new THREE.MeshStandardMaterial({ color: 0xaa55aa });
                    else if (n.includes('TEE') || n.includes('OLET')) material = new THREE.MeshStandardMaterial({ color: 0x55aa55 });
                    else if (n.includes('CROSS')) material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
                }
                else if (n.includes('VALVE')) {
                    // Valves: represent as a sphere or slightly larger cylinder
                    const radius = Math.max(w, h, d) / 2;
                    geometry = new THREE.SphereGeometry(radius, 16, 16);
                    material = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
                }
                else if (n.includes('FLANGE') || n.includes('GASKET')) {
                    // Flanges: flat cylinder (disc)
                    const maxDim = Math.max(w, h, d);
                    const minDim = Math.min(w, h, d);
                    geometry = new THREE.CylinderGeometry(maxDim/2, maxDim/2, minDim, 16);
                    material = new THREE.MeshStandardMaterial({ color: 0x888888 });
                }
                else if (n.includes('PIPE') || n.includes('BRANCH') || n.includes('TUBE')) {
                    // Pipes
                    const maxDim = Math.max(w, h, d);
                    const radius = Math.min(w, h, d) / 2 || 0.1;
                    geometry = new THREE.CylinderGeometry(radius, radius, maxDim, 16);
                    material = new THREE.MeshStandardMaterial({ color: 0x3d74c5 });
                }
                else if (n.includes('SUPPORT') || n.includes('SUBEQUIPMENT')) {
                    // Supports/Structures
                    geometry = new THREE.BoxGeometry(w, h, d);
                    material = new THREE.MeshStandardMaterial({ color: 0x999922 });
                }
                else if (n.includes('BOX') || n.includes('STRU') || n.includes('FRMW') || n.includes('SCTN')) {
                    geometry = new THREE.BoxGeometry(w, h, d);
                    material = new THREE.MeshStandardMaterial({ color: 0x555555 });
                }
                else {
                    // Default fallback
                    geometry = new THREE.BoxGeometry(w, h, d);
                }
            }

            const mesh = new THREE.Mesh(geometry, material);

            // Position at center of bbox
            mesh.position.set(
                minX + width / 2,
                minY + height / 2,
                minZ + depth / 2
            );

            // If it's a cylinder, we need to orient it along the longest axis of the bbox
            // BoxGeometry is already axis-aligned and fits perfectly.
            // For CylinderGeometry, default is along Y-axis.
            if (geometry.type === 'CylinderGeometry') {
                if (w > h && w > d) {
                    mesh.rotation.z = Math.PI / 2; // Align to X
                } else if (d > h && d > w) {
                    mesh.rotation.x = Math.PI / 2; // Align to Z
                }
                // If h is longest, leave as is (aligned to Y)
            }

            mesh.userData = { name: currentPath };
            mesh.name = currentPath;
            mesh.uuid = THREE.MathUtils.generateUUID();

            group.add(mesh);
            nodeRecord.renderObjectIds.push(mesh.name);
        }

        nodes.push(nodeRecord);
        parentGroup.add(group);

        if (element.children && Array.isArray(element.children)) {
            for (const child of element.children) {
                traverse(child, group, currentPath);
            }
        }
    }

    // Start traversal
    if (Array.isArray(jsonData)) {
        for (const root of jsonData) {
            traverse(root, rootGroup, "");
        }
    } else {
        traverse(jsonData, rootGroup, "");
    }

    asyncSession.update('index', 60);

    const indexJson = {
        bundleId: 'Aveva-JSON-Import',
        nodes: nodes
    };

    asyncSession.update('build-tree', 85);
    const identityMap = RvmIdentityMap.fromNodes(nodes);

    // Add an ambient light and directional light so the boxes are visible
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 50);
    rootGroup.add(ambientLight);
    rootGroup.add(dirLight);

    if (asyncSession.isStale() || asyncSession.isCancelled()) return;
    asyncSession.complete();

    // Mock a GLTF payload format
    const gltf = { scene: rootGroup };

    const payload = {
      manifest,
      gltf,
      indexJson,
      tagXmlText: null,
      identityMap,
    };

    state.rvm.manifest = manifest;
    state.rvm.activeBundle = manifest.bundleId;
    state.rvm.index = indexJson;
    state.rvm.identityMap = identityMap;

    emit(RuntimeEvents.RVM_MODEL_LOADED, payload);
    return payload;
  }
}
