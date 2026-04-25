import * as THREE from 'three';

export function resolveInspectableObject(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData?.pcfId || cur.userData?.REF_NO || cur.userData?.id) return cur;
    if (Object.keys(cur.userData || {}).length > 0) return cur;
    cur = cur.parent;
  }
  return obj;
}

export function createSelection(getCamera, scene, domElement) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let selectionCallback = null;
  let activeHighlightObject = null;

  const onClick = (e) => {
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, getCamera());
    const intersects = raycaster.intersectObjects(scene.children, true);

    let clickedObject = null;
    for (const intersect of intersects) {
        // Skip helpers (assuming helpers don't have userData.pcfId and are not Meshes we care about)
        
        if (intersect.object.type === 'Mesh') {
            clickedObject = resolveInspectableObject(intersect.object);
            if (clickedObject) {
                break;
            }
        }
    }

    // Un-highlight previous
    if (activeHighlightObject && activeHighlightObject !== clickedObject) {
        activeHighlightObject.traverse((node) => {
            if (node.isMesh && node.material && node.userData.originalEmissive !== undefined) {
                node.material.emissive.setHex(node.userData.originalEmissive);
                node.material.emissiveIntensity = node.userData.originalIntensity;
            }
        });
    }

    // Highlight new
    if (clickedObject && activeHighlightObject !== clickedObject) {
        clickedObject.traverse((node) => {
            if (node.isMesh && node.material) {
                if (node.userData.originalEmissive === undefined) {
                    node.userData.originalEmissive = node.material.emissive.getHex();
                    node.userData.originalIntensity = node.material.emissiveIntensity || 0;
                }
                node.material = node.material.clone(); // ensure unique material to not highlight instances globally
                node.material.emissive.setHex(0x3b82f6); // Neon Blue
                node.material.emissiveIntensity = 0.8;
            }
        });
    }
    
    activeHighlightObject = clickedObject;
if (selectionCallback) {
        selectionCallback(clickedObject);
    }
  };

  domElement.addEventListener('pointerdown', onClick);

  return {
    onSelect: (fn) => { selectionCallback = fn; },
    dispose: () => {
        domElement.removeEventListener('pointerdown', onClick);
    }
  };
}
