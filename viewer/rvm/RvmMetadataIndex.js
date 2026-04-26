export class RvmMetadataIndex {
  constructor(rvmIndex, identityMap) {
    this.index = rvmIndex;
    this.identityMap = identityMap;
    this._nodeByCanonical = new Map();

    if (this.index && this.index.nodes) {
      for (const node of this.index.nodes) {
        this._nodeByCanonical.set(node.canonicalObjectId, node);
      }
    }
  }

  getAttributesByCanonicalId(canonicalId) {
    const node = this._nodeByCanonical.get(canonicalId);
    return node ? node.attributes : null;
  }

  getAttributesByRenderId(renderId) {
    const canonicalId = this.identityMap.canonicalFromRender(renderId);
    if (!canonicalId) return null;
    return this.getAttributesByCanonicalId(canonicalId);
  }

  getRenderIdsByCanonicalId(canonicalId) {
    return this.identityMap.renderIdsFromCanonical(canonicalId);
  }

  getNodeByCanonicalId(canonicalId) {
    return this._nodeByCanonical.get(canonicalId) || null;
  }

  renderAttributesPanel(el, canonicalId) {
    el.innerHTML = '';
    const node = this.getNodeByCanonicalId(canonicalId);
    if (!node || !node.attributes) return;

    const table = document.createElement('table');
    table.className = 'rvm-attributes-table';

    const knownFields = new Set(['ZONE', 'SPEC', 'NPD', 'PIPE_NAME', 'ELEMENT_TYPE']);

    for (const [key, value] of Object.entries(node.attributes)) {
      const row = document.createElement('tr');

      const keyCell = document.createElement('td');
      keyCell.textContent = key;
      if (knownFields.has(key)) {
        keyCell.className = 'rvm-attr-highlight';
      }

      const valCell = document.createElement('td');
      valCell.textContent = String(value);

      row.appendChild(keyCell);
      row.appendChild(valCell);
      table.appendChild(row);
    }

    el.appendChild(table);
  }
}
