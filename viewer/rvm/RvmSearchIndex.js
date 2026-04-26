export class RvmSearchIndex {
    constructor(rvmIndex, identityMap) {
        this.rvmIndex = rvmIndex;
        this.identityMap = identityMap;
        this.indexReady = false;
        this._searchableEntries = []; // Pre-built flat list of searchable objects
        this._buildPromise = null;
    }

    async build() {
        if (this._buildPromise) return this._buildPromise;

        this._buildPromise = new Promise((resolve) => {
            if (!this.rvmIndex || !this.rvmIndex.nodes || this.rvmIndex.nodes.length === 0) {
                this.indexReady = true;
                resolve();
                return;
            }

            const nodes = this.rvmIndex.nodes;
            const total = nodes.length;
            let current = 0;
            const CHUNK_SIZE = 500;

            const processChunk = () => {
                const end = Math.min(current + CHUNK_SIZE, total);
                for (; current < end; current++) {
                    const node = nodes[current];


                    // Build a concatenated searchable string for this node
                    let searchableText = [
                        node.sourceObjectId || '',
                        node.canonicalObjectId || '',
                        node.name || '',
                        node.path || '',
                        node.kind || ''
                    ].join(' ').toLowerCase();

                    if (node.attributes) {
                        for (const [key, val] of Object.entries(node.attributes)) {
                            searchableText += ' ' + key.toLowerCase() + ' ' + String(val).toLowerCase();
                        }
                    }

                    // Pre-resolve render IDs
                    let renderObjectIds = [node.canonicalObjectId];
                    if (this.identityMap) {
                        renderObjectIds = this.identityMap.getRenderIdsByCanonicalId?.(node.canonicalObjectId) || [node.canonicalObjectId];
                    }

                    this._searchableEntries.push({
                        canonicalObjectId: node.canonicalObjectId,
                        renderObjectIds: renderObjectIds,
                        attrs: node.attributes,
                        _text: searchableText
                    });
                }

                if (current < total) {
                    setTimeout(processChunk, 0); // Yield to main thread
                } else {
                    this.indexReady = true;
                    resolve();
                }
            };

            processChunk();
        });

        return this._buildPromise;
    }

    search(query) {
        if (!this.indexReady || !query || typeof query !== 'string') return [];
        const normalizedQuery = query.toLowerCase().trim();
        if (normalizedQuery === '') return [];

        const results = [];
        for (let i = 0; i < this._searchableEntries.length; i++) {
            const entry = this._searchableEntries[i];
            if (entry._text.includes(normalizedQuery)) {
                results.push({
                    canonicalObjectId: entry.canonicalObjectId,
                    renderObjectIds: entry.renderObjectIds,
                    attrs: entry.attrs
                });
            }
        }
        return results;
    }

    dispose() {
        this._searchableEntries = [];
        this.indexReady = false;
        this._buildPromise = null;
        this.rvmIndex = null;
        this.identityMap = null;
    }
}
