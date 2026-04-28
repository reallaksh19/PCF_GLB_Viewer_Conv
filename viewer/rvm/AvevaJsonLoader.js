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

        // If it has a bbox, we draw a placeholder box for it (usually the leaf elements represent geometry)
        if (element.bbox && Array.isArray(element.bbox) && element.bbox.length === 6) {
            // Check if this is a leaf node or if we just want to draw all bboxes
            // To prevent massive overlap, we'll draw bboxes only for nodes that have no children
            // OR if it's explicitly a geometry node. Let's draw for nodes without children that have bboxes.
            if (!element.children || element.children.length === 0) {
                const [minX, minY, minZ, maxX, maxY, maxZ] = element.bbox;

                const width = Math.abs(maxX - minX);
                const height = Math.abs(maxY - minY);
                const depth = Math.abs(maxZ - minZ);

                // Only create if it has some volume
                if (width > 0 && height > 0 && depth > 0) {
                    const geometry = new THREE.BoxGeometry(width, height, depth);
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
