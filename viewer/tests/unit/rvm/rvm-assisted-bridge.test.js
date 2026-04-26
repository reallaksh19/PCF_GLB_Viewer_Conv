import assert from 'assert/strict';

const _fakeStore = {};
global.sessionStorage = {
  getItem: (k) => _fakeStore[k] || null,
  setItem: (k, v) => { _fakeStore[k] = v; },
  removeItem: (k) => { delete _fakeStore[k]; }
};

global.FileReader = class {
  readAsDataURL(file) {
    setTimeout(() => {
      this.result = 'data:application/octet-stream;base64,dummy_base64';
      if (this.onload) this.onload();
    }, 0);
  }
};

import { assistedBridge, helperProbe } from '../../../converters/rvm-helper-bridge.js';
import { rvmCacheStore } from '../../../converters/rvm-cache-store.js';

let mockFetchCalls = [];
global.fetch = async (url, opts) => {
    mockFetchCalls.push({ url, opts });
    if (url === '/api/native/rvm-to-glb-probe') {
        if (global.MOCK_PROBE_REACHABLE) {
            return { ok: true, json: async () => ({ version: "1.2" }) };
        }
        if (global.MOCK_PROBE_THROWS) {
            throw new Error("Network error");
        }
        return { ok: true, json: async () => ({ reachable: false }) };
    }
    if (url === '/api/native/rvm-to-glb') {
        if (global.MOCK_SERVER_FAIL) {
            return { ok: false, json: async () => ({ error: "Server conversion failed" }) };
        }
        return {
            ok: true,
            json: async () => ({
                glbName: "test.glb",
                glbBase64: btoa("dummy_glb_content"),
                indexName: "test.index.json",
                indexText: JSON.stringify({ bundleId: "bundle-1", nodes: [] })
            })
        };
    }
    return { ok: false };
};

function runTests() {
    let success = true;

    async function testRawRvmRejectedStatic() {
        const ctx = { capabilities: { rawRvmImport: false } };
        try {
            await assistedBridge.convertAndLoad({ kind: 'raw-rvm', files: [] }, ctx);
            console.error('❌ raw RVM should be rejected in static mode');
            success = false;
        } catch (err) {
            assert.match(err.message, /Raw RVM import unavailable/);
            console.log('✅ raw RVM input rejected in static mode with clear message (not silent)');
        }
    }

    async function testRawRvmAcceptedAssisted() {
        rvmCacheStore.clear();
        let loadedBundle = null;
        const ctx = {
            capabilities: { rawRvmImport: true, helperReachable: true },
            staticBundleLoader: { load: async (b) => { loadedBundle = b; return "loaded"; } }
        };
        const file = new File(["dummy"], "test.rvm", { type: "application/octet-stream" });
        file.sha256 = "hash123";

        const res = await assistedBridge.convertAndLoad({ kind: 'raw-rvm', files: [file] }, ctx);
        assert.equal(res, "loaded");
        assert.equal(loadedBundle.manifest.artifacts.glb, "test.glb");
        console.log('✅ raw RVM accepted in assisted mode when helper probe returns reachable');
        console.log('✅ converted bundle loads through RvmStaticBundleLoader (same path as static mode)');
    }

    async function testCacheHit() {
        rvmCacheStore.clear();
        rvmCacheStore.set("hash123", {
            manifest: { artifacts: { glb: "cached.glb", index: "cached.json" } },
            glbBlob: new Blob(["c"]),
            indexBlob: new Blob(["c"])
        });
        let loadedBundle = null;
        const ctx = {
            capabilities: { rawRvmImport: true, helperReachable: true },
            staticBundleLoader: { load: async (b) => { loadedBundle = b; return "loaded"; } }
        };
        const file = new File(["dummy"], "test.rvm");
        file.sha256 = "hash123";

        mockFetchCalls = [];
        await assistedBridge.convertAndLoad({ kind: 'raw-rvm', files: [file] }, ctx);
        assert.equal(mockFetchCalls.length, 0); // No fetch means cache hit
        assert.equal(loadedBundle.manifest.artifacts.glb, "cached.glb");
        console.log('✅ sha256 cache hit skips re-conversion');
    }

    async function testProbe() {
        global.MOCK_PROBE_REACHABLE = true;
        global.MOCK_PROBE_THROWS = false;
        let res = await helperProbe();
        assert.equal(res.reachable, true);
        assert.equal(res.version, "1.2");

        global.MOCK_PROBE_REACHABLE = false;
        global.MOCK_PROBE_THROWS = false;
        res = await helperProbe();
        assert.equal(res.reachable, false);

        global.MOCK_PROBE_REACHABLE = false;
        global.MOCK_PROBE_THROWS = true;
        res = await helperProbe();
        assert.equal(res.reachable, false);

        console.log('✅ probe failure → graceful fallback to static caps (not crash)');
    }

    async function main() {
        console.log("--- rvm-assisted-bridge.test.js ---");
        await testRawRvmRejectedStatic();
        await testRawRvmAcceptedAssisted();
        await testCacheHit();
        await testProbe();

        if (!success) process.exit(1);
    }

    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

runTests();
