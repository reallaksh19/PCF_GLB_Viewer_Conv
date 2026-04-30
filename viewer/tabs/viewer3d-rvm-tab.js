import { RuntimeEvents } from '../contracts/runtime-events.js';
import { state, saveStickyState } from '../core/state.js';
import { on, off, emit } from '../core/event-bus.js';
import { detectRvmCapabilities } from '../rvm/RvmCapabilities.js';
import { notify } from '../diagnostics/notification-center.js';
import { RvmViewer3D } from '../rvm-viewer/RvmViewer3D.js';
import { parseRmssAttributes } from '../converters/rmss-attribute-parser.js';
import { downloadText } from '../pcfx/Pcfx_FileIO.js';

let _viewer = null;
let _shortcutHandler = null;
let _resizeObserver = null;
let _capabilitiesListenerOff = null;

// ── Toolbar action labels ───────────────────────────────────────────────────

const ACTION_LABELS = {
  NAV_ORBIT: 'Orbit',
  NAV_PAN: 'Pan',
  NAV_SELECT: 'Select',
  MEASURE_TOOL: 'Measure',
  VIEW_MARQUEE_ZOOM: 'Zoom',
  NAV_PLAN_X: 'PlanX',
  NAV_ROTATE_Y: 'RotY',
  NAV_ROTATE_Z: 'RotZ',
  VIEW_FIT_ALL: 'Reset',
  VIEW_FIT_SELECTION: 'FitSel',
  VIEW_TOGGLE_PROJECTION: 'Proj',
  SNAP_ISO_NW: 'NW',
  SNAP_ISO_NE: 'NE',
  SNAP_ISO_SW: 'SW',
  SNAP_ISO_SE: 'SE',
  SECTION_BOX: 'SecBox',
  SECTION_PLANE_UP: 'SecUp',
  SECTION_DISABLE: 'SecOff',
};

const ACTION_ICONS = {
  NAV_SELECT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>',
  NAV_ORBIT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  NAV_PAN: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
  VIEW_FIT_ALL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9V5h4"/><path d="M19 9V5h-4"/><path d="M5 15v4h4"/><path d="M19 15v4h-4"/></svg>',
  VIEW_FIT_SELECTION: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9V5h4"/><path d="M19 9V5h-4"/><path d="M5 15v4h4"/><path d="M19 15v4h-4"/><circle cx="12" cy="12" r="3"/></svg>',
  VIEW_TOGGLE_PROJECTION: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="m3 3 18 18"/><path d="m21 3-18 18"/></svg>',
  SECTION_BOX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  SECTION_PLANE_UP: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
  SECTION_DISABLE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  MEASURE_TOOL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="8" rx="2" ry="2"/><path d="M6 8v4"/><path d="M10 8v4"/><path d="M14 8v4"/><path d="M18 8v4"/></svg>',
  VIEW_MARQUEE_ZOOM: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="12" height="12" rx="1" stroke-dasharray="3 2"/><circle cx="17" cy="17" r="3"/><path d="m21 21-2.15-2.15"/></svg>',
  NAV_PLAN_X: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  NAV_ROTATE_Y: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  NAV_ROTATE_Z: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  SNAP_ISO_NW: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M7 7h4"/><path d="M7 11v-4"/></svg>',
  SNAP_ISO_NE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M17 7h-4"/><path d="M17 11v-4"/></svg>',
  SNAP_ISO_SW: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M7 17h4"/><path d="M7 13v4"/></svg>',
  SNAP_ISO_SE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M17 17h-4"/><path d="M17 13v4"/></svg>',
};

const UPLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><rect x="4" y="16" width="16" height="4" rx="1.5"/></svg>';

// ── Viewer stub (replaced by Agent 3 / RvmViewer3D) ────────────────────────

function _createViewerStub(container) {
  const viewport = container.querySelector('.rvm-viewport');
  if (viewport) {
    viewport.innerHTML = '<div class="rvm-placeholder">RVM Viewer initialising — load a .bundle.json to begin</div>';
  }
  return { dispose() {} };
}

// ── Teardown ────────────────────────────────────────────────────────────────

