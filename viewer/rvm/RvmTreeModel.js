export class RvmTreeModel {
  constructor(metadataIndex) {
    this.metadataIndex = metadataIndex;
    this.rootNodes = [];
    this.childrenMap = new Map();
    this.nodeMap = new Map();
    this.onNodeSelected = null;
    this._build();
  }

  _build() {
    if (!this.metadataIndex || !this.metadataIndex.index || !this.metadataIndex.index.nodes) {
      return;
    }

    const nodes = this.metadataIndex.index.nodes;

    for (const node of nodes) {
      this.nodeMap.set(node.canonicalObjectId, node);

      const parentId = node.parentCanonicalObjectId;
      if (!parentId) {
        this.rootNodes.push(node);
      } else {
        if (!this.childrenMap.has(parentId)) {
          this.childrenMap.set(parentId, []);
        }
        this.childrenMap.get(parentId).push(node);
      }
    }
  }

  render(container) {
    container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'rvm-tree-root';

    for (const node of this.rootNodes) {
      ul.appendChild(this._renderNode(node));
    }

    container.appendChild(ul);
  }

  _renderNode(node) {
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'rvm-tree-label';
    label.textContent = node.name || node.canonicalObjectId;

    label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onNodeSelected) {
        this.onNodeSelected(node.canonicalObjectId);
      }
    });

    li.appendChild(label);

    const children = this.childrenMap.get(node.canonicalObjectId);
    if (children && children.length > 0) {
      const childrenUl = document.createElement('ul');
      for (const child of children) {
        childrenUl.appendChild(this._renderNode(child));
      }
      li.appendChild(childrenUl);
    }

    return li;
  }
}
