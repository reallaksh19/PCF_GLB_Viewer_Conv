/**
 * RvmTreeModel — converts flat RvmIndex nodes into a hierarchical tree.
 */
export class RvmTreeModel {
  constructor() {
    this.roots = [];
  }

  /**
   * Builds the tree structure from a flat list of nodes.
   * @param {Array<object>} nodes Array of RvmIndex.nodes
   */
  build(nodes) {
    this.roots = [];
    if (!nodes || !Array.isArray(nodes)) return;

    const nodeMap = new Map();

    // First pass: create node objects
    for (const node of nodes) {
      nodeMap.set(node.canonicalObjectId, {
        ...node,
        children: []
      });
    }

    // Second pass: wire up children
    for (const node of nodeMap.values()) {
      if (node.parentCanonicalObjectId) {
        const parent = nodeMap.get(node.parentCanonicalObjectId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Parent missing, treat as root
          this.roots.push(node);
        }
      } else {
        // No parent, treat as root
        this.roots.push(node);
      }
    }
  }

  /**
   * Renders the tree into the DOM element.
   * @param {HTMLElement} el The container element
   * @param {object} viewer The RvmViewer3D instance (used for click handling)
   */
  render(el, viewer) {
    if (!el) return;
    el.innerHTML = '';

    if (this.roots.length === 0) {
      el.innerHTML = '<div class="rvm-empty-state">No hierarchy available</div>';
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'rvm-tree-root';

    for (const root of this.roots) {
      this._renderNode(root, ul, viewer);
    }

    el.appendChild(ul);
  }

  _renderNode(node, parentEl, viewer) {
    const li = document.createElement('li');
    li.className = 'rvm-tree-node';

    const label = document.createElement('span');
    label.className = 'rvm-tree-label';
    label.textContent = node.name || node.canonicalObjectId;

    // Make label clickable
    label.style.cursor = 'pointer';
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewer && viewer.selectByCanonicalId) {
        viewer.selectByCanonicalId(node.canonicalObjectId);
        if (viewer.fitSelection) {
          viewer.fitSelection();
        }
      }
    });

    li.appendChild(label);

    if (node.children && node.children.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'rvm-tree-children';
      for (const child of node.children) {
        this._renderNode(child, ul, viewer);
      }
      li.appendChild(ul);
    }

    parentEl.appendChild(li);
  }
}
