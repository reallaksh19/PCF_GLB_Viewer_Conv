/**
 * RvmMetadataIndex — Single source of truth for RVM node attributes and identity resolution.
 */
export class RvmMetadataIndex {
  /**
   * @param {import('./RvmIdentityMap.js').RvmIdentityMap} identityMap
   * @param {object} rvmIndex The parsed model.index.json
   */
  constructor(identityMap, rvmIndex) {
    this.identityMap = identityMap;
    // Fast lookup for nodes by canonicalObjectId
    this._nodesByCanonical = new Map();

    if (rvmIndex && Array.isArray(rvmIndex.nodes)) {
      for (const node of rvmIndex.nodes) {
        this._nodesByCanonical.set(node.canonicalObjectId, node);
      }
    }
  }

  /**
   * Resolves a render object ID to its canonical metadata.
   * @param {string} renderObjectId
   * @returns {{ canonicalObjectId: string, attributes: Record<string, string|number|boolean> } | null}
   */
  lookupByRenderId(renderObjectId) {
    const canonicalObjectId = this.identityMap.canonicalFromRender(renderObjectId);
    if (!canonicalObjectId) return null;

    return this.lookupByCanonicalId(canonicalObjectId);
  }

  /**
   * Resolves a canonical object ID to its render object IDs and attributes.
   * @param {string} canonicalObjectId
   * @returns {{ renderObjectIds: string[], attributes: Record<string, string|number|boolean> } | null}
   */
  lookupByCanonicalId(canonicalObjectId) {
    const node = this._nodesByCanonical.get(canonicalObjectId);
    if (!node) return null;

    const renderObjectIds = this.identityMap.renderIdsFromCanonical(canonicalObjectId);

    return {
      canonicalObjectId,
      renderObjectIds,
      attributes: node.attributes || {},
    };
  }

  /**
   * Renders the attribute panel into the given DOM element for the specified node.
   * Highlights known PDMS fields.
   * @param {HTMLElement} el
   * @param {{ attributes: Record<string, any> }} node
   */
  renderAttributesPanel(el, node) {
    if (!el) return;
    el.innerHTML = '';

    if (!node || !node.attributes || Object.keys(node.attributes).length === 0) {
      el.innerHTML = '<div class="rvm-empty-state">No attributes available</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'rvm-attributes-table';

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    const PDMS_HIGHLIGHT_FIELDS = ['ZONE', 'SPEC', 'NPD', 'PIPE_NAME', 'ELEMENT_TYPE'];

    for (const [key, value] of Object.entries(node.attributes)) {
      const tr = document.createElement('tr');
      if (PDMS_HIGHLIGHT_FIELDS.includes(key.toUpperCase())) {
        tr.classList.add('rvm-pdms-highlight');
      }

      const th = document.createElement('th');
      th.textContent = key;

      const td = document.createElement('td');
      td.textContent = String(value);

      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    el.appendChild(table);
  }
}
