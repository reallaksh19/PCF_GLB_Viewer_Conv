import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseBundleManifest } from './RvmBundleManifest.js';
import { RvmIdentityMap } from './RvmIdentityMap.js';
import { RvmDiagnostics } from './RvmDiagnostics.js';
import { state } from '../core/state.js';
import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';

export class RvmStaticBundleLoader {
  constructor() {
    this.gltfLoader = new GLTFLoader();
  }

  /**
   * Loads a static RVM bundle given its parsed/unparsed manifest object and an async session.
   *
   * @param {object} inputBundle The raw bundle manifest (will be parsed/validated)
   * @param {object} ctx Dependency context
   * @param {RvmAsyncSession} asyncSession The active async load session
   */
  async load(inputBundle, ctx, asyncSession) {
    // 1. Manifest
    asyncSession.update('manifest', 5);
    let manifest;
    try {
      manifest = parseBundleManifest(inputBundle);
    } catch (err) {
      throw err;
    }

    if (!manifest.artifacts.glb) {
      const errMessage = 'Missing artifacts.glb in manifest.';
      throw new Error(errMessage);
    }

    // Since we're in static bundle loader, the artifacts are usually fetched relative to some path.
    // For now, assume ctx provides a way to fetch the files, e.g. via an ArrayBuffer mapping if uploaded,
    // or via urls. We will just use `ctx.getFile` which could return a Blob/ArrayBuffer/Response.
    // If we're loading a static bundle by File list, ctx might map filenames.
    // We will assume `ctx.getFileUrl(filename)` exists and returns a fetchable URL or data URI.

    // 2. GLB
    asyncSession.update('glb', 20);
    let gltf;
    try {
      const glbUrl = await ctx.getFileUrl(manifest.artifacts.glb);
      gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          glbUrl,
          resolve,
          (xhr) => {
             // Let's say 20 -> 50 for GLB progress
             if (xhr.lengthComputable) {
                const p = 20 + (xhr.loaded / xhr.total) * 30;
                asyncSession.update('glb', Math.floor(p));
             }
          },
          reject
        );
      });
    } catch (err) {
      throw new Error(`Failed to load GLB: ${err.message}`);
    }

    if (asyncSession.isStale() || asyncSession.isCancelled()) return;

    // 3. Index JSON
    asyncSession.update('index', 60);
    let indexJson = null;
    if (manifest.artifacts.index) {
      try {
        const indexUrl = await ctx.getFileUrl(manifest.artifacts.index);
        const res = await fetch(indexUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        indexJson = await res.json();

        if (indexJson.bundleId !== manifest.bundleId) {
           RvmDiagnostics.report('warning', 'Bundle ID mismatch', `Index bundleId ${indexJson.bundleId} does not match manifest ${manifest.bundleId}`);
        }
      } catch (err) {
        RvmDiagnostics.report('error', 'Index JSON Load Error', `Failed to load ${manifest.artifacts.index}: ${err.message}`);
        // We do not fail the load entirely if index is missing, or do we? Wait, usually we proceed but with warnings.
        // We'll let it continue.
      }
    }

    if (asyncSession.isStale() || asyncSession.isCancelled()) return;

    // 4. Tag XML
    asyncSession.update('tags', 75);
    let tagXmlText = null;
    if (manifest.artifacts.tags) {
      try {
        const tagsUrl = await ctx.getFileUrl(manifest.artifacts.tags);
        const res = await fetch(tagsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        tagXmlText = await res.text();
      } catch (err) {
        RvmDiagnostics.report('error', 'Tag XML Load Error', `Failed to load ${manifest.artifacts.tags}: ${err.message}`);
      }
    }

    if (asyncSession.isStale() || asyncSession.isCancelled()) return;

    // 5. Build IdentityMap
    asyncSession.update('build-tree', 85);
    let identityMap = new RvmIdentityMap();
    if (indexJson && Array.isArray(indexJson.nodes)) {
      identityMap = RvmIdentityMap.fromNodes(indexJson.nodes);
    }

    // 6. Finalize & Emit
    if (asyncSession.isStale() || asyncSession.isCancelled()) return;
    asyncSession.complete();

    const payload = {
      manifest,
      gltf,
      indexJson,
      tagXmlText,
      identityMap,
    };

    // Update state to make it globally available for subsequent processes
    state.rvm.manifest = manifest;
    state.rvm.activeBundle = manifest.bundleId;
    state.rvm.index = indexJson;
    state.rvm.identityMap = identityMap;

    emit(RuntimeEvents.RVM_MODEL_LOADED, payload);
    return payload;
  }
}
