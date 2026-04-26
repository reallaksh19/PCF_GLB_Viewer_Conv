/**
 * rvm-cache-store.js
 * Stores conversion results keyed by SHA-256 to avoid redundant local processing.
 */

const STORAGE_KEY_PREFIX = 'rvm_conv_cache_';

export const RvmCacheStore = {
    get(sha256) {
        if (!sha256) return null;
        try {
            const raw = sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${sha256}`);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('RvmCacheStore read failed:', e);
            return null;
        }
    },

    set(sha256, bundleId, glbPath, indexPath) {
        if (!sha256) return;
        try {
            const data = { bundleId, glbPath, indexPath, timestamp: Date.now() };
            sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${sha256}`, JSON.stringify(data));
        } catch (e) {
            console.warn('RvmCacheStore write failed:', e);
        }
    },

    clear() {
        try {
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
                    sessionStorage.removeItem(key);
                }
            }
        } catch(e) {}
    }
};
