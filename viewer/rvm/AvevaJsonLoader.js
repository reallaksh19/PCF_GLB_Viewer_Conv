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
            if (isLeaf) {
                const geometry = new THREE.BoxGeometry(w, h, d);
                const material = getMaterial(element.material || 1);
                const mesh = new THREE.Mesh(geometry, material);

                // Position at center of bbox
                mesh.position.set(
                    minX + width / 2,
                    minY + height / 2,
                    minZ + depth / 2
                );

                mesh.userData = { name: currentPath };
                mesh.name = currentPath;
                mesh.uuid = THREE.MathUtils.generateUUID();

                group.add(mesh);
                nodeRecord.renderObjectIds.push(mesh.name);
            }
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
