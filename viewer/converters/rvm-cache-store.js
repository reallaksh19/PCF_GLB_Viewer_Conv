export class RvmCacheStore {
  constructor() {
    this.storageKey = 'viewer3d_rvm_cache_v1';
  }

  _loadCache() {
    try {
      const data = sessionStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  _saveCache(cache) {
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(cache));
    } catch {
      // Ignore sessionStorage quota errors
    }
  }

  get(sha256) {
    if (!sha256) return null;
    const cache = this._loadCache();
    return cache[sha256] || null;
  }

  set(sha256, metadata) {
    if (!sha256) return;
    const cache = this._loadCache();
    cache[sha256] = metadata;
    this._saveCache(cache);
  }

  clear() {
    sessionStorage.removeItem(this.storageKey);
  }
}

export const rvmCacheStore = new RvmCacheStore();