function _disposeRvmViewer() {
  if (_shortcutHandler) {
    window.removeEventListener('keydown', _shortcutHandler);
    _shortcutHandler = null;
  }
  if (_viewer) {
    _viewer.dispose();
    _viewer = null;
  }
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  if (_capabilitiesListenerOff) {
    _capabilitiesListenerOff();
    _capabilitiesListenerOff = null;
  }
}

// ── Capability banner ───────────────────────────────────────────────────────

function _renderCapabilityBanner(container, caps) {
  const banner = container.querySelector('#rvm-capability-banner');
  if (!banner) return;
  const mode = caps?.deploymentMode || 'static';
  const modeLabel = mode === 'assisted' ? 'Assisted (conversion enabled)' : 'Static (pre-converted bundles only)';
  banner.textContent = `Mode: ${modeLabel}`;
  banner.dataset.mode = mode;
}

// ── Bundle file loader ──────────────────────────────────────────────────────

function _bindBundleLoader(container) {
  const attrInput = container.querySelector('#rvm-attr-file-input');
  if (attrInput) {
    attrInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
          const text = await file.text();
          const hierarchyJson = parseRmssAttributes(text);

          downloadText(JSON.stringify(hierarchyJson, null, 2), file.name + '.json', 'application/json');

          emit(RuntimeEvents.FILE_LOADED, {
              name: file.name + '.json',
              source: 'rvm-tab',
              payload: hierarchyJson,
              kind: 'aveva-json'
          });
          notify({ type: 'info', message: `Converted RMSS Attributes to JSON hierarchy` });
      } catch (err) {
          notify({ type: 'error', message: `Failed to parse Attributes file: ${err.message}` });
      }
    });
  }

  const input = container.querySelector('#rvm-bundle-file-input');
  if (!input) return;
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const json = JSON.parse(text);

        if (Array.isArray(json)) {
            // It's a raw AVEVA hierarchy dump
            emit(RuntimeEvents.FILE_LOADED, {
                name: file.name,
                source: 'rvm-tab',
                payload: json,
                kind: 'aveva-json'
            });
        } else {
            // Standard .bundle.json manifest
            emit(RuntimeEvents.FILE_LOADED, {
                name: file.name,
                source: 'rvm-tab',
                payload: json,
                kind: 'bundle'
            });
        }
    } catch (err) {
        notify({ type: 'error', message: `Failed to parse JSON file: ${err.message}` });
    }
  });
}

// ── Search handler ──────────────────────────────────────────────────────────


function _bindAttrSearch(container) {
  const input = container.querySelector('#rvm-attr-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const term = input.value.toLowerCase();
    const rows = container.querySelectorAll('.rvm-attr-row');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  });
}

function _bindSearch(container) {
  const input = container.querySelector('#rvm-search-input');
  if (!input) return;
  let _debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      const query = input.value.trim();
      emit(RuntimeEvents.RVM_SEARCH_CHANGED, { query });
    }, 180);
  });
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

function _bindShortcuts(container) {
  if (_shortcutHandler) {
    window.removeEventListener('keydown', _shortcutHandler);
    _shortcutHandler = null;
  }
  _shortcutHandler = (e) => {
    if (!container.isConnected) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'f' || e.key === 'F') { _viewer?.fitAll?.(); }
    if (e.key === 'Escape') { _viewer?.clearSelection?.(); }
  };
  window.addEventListener('keydown', _shortcutHandler);
}

// ── HTML scaffold ───────────────────────────────────────────────────────────

