import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export async function exportSceneToGLB(scene) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        resolve(new Blob([result], { type: 'model/gltf-binary' }));
      },
      (error) => reject(error),
      { binary: true, onlyVisible: true, trs: false }
    );
  });
}
