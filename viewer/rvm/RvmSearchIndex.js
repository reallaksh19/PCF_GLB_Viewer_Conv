/**
 * RvmSearchIndex — builds and queries a text-based search index over RVM nodes.
 */
export class RvmSearchIndex {
  constructor() {
    this._index = []; // Array of { canonicalObjectId, renderObjectIds, attrs, _searchText }
    this._isBuilding = false;
  }

  /**
   * Asynchronously builds the search index. Yields to the event loop every 500 nodes.
   * @param {Array<object>} nodes Array of RvmIndex.nodes
   * @param {import('./RvmIdentityMap.js').RvmIdentityMap} identityMap
   * @returns {Promise<void>}
   */
  async build(nodes, identityMap) {
    this._isBuilding = true;
    this._index = [];

    if (!nodes || !Array.isArray(nodes)) {
      this._isBuilding = false;
      return;
    }

    return new Promise((resolve) => {
      let i = 0;
      const CHUNK_SIZE = 500;

      const processChunk = () => {
        const end = Math.min(i + CHUNK_SIZE, nodes.length);
        for (; i < end; i++) {
          const node = nodes[i];
          const renderObjectIds = identityMap.renderIdsFromCanonical(node.canonicalObjectId) || [];

          let searchText = `${node.sourceObjectId || ''} ${node.canonicalObjectId || ''} ${node.name || ''} ${node.path || ''} ${node.kind || ''}`;

          if (node.attributes) {
             for (const [key, value] of Object.entries(node.attributes)) {
               searchText += ` ${key} ${value}`;
             }
          }

          this._index.push({
            canonicalObjectId: node.canonicalObjectId,
            renderObjectIds,
            attrs: node.attributes || {},
            _searchText: searchText.toLowerCase(),
          });
        }

        if (i < nodes.length) {
          setTimeout(processChunk, 0);
        } else {
          this._isBuilding = false;
          resolve();
        }
      };

      processChunk();
    });
  }

  /**
   * Searches the index.
   * @param {string} query
   * @returns {Array<{ canonicalObjectId: string, renderObjectIds: string[], attrs: Record<string, any> }>}
   */
  search(query) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return [];
    }

    const q = query.toLowerCase().trim();

    return this._index
      .filter(item => item._searchText.includes(q))
      .map(item => ({
        canonicalObjectId: item.canonicalObjectId,
        renderObjectIds: item.renderObjectIds,
        attrs: item.attrs,
      }));
  }

  get isBuilding() {
    return this._isBuilding;
  }
}