function _buildHTML(caps) {
  // Always render the Load RVM button. If the local backend is dead, clicking it will trigger the GitHub PAT prompt.
  const isStaticMode = false;
  return `
<div class="geo-tab geo-theme-navisdark rvm-tab-root">
  <div class="geo-top-ribbon" id="rvm-top-ribbon">
    <div class="rvm-ribbon-section">
      <label class="rvm-btn rvm-btn-file" title="Load pre-converted .bundle.json">
        ${UPLOAD_ICON}<span>Load Bundle</span>
        <input type="file" id="rvm-bundle-file-input" accept=".json" style="display:none">
      </label>
      ${isStaticMode ? '' : `
      <label class="rvm-btn rvm-btn-file rvm-btn-assisted" title="Upload raw .rvm for conversion">
        ${UPLOAD_ICON}<span>Load RVM</span>
        <input type="file" id="rvm-raw-file-input" accept=".rvm" style="display:none">
      </label>
      `}
      <label class="rvm-btn rvm-btn-file rvm-btn-assisted" title="Convert RMSS Attributes file to JSON hierarchy">
        ${UPLOAD_ICON}<span>Att Txt -> Json</span>
        <input type="file" id="rvm-attr-file-input" accept=".txt" style="display:none">
      </label>
    </div>
    <div class="rvm-ribbon-section rvm-ribbon-nav">
      ${Object.entries(ACTION_ICONS).map(([id, icon]) => `
        <button class="rvm-tool-btn" data-action="${id}" title="${ACTION_LABELS[id] || id}">
          ${icon}<span>${ACTION_LABELS[id] || id}</span>
        </button>
      `).join('')}
      <div style="border-left:1px solid #444;margin:0 5px;height:24px;"></div>
      <button class="rvm-tool-btn" data-action="TAKE_SNAPSHOT" title="Take View Snapshot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Snapshot</span>
      </button>
    </div>
    <div class="rvm-ribbon-section rvm-ribbon-search">
      <input type="search" id="rvm-search-input" placeholder="Search objects…" autocomplete="off">
    </div>
  </div>
  <div id="rvm-capability-banner" class="rvm-capability-banner"></div>
  <div class="geo-body rvm-body">
    <div class="geo-left-panel rvm-left-panel">
      <div class="rvm-panel-header">Hierarchy</div>
      <ul id="rvm-hierarchy-tree" class="rvm-tree" role="tree" aria-label="Model hierarchy"></ul>
      <div class="rvm-panel-header">Search Results</div>
      <ul id="rvm-search-results" class="rvm-tree" role="list"></ul>
    </div>
    <div class="rvm-viewport" id="rvm-viewport">
      <canvas class="rvm-canvas" id="rvm-canvas"></canvas>
    </div>
    <div class="geo-right-panel rvm-right-panel">
      <div class="rvm-panel-header">Attributes</div>
      <input type="text" id="rvm-attr-search" placeholder="Filter attributes..." style="width: 100%; box-sizing: border-box; padding: 4px; background: #222; color: #fff; border: 1px solid #444;">
      <div id="rvm-attributes-content" class="rvm-attributes-panel"></div>
      <div class="rvm-panel-header">Review Tags</div>
      <div style="display:flex;gap:5px;padding:5px;background:#1a1a1a;">
        <select id="rvm-tag-severity-filter" style="flex:1;background:#333;color:#fff;border:1px solid #555;">
          <option value="all">All Tags</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </div>
      <div style="display:flex;gap:5px;padding:5px;">
        <label class="rvm-btn" style="flex:1;text-align:center;cursor:pointer;" title="Import Tags from XML">
          Import
          <input type="file" id="rvm-import-tags-input" accept=".xml" style="display:none">
        </label>
        <button class="rvm-btn" id="rvm-export-tags-btn" style="flex:1;" disabled title="Export Tags to XML">Export</button>
      </div>
      <div id="rvm-tag-list" class="rvm-tag-list"></div>
      <button class="rvm-btn" id="rvm-add-tag-btn" disabled>+ Add Tag</button>
    </div>
  </div>
</div>`.trim();
}

// ── Toolbar action dispatch ─────────────────────────────────────────────────

