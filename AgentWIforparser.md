# Work Instructions: RVM WebAssembly (WASM) Parser Integration

## 1. Context & Objective
The current 3D Viewer application requires a backend server (`rvmparser-windows-bin.exe` or a serverless GitHub Actions bridge) to convert raw AVEVA `.rvm` files into WebGL-compatible `.glb` geometry.

**The Goal:** Eliminate the backend dependency entirely by compiling the native C++ `rvmparser` source into WebAssembly (WASM) and integrating it directly into the browser client. This will allow the viewer to work 100% offline, privately, and instantaneously.

These work instructions provide the **exact code implementations** required for each task so that subsequent AI agents can simply write these files and wire them up.

---

## Task 1: C++ to WASM Bindings (Agent A)
**Objective:** The native C++ parser needs a wrapper function that Emscripten can export to JavaScript.

**Instructions for the Agent:**
1. Locate the main entry point of the C++ parser (likely where `main()` is defined).
2. Create a new file `wasm_bindings.cpp` (or append to the main file) with the following exact code.
3. Use Emscripten to compile: `emcc wasm_bindings.cpp -o rvm_parser.js -s EXPORTED_RUNTIME_METHODS="['cwrap']" -s ALLOW_MEMORY_GROWTH=1 -O3`

**Code to Implement (`wasm_bindings.cpp`):**
```cpp
#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// Assuming the native parser has a function that looks like this:
// extern std::vector<uint8_t> parse_rvm_to_glb_memory(const uint8_t* rvm_data, size_t length);

extern "C" {
    // 1. Function to allocate memory in WASM from JS
    EMSCRIPTEN_KEEPALIVE
    uint8_t* allocate_memory(int size) {
        return (uint8_t*)malloc(size);
    }

    // 2. Function to free memory
    EMSCRIPTEN_KEEPALIVE
    void free_memory(uint8_t* ptr) {
        free(ptr);
    }

    // 3. The main conversion wrapper
    EMSCRIPTEN_KEEPALIVE
    uint8_t* convert_rvm_to_glb(uint8_t* rvm_bytes, int rvm_length, int* out_glb_length) {
        // [!] THIS LINE MUST BE REPLACED WITH THE ACTUAL C++ PARSER INVOCATION [!]
        // Example:
        // std::vector<uint8_t> glb_data = parse_rvm_to_glb_memory(rvm_bytes, rvm_length);

        // --- Mocking the return for illustration ---
        // size_t glb_size = glb_data.size();
        // uint8_t* out_ptr = (uint8_t*)malloc(glb_size);
        // memcpy(out_ptr, glb_data.data(), glb_size);
        // *out_glb_length = glb_size;
        // return out_ptr;
        return nullptr;
    }
}
```

---

## Task 2: Create the Web Worker (Agent B)
**Objective:** Execute the WASM module in a background thread to prevent the UI from freezing.

**Instructions for the Agent:**
1. Create a new file exactly at `viewer/converters/rvm-wasm-worker.js`.
2. Copy and paste the following code exactly.

**Code to Implement (`viewer/converters/rvm-wasm-worker.js`):**
```javascript
// Worker to handle WASM compilation and execution off the main thread

// Import the Emscripten glue code (generated in Task 1)
// Note: Depending on build settings, you might need importScripts() instead
importScripts('../../opt/wasm/rvm_parser.js');

let wasmReady = false;
let wasmModule = null;

// The Emscripten glue code creates a global Module object. We wait for it.
Module.onRuntimeInitialized = () => {
    wasmReady = true;
    wasmModule = Module;
    postMessage({ type: 'WASM_READY' });
};

self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    if (type === 'CONVERT') {
        if (!wasmReady) {
            postMessage({ id, error: 'WASM module not yet initialized.' });
            return;
        }

        try {
            const rvmBytes = new Uint8Array(payload.buffer);
            const rvmLength = rvmBytes.length;

            // 1. Allocate memory inside WASM for the incoming RVM file
            const rvmPtr = wasmModule._allocate_memory(rvmLength);

            // 2. Copy JS array buffer into WASM memory
            wasmModule.HEAPU8.set(rvmBytes, rvmPtr);

            // 3. Allocate 4 bytes to hold the integer representing the output GLB length
            const outLengthPtr = wasmModule._allocate_memory(4);

            // 4. Call the C++ function
            const glbPtr = wasmModule._convert_rvm_to_glb(rvmPtr, rvmLength, outLengthPtr);

            if (glbPtr === 0) {
                throw new Error("WASM conversion returned null pointer. Parsing failed.");
            }

            // 5. Read the output length from the pointer
            const glbLength = wasmModule.HEAP32[outLengthPtr >> 2]; // Bit shift for 32-bit int view

            // 6. Extract the resulting GLB bytes from WASM memory
            const glbBytes = new Uint8Array(wasmModule.HEAPU8.buffer, glbPtr, glbLength);

            // 7. Make a copy of the bytes to send back to the main thread, so we can free WASM memory
            const glbCopy = new Uint8Array(glbBytes);

            // 8. Clean up WASM memory to prevent memory leaks
            wasmModule._free_memory(rvmPtr);
            wasmModule._free_memory(glbPtr);
            wasmModule._free_memory(outLengthPtr);

            // Send success back to main thread
            postMessage({ id, type: 'CONVERT_SUCCESS', payload: glbCopy.buffer }, [glbCopy.buffer]);

        } catch (err) {
            postMessage({ id, type: 'CONVERT_ERROR', error: err.message });
        }
    }
};
```

