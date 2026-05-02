export class RvmTreeModel {
    constructor(rvmIndex, viewerContext) {
        this.rvmIndex = rvmIndex;
        this.viewerContext = viewerContext; // needs { viewer: RvmViewer3D }


        this._rootNodes = [];
        this._treeMap = new Map(); // canonicalId -> tree node obj
    }

    build() {
        this._rootNodes = [];
        this._treeMap.clear();

        if (!this.rvmIndex || !this.rvmIndex.nodes) return;

        // Pass 1: Create all tree node objects
        for (const node of this.rvmIndex.nodes) {
            const treeNode = {
                canonicalObjectId: node.canonicalObjectId,
                name: node.name || node.canonicalObjectId,
                kind: node.kind,
                parentCanonicalObjectId: node.parentCanonicalObjectId,
                children: []
            };
            this._treeMap.set(node.canonicalObjectId, treeNode);
        }

        // Pass 2: Link children to parents
        for (const [id, treeNode] of this._treeMap) {
            if (treeNode.parentCanonicalObjectId) {
                const parent = this._treeMap.get(treeNode.parentCanonicalObjectId);
                if (parent) {
                    parent.children.push(treeNode);
                } else {
                    // Parent not found, treat as root
                    this._rootNodes.push(treeNode);
                }
            } else {
                this._rootNodes.push(treeNode);
            }
        }
    }

    renderTree(containerEl) {
        if (!containerEl) return;
        containerEl.innerHTML = '';

        if (this._rootNodes.length === 0) {
            containerEl.innerHTML = '<div class="rvm-tree-empty">No hierarchy available</div>';
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'rvm-tree-root';

        for (const root of this._rootNodes) {
            ul.appendChild(this._renderTreeNode(root));
        }

        containerEl.appendChild(ul);
    }

    _renderTreeNode(treeNode) {
        const li = document.createElement('li');
        li.className = 'rvm-tree-node';
        li.dataset.id = treeNode.canonicalObjectId;

        const labelDiv = document.createElement('div');
        labelDiv.className = 'rvm-tree-label';


        // If it has children, add a toggle
        if (treeNode.children.length > 0) {
            const toggleSpan = document.createElement('span');
            toggleSpan.className = 'rvm-tree-toggle';
            toggleSpan.textContent = '▶'; // Can be styled via CSS or toggle classes
            toggleSpan.onclick = (e) => {
                e.stopPropagation();
                li.classList.toggle('rvm-tree-expanded');
                toggleSpan.textContent = li.classList.contains('rvm-tree-expanded') ? '▼' : '▶';
            };
            labelDiv.appendChild(toggleSpan);
        } else {
            const spacerSpan = document.createElement('span');
            spacerSpan.className = 'rvm-tree-spacer';
            labelDiv.appendChild(spacerSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'rvm-tree-text';
        const kind = String(treeNode.kind || '').trim();
        textSpan.textContent = kind && kind !== 'UNKNOWN'
          ? `[${kind}] ${treeNode.name}`
          : treeNode.name;
        labelDiv.appendChild(textSpan);

        // Click on the node text selects it in the viewer
        labelDiv.onclick = (e) => {
            e.stopPropagation();
            if (this.viewerContext && this.viewerContext.viewer) {
                this.viewerContext.viewer.selectByCanonicalId(treeNode.canonicalObjectId);
            }
        };

        li.appendChild(labelDiv);

        if (treeNode.children.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'rvm-tree-children';
            for (const child of treeNode.children) {
                ul.appendChild(this._renderTreeNode(child));
            }
            li.appendChild(ul);
        }

        return li;
    }

    dispose() {
        this._rootNodes = [];
        this._treeMap.clear();
        this.rvmIndex = null;
        this.viewerContext = null;
    }
}