function _bindToolbarActions(container) {
  const ribbon = container.querySelector('#rvm-top-ribbon');
  if (!ribbon) return;
  ribbon.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'NAV_ORBIT':   _viewer?.setNavMode?.('orbit'); break;
      case 'NAV_PAN':     _viewer?.setNavMode?.('pan'); break;
      case 'NAV_SELECT':  _viewer?.setNavMode?.('select'); break;
      case 'MEASURE_TOOL': _viewer?.setNavMode?.('Measure'); break;
      case 'VIEW_MARQUEE_ZOOM': _viewer?.setNavMode?.('Zoom'); break;
      case 'NAV_PLAN_X':  _viewer?.snapToPreset?.('TOP'); break;
      case 'NAV_ROTATE_Y': _viewer?.snapToPreset?.('FRONT'); break;
      case 'NAV_ROTATE_Z': _viewer?.snapToPreset?.('RIGHT'); break;
      case 'SNAP_ISO_NW': _viewer?.snapToPreset?.('ISO_NW'); break;
      case 'SNAP_ISO_NE': _viewer?.snapToPreset?.('ISO_NE'); break;
      case 'SNAP_ISO_SW': _viewer?.snapToPreset?.('ISO_SW'); break;
      case 'SNAP_ISO_SE': _viewer?.snapToPreset?.('ISO_SE'); break;
      case 'VIEW_FIT_ALL': _viewer?.fitAll?.(); break;
      case 'VIEW_FIT_SELECTION': _viewer?.fitSelection?.(); break;
      case 'VIEW_TOGGLE_PROJECTION': _viewer?.toggleProjection?.(); break;
      case 'SECTION_BOX': _viewer?.setSectionMode?.('BOX'); break;
      case 'SECTION_PLANE_UP': _viewer?.setSectionMode?.('PLANE_UP'); break;
      case 'SECTION_DISABLE': _viewer?.disableSection?.(); break;
      case 'TAKE_SNAPSHOT': {
        if (_viewer && _viewer.renderer) {
            _viewer.renderer.render(_viewer.scene, _viewer.camera);
            const dataURL = _viewer.renderer.domElement.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = `rvm_snapshot_${Date.now()}.png`;
            a.click();
            notify({ type: 'success', message: 'Snapshot downloaded successfully' });
        }
        break;
      }
    }
  });
}

// ── ResizeObserver ──────────────────────────────────────────────────────────

function _bindResize(container) {
  if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
  const viewport = container.querySelector('#rvm-viewport');
  if (!viewport || typeof ResizeObserver === 'undefined') return;
  _resizeObserver = new ResizeObserver(() => {
    _viewer?.onResize?.();
  });
  _resizeObserver.observe(viewport);
}

// ── Tab event listener (TAB_CHANGED) ───────────────────────────────────────

function _bindTabListener() {
  const tabChangedCallback = ({ tabId }) => {
    if (tabId !== 'viewer3d-rvm') _disposeRvmViewer();
  };
  const modelLoadedCallback = (payload) => {
    if (_viewer && payload && payload.gltf && payload.gltf.scene) {
        _viewer.setModel(payload.gltf.scene, payload.manifest?.runtime?.upAxis);
        _viewer.fitAll();

        const container = document.querySelector('.rvm-tab-root');
        if (container) {
            const exportBtn = container.querySelector('#rvm-export-tags-btn');
            if (exportBtn) exportBtn.disabled = false;

            // Initial render of tags if any were loaded with bundle
            _renderTagList(container);
        }
    }
  };

  on(RuntimeEvents.TAB_CHANGED, tabChangedCallback);
  on(RuntimeEvents.RVM_MODEL_LOADED, modelLoadedCallback);

  _capabilitiesListenerOff = () => {
    off(RuntimeEvents.TAB_CHANGED, tabChangedCallback);
    off(RuntimeEvents.RVM_MODEL_LOADED, modelLoadedCallback);
  };
}

// ── Public render function ─────────────────────────────────────────────────