---

## Task 3: Create the Bridge Interface (Agent C)
**Objective:** Create the JavaScript bridge that implements the standard application interface, wrapping the Web Worker.

**Instructions for the Agent:**
1. Create a new file exactly at `viewer/converters/rvm-wasm-bridge.js`.
2. Copy and paste the following code.

**Code to Implement (`viewer/converters/rvm-wasm-bridge.js`):**
```javascript
export class RvmWasmBridge {
    constructor() {
        this.workerUrl = './converters/rvm-wasm-worker.js';
        this.wasmUrl = '../opt/wasm/rvm_parser.wasm';
    }

    /**
     * Called by app.js to determine if this bridge can be used.
     */
    async probe() {
        try {
            // Simply check if the WASM file exists on the server/CDN
            const res = await fetch(this.wasmUrl, { method: 'HEAD' });
            return { reachable: res.ok, version: 'wasm-1.0' };
        } catch {
            return { reachable: false };
        }
    }

    /**
     * Executes the conversion and loads it into the viewer.
     */
    async convertAndLoad(input, ctx, asyncSession) {
        asyncSession.update('converting', 10);

        const fileBuffer = await input.file.arrayBuffer();

        // Wrap worker execution in a Promise
        const glbBuffer = await new Promise((resolve, reject) => {
            const worker = new Worker(this.workerUrl);
            const taskId = crypto.randomUUID();

            worker.onmessage = (e) => {
                if (e.data.type === 'WASM_READY') {
                    // Start conversion once WASM is booted
                    worker.postMessage({
                        type: 'CONVERT',
                        id: taskId,
                        payload: { buffer: fileBuffer }
                    }, [fileBuffer]);
                } else if (e.data.id === taskId) {
                    if (e.data.type === 'CONVERT_SUCCESS') {
                        worker.terminate();
                        resolve(e.data.payload);
                    } else {
                        worker.terminate();
                        reject(new Error(e.data.error));
                    }
                }
            };

            worker.onerror = (err) => {
                worker.terminate();
                reject(err);
            };
        });

        if (asyncSession.isCancelled()) return;
        asyncSession.update('converting', 50);

        // Convert the raw ArrayBuffer into a File/Blob that the StaticBundleLoader can read
        const glbBlob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
        const glbUrl = URL.createObjectURL(glbBlob);

        // Generate a mock bundle manifest linking to the local blob URL
        const mockManifest = {
            schemaVersion: 'rvm-bundle/v1',
            bundleId: input.file.name.replace('.rvm', ''),
            source: { format: 'RVM', files: [input.file.name] },
            artifacts: { glb: glbUrl },
            runtime: { units: 'mm', upAxis: 'Z', originOffset: [0, 0, 0], scale: 1 },
            modelClass: 'single-bundle'
        };

        // Pass it to the standard loader
        const payload = await ctx.staticBundleLoader.load(mockManifest, ctx, asyncSession);

        // Clean up the URL object to prevent memory leaks
        URL.revokeObjectURL(glbUrl);

        return payload;
    }
}
```

---

## Task 4: Hook into App.js Orchestration (Agent D)
**Objective:** Update the main application bootloader to use the new WASM bridge automatically.

**Instructions for the Agent:**
1. Open `viewer/core/app.js`.
2. Import the new bridge at the top of the file:
   `import { RvmWasmBridge } from '../converters/rvm-wasm-bridge.js';`
3. Locate the `RuntimeEvents.FILE_LOADED` listener and update the probing logic exactly as follows:

**Code to Implement (Inside `viewer/core/app.js`):**
```javascript
        // Only require a backend bridge if we are actually loading a raw RVM file
        if (payload.kind === 'raw-rvm') {
            if (!caps || !caps.rawRvmImport) {
                 caps = { rawRvmImport: true, deploymentMode: 'assisted' };
            }

            // 1. Check if WASM is available locally (Highest Priority - No network latency)
            const wasmBridge = new RvmWasmBridge();
            const wasmProbe = await wasmBridge.probe();

            // 2. Check if the local Node.js test server bridge is alive
            const localBridge = new RvmHelperBridge();
            const localProbe = await localBridge.probe();

            // 3. Instantiate the GitHub Actions serverless fallback
            const ghBridge = new RvmGitHubActionsBridge();
            const ghProbe = await ghBridge.probe();

            // Assign hierarchy
            if (wasmProbe.reachable) {
                activeBridge = wasmBridge;
                console.log("Using Local WebAssembly RvmWasmBridge");
            } else if (localProbe.reachable) {
                activeBridge = localBridge;
                console.log("Using Local test_server RvmHelperBridge");
            } else if (ghProbe.reachable) {
                activeBridge = ghBridge;
                console.log("Using serverless RvmGitHubActionsBridge");
            } else {
                // Prompt the user for a PAT to enable serverless mode if everything is dead
                // ... (Existing GitHub PAT prompt logic remains here) ...
            }
        }
```
