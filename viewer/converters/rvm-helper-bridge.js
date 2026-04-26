import { rvmCacheStore } from './rvm-cache-store.js';

export async function helperProbe() {
    try {
        const res = await fetch('/api/native/rvm-to-glb-probe', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            return { reachable: true, version: data.version || 'unknown' };
        }
        return { reachable: false };
    } catch {
        return { reachable: false };
    }
}

function resolveSidecar(files) {
    if (!files || files.length === 0) return null;
    const atts = files.filter(f => f.name.toLowerCase().endsWith('.att'));
    if (atts.length > 0) return atts[0];
    const txts = files.filter(f => f.name.toLowerCase().endsWith('.txt'));
    if (txts.length > 0) return txts[0];
    return null;
}

export const assistedBridge = {
    async convertAndLoad(input, ctx) {
        const { capabilities, diagnostics } = ctx;

        if (!capabilities?.rawRvmImport) {
            throw new Error('Raw RVM import unavailable in static mode. Load a converted bundle instead.');
        }

        if (!capabilities?.helperReachable) {
            throw new Error('Conversion helper is not reachable.');
        }

        const rvmFile = input.files.find(f => f.name.toLowerCase().endsWith('.rvm'));
        if (!rvmFile) {
            throw new Error('No .rvm file provided.');
        }

        // Wait for hash calculation if available
        let sha256 = rvmFile.sha256;
        if (!sha256 && typeof crypto !== 'undefined' && crypto.subtle) {
           try {
               const buf = await rvmFile.arrayBuffer();
               const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
               const hashArray = Array.from(new Uint8Array(hashBuffer));
               sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
           } catch {
               sha256 = rvmFile.name + '_' + rvmFile.size;
           }
        } else if (!sha256) {
           sha256 = rvmFile.name + '_' + rvmFile.size;
        }

        const cached = rvmCacheStore.get(sha256);
        if (cached) {
            // Already converted, just load the bundle
            return ctx.staticBundleLoader.load({
                kind: 'bundle',
                manifest: cached.manifest,
                files: [
                    new File([cached.glbBlob], cached.manifest.artifacts.glb),
                    new File([cached.indexBlob], cached.manifest.artifacts.index)
                ]
            }, ctx);
        }

        const sidecar = resolveSidecar(input.files);

        const toBase64 = async (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result;
                    resolve(result.substring(result.indexOf(',') + 1));
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        };

        const payload = {
            inputName: rvmFile.name,
            inputBase64: await toBase64(rvmFile)
        };

        if (sidecar) {
            payload.attributesName = sidecar.name;
            payload.attributesBase64 = await toBase64(sidecar);
        }

        const res = await fetch('/api/native/rvm-to-glb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            let errMsg = 'Conversion failed.';
            try {
                const errData = await res.json();
                errMsg = errData.error || errMsg;
            } catch {}
            throw new Error(errMsg);
        }

        const result = await res.json();

        // Reconstruct bundle structure from server output
        const bundleId = `bundle-${Date.now()}`;
        const manifest = {
            schemaVersion: "rvm-bundle/v1",
            bundleId,
            source: { format: "RVM", files: [{ name: rvmFile.name, sha256 }] },
            converter: { name: "rvmparser-server", mode: "assisted", warnings: [] },
            artifacts: { glb: result.glbName, index: result.indexName },
            coverage: { attributes: true, tree: true, supports: false, reviewTags: true },
            modelClass: "single-bundle"
        };

        // Decode bases
        const glbBlob = await (await fetch('data:application/octet-stream;base64,' + result.glbBase64)).blob();
        const indexBlob = new Blob([new TextEncoder().encode(result.indexText)]);

        rvmCacheStore.set(sha256, { manifest, glbBlob, indexBlob });

        return ctx.staticBundleLoader.load({
            kind: 'bundle',
            manifest,
            files: [
                new File([glbBlob], result.glbName),
                new File([indexBlob], result.indexName)
            ]
        }, ctx);
    }
};
