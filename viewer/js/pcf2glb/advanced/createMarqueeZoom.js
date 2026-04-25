import * as THREE from 'three';
import { SelectionBox } from 'three/addons/interactive/SelectionBox.js';
import { resolveInspectableObject } from './createSelection.js';

export function createMarqueeZoom(getCamera, scene, domElement, controller) {
  const selectionBox = new SelectionBox(getCamera(), scene);
  let startPoint = null;

  function toNdc(event) {
    const rect = domElement.getBoundingClientRect();
    return new THREE.Vector3(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0.5
    );
  }

  const onPointerDown = (event) => {
    if (!event.shiftKey || event.button !== 0) return;
    startPoint = toNdc(event);
  };

  const onPointerUp = async (event) => {
    if (!startPoint || !event.shiftKey) return;

    const endPoint = toNdc(event);
    const selected = selectionBox
      .select(startPoint, endPoint)
      .filter((obj) => Object.keys(obj.userData || {}).length > 0 || (obj.name && !obj.name.startsWith('Object_')));

    startPoint = null;
    if (!selected.length) return;

    const box = new THREE.Box3();
    selected.forEach((obj) => box.expandByObject(resolveInspectableObject(obj), false));

    controller.fitObject(box); // Utilizing existing bounds code
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', onPointerUp);

  return {
    dispose: () => {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointerup', onPointerUp);
    }
  };
}
