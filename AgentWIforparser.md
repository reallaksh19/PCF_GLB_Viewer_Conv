# Work Instructions: RVM WebAssembly (WASM) Parser Integration

## 1. Context & Objective
The current 3D Viewer application requires a backend server (`rvmparser-windows-bin.exe` or a serverless GitHub Actions bridge) to convert raw AVEVA `.rvm` files into WebGL-compatible `.glb` geometry.

**The Goal:** Eliminate the backend dependency entirely by compiling the native C++ `rvmparser` source into WebAssembly (WASM) and integrating it directly into the browser client. This will allow the viewer to work 100% offline, privately, and instantaneously.

These work instructions are broken down into discrete AI tasks (targeting <500 lines of code each) so that multiple agents can execute them sequentially or concurrently.

---

## 2. Platform Architecture & Details
* **Frontend Stack:** Vanilla JS, Native ES Modules (`type="module"`), Three.js, Playwright for testing. No bundlers (Webpack/Vite) are used; CDN import maps are utilized.
* **Pipeline:** Files are routed through `viewer/core/app.js` using a central event bus (`viewer/core/event-bus.js`). `loadRvmSource()` in `viewer/rvm/RvmLoadPipeline.js` orchestrates the conversion and loading.
* **WASM Target:** The resulting WASM binary should expose a C-style API (e.g., `uint8_t* convert_rvm_to_glb(uint8_t* rvm_bytes, int rvm_size, int* out_glb_size)`) that can be invoked via JavaScript's `WebAssembly.instantiateStreaming`.

---

## Task 1: C++ to WASM Build Configuration (Agent A)
**Objective:** Set up the Emscripten build environment to compile the existing native C++ parser into a WASM module.

**Actions:**
1. Create a new directory: `viewer/converters/wasm-build/`.
2. Author a `CMakeLists.txt` or a build script (`build_wasm.sh`) targeting Emscripten (`emcc`).
3. Ensure the build outputs `rvm_parser.wasm` and a slim JS wrapper `rvm_parser_glue.js`.
4. The wrapper should export a clean API: `parseRVM(Uint8Array rvmBytes) -> Uint8Array glbBytes`.

**Reasoning:** The native codebase must be compiled with `EXPORTED_FUNCTIONS` to ensure the JS layer can allocate memory, copy the `.rvm` buffer, invoke the parser, and read back the resulting `.glb` binary array.

**Code Snippet Example (C++ Binding):**
```cpp
#include <emscripten.h>
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    uint8_t* convert_rvm_to_glb(uint8_t* rvm_bytes, int length, int* out_length) {
        // ... hook into native parser ...
    }
}
```

---

## Task 2: Create the WASM Bridge Interface (Agent B)
**Objective:** Implement the frontend JS bridge that conforms to the existing `assistedBridge` contract in `app.js`.

**Actions:**
1. Create `viewer/converters/rvm-wasm-bridge.js`.
2. Implement a class `RvmWasmBridge` with a `probe()` method (returning `{ reachable: true, version: 'wasm-1.0' }` if the `.wasm` file is successfully fetched) and a `convertAndLoad(input, ctx, asyncSession)` method.
3. The `convertAndLoad` method must:
   * Read the input `File` as an `ArrayBuffer`.
   * Pass it to the loaded WASM module.
   * Receive the GLB `ArrayBuffer`.
   * Create a `Blob` and a `Blob URL` (`URL.createObjectURL(blob)`).
   * Feed this local URL into `ctx.staticBundleLoader.load()`.

**Reasoning:** By conforming to the existing `RvmHelperBridge` and `RvmGitHubActionsBridge` contracts, the WASM implementation can be hot-swapped into the app without rewriting the UI or core pipeline logic.

**Code Snippet Example:**
```javascript
export class RvmWasmBridge {
    async probe() {
        try {
            const res = await fetch('./opt/wasm/rvm_parser.wasm', { method: 'HEAD' });
            return { reachable: res.ok, version: 'wasm-1.0' };
        } catch { return { reachable: false }; }
    }

    async convertAndLoad(input, ctx, asyncSession) {
        asyncSession.update('converting', 10);
        // Load WASM and parse...
        const glbBytes = await window.RVM_WASM.parseRVM(new Uint8Array(await input.file.arrayBuffer()));
        const blobUrl = URL.createObjectURL(new Blob([glbBytes], { type: 'model/gltf-binary' }));
        // Mock a bundle manifest pointing to the local blob
        const mockBundle = { /* ... */ artifacts: { glb: blobUrl } };
        return await ctx.staticBundleLoader.load(mockBundle, ctx, asyncSession);
    }
}
```

---

## Task 3: Orchestration and App.js Fallback Chain (Agent C)
**Objective:** Update the application's bootloader to prioritize the WASM client over backend servers.

**Actions:**
1. Modify `viewer/core/app.js`.
2. Import `RvmWasmBridge`.
3. In the `FILE_LOADED` event handler, update the probe chain hierarchy:
   * **First:** Probe `RvmWasmBridge`. If reachable, use it (Zero backend overhead).
   * **Second:** Probe `RvmHelperBridge` (Local Node.js backend).
   * **Third:** Probe `RvmGitHubActionsBridge` (Serverless fallback).
4. Update `RvmCapabilities.js` to reflect that `localConversion: true` is powered by WASM.

**Reasoning:** The WASM implementation is the "Holy Grail" of this feature because it eliminates network latency, compute costs, and backend dependencies. It must be the first fallback attempted by the application.

---

## Task 4: UI/Web Worker Offloading (Agent D)
**Objective:** Prevent the main browser thread from freezing during heavy WASM parsing.

**Actions:**
1. Create `viewer/converters/rvm-wasm-worker.js`.
2. Move the `WebAssembly.instantiate` and execution logic from the Bridge (Task 2) into this standard Web Worker.
3. Update `RvmWasmBridge` to instantiate the worker, send the `.rvm` buffer via `postMessage`, and `await` the `.glb` buffer in the `onmessage` response.

**Reasoning:** 3D model parsing is CPU-intensive. If executed on the main thread, the entire browser UI will freeze, preventing the `RvmAsyncSession` progress bar from animating or the user from clicking "Cancel". Offloading it to a worker guarantees a smooth user experience.
