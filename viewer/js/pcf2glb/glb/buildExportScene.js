import * as THREE from 'three';
import { buildComponentObject } from './buildComponentObject.js';

export function buildExportScene(model, log) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'PCF_EXPORT_ROOT';
  scene.add(root);

  for (const comp of model.components) {
    try {
      const obj = buildComponentObject(comp, log);
      if (obj) root.add(obj);
    } catch (err) {
      if (log) {
          log.error('COMPONENT_BUILD_FAILED', {
              id: comp.id,
              type: comp.type,
              message: String(err?.message || err),
          });
      }
    }
  }

  return scene;
}
