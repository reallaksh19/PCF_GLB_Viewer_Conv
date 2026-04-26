export class RvmSearchIndex {
  constructor(metadataIndex) {
    this.metadataIndex = metadataIndex;
    this.entries = [];
  }

  async build() {
    if (!this.metadataIndex || !this.metadataIndex.index || !this.metadataIndex.index.nodes) {
      return;
    }

    const nodes = this.metadataIndex.index.nodes;

    return new Promise((resolve) => {
      let i = 0;
      const batchSize = 500;

      const processBatch = () => {
        const end = Math.min(i + batchSize, nodes.length);

        for (; i < end; i++) {
          const node = nodes[i];
          const textChunks = [
            node.sourceObjectId,
            node.canonicalObjectId,
            node.name,
            node.path,
            node.kind
          ];

          if (node.attributes) {
            for (const val of Object.values(node.attributes)) {
              textChunks.push(String(val));
            }
          }

          this.entries.push({
            canonicalObjectId: node.canonicalObjectId,
            renderObjectIds: this.metadataIndex.getRenderIdsByCanonicalId(node.canonicalObjectId) || [],
            attrs: node.attributes || {},
            _searchText: textChunks.join(' ').toLowerCase()
          });
        }

        if (i < nodes.length) {
          setTimeout(processBatch, 0);
        } else {
          resolve();
        }
      };

      processBatch();
    });
  }

  search(query) {
    if (!query) return [];

    const q = query.toLowerCase();
    return this.entries.filter(entry => entry._searchText.includes(q)).map(e => ({
      canonicalObjectId: e.canonicalObjectId,
      renderObjectIds: e.renderObjectIds,
      attrs: e.attrs
    }));
  }
}