export function renderViewer3DRvm(container) {
  _disposeRvmViewer();

  // Capability probe runs async; render with static caps first, update banner when resolved
  const caps = { ...state.rvm.capabilities } || null;
  container.innerHTML = _buildHTML(caps);

  _renderCapabilityBanner(container, caps);
  _bindBundleLoader(container);
  _bindAttrSearch(container);
  _bindSearch(container);
  _bindToolbarActions(container);
  _bindResize(container);
  _bindShortcuts(container);
  _bindTabListener();
  _bindTags(container);

  // Initialize the actual RvmViewer3D instance inside the viewport container
  const viewport = container.querySelector('.rvm-viewport');
  if (viewport) {
      viewport.innerHTML = '';
      _viewer = new RvmViewer3D(viewport, { identityMap: state.rvm.identityMap });
  }

  // Async capability probe — update banner once resolved
  detectRvmCapabilities(null).then((resolvedCaps) => {
    state.rvm.capabilities = resolvedCaps;
    _renderCapabilityBanner(container, resolvedCaps);

    // If assisted mode is resolved later, we need to update the HTML to show the raw import button
    if (resolvedCaps.deploymentMode === 'assisted' && !container.querySelector('#rvm-raw-file-input')) {
        const ribbon = container.querySelector('.rvm-ribbon-section');
        if (ribbon) {
            // Use DOM manipulation instead of innerHTML to avoid stripping existing event listeners
            const label = document.createElement('label');
            label.className = 'rvm-btn rvm-btn-file rvm-btn-assisted';
            label.title = 'Upload raw .rvm for conversion';

            const span = document.createElement('span');
            span.textContent = 'Load RVM';

            const input = document.createElement('input');
            input.type = 'file';
            input.id = 'rvm-raw-file-input';
            input.accept = '.rvm';
            input.style.display = 'none';

            label.innerHTML = UPLOAD_ICON;
            label.appendChild(span);
            label.appendChild(input);

            ribbon.appendChild(label);

            // Bind the newly added raw input
            input.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                emit(RuntimeEvents.FILE_LOADED, {
                    name: file.name,
                    source: 'rvm-tab',
                    payload: file,
                    kind: 'raw-rvm'
                });
            });
        }
    }

    // Ensure raw input is bound if it exists (e.g., if injected by test or actual assisted deployment)
    const existingRawInput = container.querySelector('#rvm-raw-file-input');
    if (existingRawInput) {
        existingRawInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            emit(RuntimeEvents.FILE_LOADED, {
                name: file.name,
                source: 'rvm-tab',
                payload: file,
                kind: 'raw-rvm'
            });
        });
    }
  });

  return _disposeRvmViewer;
}


function _renderTagList(container, filter = 'all') {
    const listEl = container.querySelector('#rvm-tag-list');
    if (!listEl || !_viewer || !_viewer.tagStore) return;

    let tags = _viewer.tagStore.getAllTags();
    if (filter !== 'all') {
        tags = tags.filter(t => (t.severity || 'info').toLowerCase() === filter);
    }

    listEl.innerHTML = tags.map(t => {
        let color = '#3d74c5';
        const sev = (t.severity || 'info').toLowerCase();
        if (sev === 'high') color = '#cc2222';
        else if (sev === 'medium') color = '#aa8822';
        else if (sev === 'low') color = '#22aa55';

        return `<div class="rvm-tag-item" data-id="${t.id}" style="padding:8px;border-left:4px solid ${color};margin-bottom:4px;background:#2a2a2a;cursor:pointer;">
            <div style="font-weight:bold;margin-bottom:4px;">${t.text || t.id}</div>
            <div style="font-size:10px;color:#888;">Severity: ${sev.toUpperCase()}</div>
        </div>`;
    }).join('');

    // Add click listeners to jump to tag
    const items = listEl.querySelectorAll('.rvm-tag-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            _viewer.jumpToTag(id);
        });
    });
}

function _bindTags(container) {
  const filterSelect = container.querySelector('#rvm-tag-severity-filter');
  if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
          _renderTagList(container, e.target.value);
      });
  }

  // Hook into RuntimeEvents to auto-refresh the tag list
  on(RuntimeEvents.RVM_TAG_CREATED, () => {
      const filter = filterSelect ? filterSelect.value : 'all';
      _renderTagList(container, filter);
  });
  on(RuntimeEvents.RVM_TAG_DELETED, () => {
      const filter = filterSelect ? filterSelect.value : 'all';
      _renderTagList(container, filter);
  });

  const exportBtn = container.querySelector('#rvm-export-tags-btn');
  const importInput = container.querySelector('#rvm-import-tags-input');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!_viewer || !_viewer.tagStore) return;
      const xmlString = _viewer.tagStore.exportToXml();
      downloadText(xmlString, 'tags.xml', 'application/xml');
    });
  }

  if (importInput) {
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const xmlText = await file.text();
        if (_viewer && _viewer.tagStore) {
            _viewer.tagStore.importFromXml(xmlText);
            notify({ type: 'success', message: 'Tags imported successfully' });
        } else {
            notify({ type: 'warning', message: 'No model loaded to import tags into' });
        }
      } catch (err) {
        notify({ type: 'error', message: `Failed to import tags: ${err.message}` });
      }
      importInput.value = ''; // reset
    });
  }
}
