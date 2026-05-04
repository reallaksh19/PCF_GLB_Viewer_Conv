import { RuntimeEvents } from '../contracts/runtime-events.js';
import { state, saveStickyState } from '../core/state.js';
import { on, off, emit } from '../core/event-bus.js';
import { detectRvmCapabilities } from '../rvm/RvmCapabilities.js';
import { notify } from '../diagnostics/notification-center.js';
import { RvmViewer3D } from '../rvm-viewer/RvmViewer3D.js';
import { parseRmssAttributes } from '../converters/rmss-attribute-parser.js';
import { RvmSearchIndex } from '../rvm/RvmSearchIndex.js';
import { RvmTagXmlStore } from '../rvm/RvmTagXmlStore.js';

let _viewer = null;
let _shortcutHandler = null;
let _resizeObserver = null;
let _capabilitiesListenerOff = null;
let _toolChangedHandler = null;
let _tagEventsOff = null;

// â”€â”€ Toolbar action labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  SECTION_BOX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity="0.16"/><path d="M4 10h16"/><path d="M10 4v16"/></svg>',
  SECTION_PLANE_UP: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16h18"/><path d="M12 4v10"/><path d="m8.5 8.5 3.5-4 3.5 4"/></svg>',
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
const TOOL_ACTION_TO_MODE = Object.freeze({
  NAV_ORBIT: 'orbit',
  NAV_PAN: 'pan',
  NAV_SELECT: 'select',
  MEASURE_TOOL: 'measure',
  VIEW_MARQUEE_ZOOM: 'zoom',
});

function _setActiveToolButton(container, action) {
  const buttons = container.querySelectorAll('.rvm-tool-btn[data-action]');
  buttons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.action === action);
  });
}

function _pulseButton(btn) {
  btn.classList.add('is-pressed');
  setTimeout(() => btn.classList.remove('is-pressed'), 160);
}

// â”€â”€ Viewer stub (replaced by Agent 3 / RvmViewer3D) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _createViewerStub(container) {
  const viewport = container.querySelector('.rvm-viewport');
  if (viewport) {
    viewport.innerHTML = '<div class="rvm-placeholder">RVM Viewer initializing - load a .bundle.json to begin</div>';
  }
  return { dispose() {} };
}

// â”€â”€ Teardown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  if (_toolChangedHandler) {
    window.removeEventListener('app:tool-changed', _toolChangedHandler);
    _toolChangedHandler = null;
  }
  if (_tagEventsOff) {
    _tagEventsOff();
    _tagEventsOff = null;
  }
}

// â”€â”€ Capability banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _renderCapabilityBanner(container, caps) {
  const banner = container.querySelector('#rvm-capability-banner');
  if (!banner) return;
  const mode = caps?.deploymentMode || 'static';
  const modeLabel = mode === 'assisted' ? 'Assisted (conversion enabled)' : 'Static (pre-converted bundles only)';
  banner.textContent = `Mode: ${modeLabel}`;
  banner.dataset.mode = mode;
}

// â”€â”€ Bundle file loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _bindBundleLoader(container) {
  const input = container.querySelector('#rvm-universal-file-input');
  if (!input) return;

  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Separate RVM and its sidecars (ATT/TXT) if uploaded together
    const rvmFiles = files.filter(f => f.name.toLowerCase().endsWith('.rvm') || f.name.toLowerCase().endsWith('.rev'));
    const sidecars = files.filter(f => f.name.toLowerCase().endsWith('.att') || f.name.toLowerCase().endsWith('.txt'));
    const otherFiles = files.filter(f => !rvmFiles.includes(f) && !sidecars.includes(f));

    // 1. Process RVM + Sidecars together
    for (const rvmFile of rvmFiles) {
        const importKind = rvmFile.name.toLowerCase().endsWith('.rev') ? 'raw-rev' : 'raw-rvm';
        emit(RuntimeEvents.FILE_LOADED, { 
            name: rvmFile.name, 
            source: 'rvm-tab', 
            payload: rvmFile,
            sidecars: sidecars, // Pass sidecars to RVM bridge
            kind: importKind 
        });
    }

    // 2. Process standalone ATT files (only if no RVMs were uploaded)
    if (rvmFiles.length === 0) {
        for (const sidecar of sidecars) {
            try {
                const text = await sidecar.text();
                const hierarchyJson = parseRmssAttributes(text, state.rvm?.routing);
                if (!Array.isArray(hierarchyJson) || hierarchyJson.length === 0) {
                    notify({ type: 'warning', message: 'No branch/fitting topology was parsed from attribute file.' });
                }
                emit(RuntimeEvents.FILE_LOADED, { name: sidecar.name + '.json', source: 'rvm-tab', payload: hierarchyJson, kind: 'aveva-json' });
                notify({ type: 'info', message: `Converted RMSS Attributes to JSON hierarchy` });
            } catch (err) {
                notify({ type: 'error', message: `Failed to parse ${sidecar.name}: ${err.message}` });
            }
        }
    }

    // 3. Process remaining files (JSON, GLB)
    for (const file of otherFiles) {
      const ext = file.name.split('.').pop().toLowerCase();
      try {
        if (ext === 'json') {
          const text = await file.text();
          const json = JSON.parse(text);
          const isBundleManifest = Boolean(json) && typeof json === 'object' && json.schemaVersion === 'rvm-bundle/v1';
          emit(RuntimeEvents.FILE_LOADED, { name: file.name, source: 'rvm-tab', payload: json, kind: isBundleManifest ? 'bundle' : 'aveva-json' });
        } else if (ext === 'glb' || ext === 'gltf') {
          const url = URL.createObjectURL(file);
          const bundleId = `direct-glb-${Date.now()}`;
          const mockManifest = {
              schemaVersion: 'rvm-bundle/v1',
              bundleId,
              artifacts: { glb: url },
              runtime: { units: 'mm', upAxis: 'Y', scale: 1, originOffset: [0,0,0] }
          };
          emit(RuntimeEvents.FILE_LOADED, { name: file.name, source: 'rvm-tab', payload: mockManifest, kind: 'bundle' });
        }
      } catch (err) {
        notify({ type: 'error', message: `Failed to parse ${file.name}: ${err.message}` });
      }
    }
    
    e.target.value = ''; // Reset input
  });
}

// â”€â”€ Search handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€



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
    _debounce = setTimeout(async () => {
      const query = input.value.trim();
      emit(RuntimeEvents.RVM_SEARCH_CHANGED, { query });

      const viewer = _viewer;
      if (!viewer || !viewer.searchIndex) return;
      if (viewer.searchIndex.build && !viewer.searchIndex.indexReady) {
        await viewer.searchIndex.build();
      }
      const results = viewer.searchIndex.search(query);
      const list = container.querySelector('#rvm-search-results');
      if (!list) return;
      list.innerHTML = results.map((r) => {
        const label = escapeHtml(`${r.kind ? `[${r.kind}] ` : ''}${r.name || r.canonicalObjectId}`);
        return `<li class="rvm-search-item" style="cursor:pointer;" data-id="${escapeHtml(r.canonicalObjectId)}">${label}</li>`;
      }).join('');
      const items = list.querySelectorAll('.rvm-search-item');
      items.forEach((li) => {
        li.addEventListener('click', () => {
          const currentViewer = _viewer;
          const id = li.dataset.id;
          if (!currentViewer || !id || typeof currentViewer.selectByCanonicalId !== 'function') return;
          currentViewer.selectByCanonicalId(id);
          currentViewer.fitSelection();
          list.querySelectorAll('.rvm-search-item').forEach((item) => item.classList.remove('is-selected'));
          li.classList.add('is-selected');
        });
      });
    }, 180);
  });
}


// â”€â”€ Keyboard shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


function _bindShortcuts(container) {
  if (_shortcutHandler) {
    window.removeEventListener('keydown', _shortcutHandler);
    _shortcutHandler = null;
  }
  _shortcutHandler = (e) => {
    if (!container.isConnected) return;
    if (e.key === 'Escape') {
        _closeTagModal(container);
        _viewer?.clearSelection?.();
        _viewer?.setNavMode?.('orbit');
        _setActiveToolButton(container, 'NAV_ORBIT');
        return;
    }
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'f' || e.key === 'F') { _viewer?.fitAll?.(); }
  };
  window.addEventListener('keydown', _shortcutHandler);
}


// â”€â”€ HTML scaffold â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _buildHTML(caps) {
  // Always render the Load RVM button. If the local backend is dead, clicking it will trigger the GitHub PAT prompt.
  const isStaticMode = false;
  return `
<div class="geo-tab geo-theme-navisdark rvm-tab-root">
  <div class="geo-top-ribbon" id="rvm-top-ribbon">
    <div class="rvm-ribbon-section">
      <label class="rvm-btn rvm-btn-file" title="Load dataset (RVM, REV, JSON Bundle, ATT TXT, GLB)">
        ${UPLOAD_ICON}<span>Import Dataset</span>
        <input type="file" id="rvm-universal-file-input" multiple accept=".json,.rvm,.rev,.txt,.att,.glb,.gltf" style="display:none">
      </label>
      <button class="rvm-btn" id="rvm-settings-btn" title="Open Interchange Mapping Settings" style="padding:4px 8px; cursor:pointer;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        <span>Settings</span>
      </button>
    </div>
    <div class="rvm-ribbon-section rvm-ribbon-nav">
      ${Object.entries(ACTION_ICONS).map(([id, icon]) => `
        <button class="rvm-tool-btn ${id === 'NAV_ORBIT' ? 'is-active' : ''}" data-action="${id}" title="${ACTION_LABELS[id] || id}">
          ${icon}<span>${ACTION_LABELS[id] || id}</span>
        </button>
      `).join('')}
    </div>
    <div class="rvm-ribbon-section rvm-ribbon-search">
      <input type="search" id="rvm-search-input" placeholder="Search objects..." autocomplete="off">
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
      <!-- Section Box Adjustment Panel -->
      <div id="rvm-section-panel" style="position:absolute; top:112px; left:16px; width:260px; background:rgba(12,22,38,0.96); color:#e8f3ff; padding:14px 16px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.4); display:none; z-index:15; border:1px solid rgba(74,158,255,0.25);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <strong style="font-size:13px; color:#7ab3ff; display:inline-flex; align-items:center; gap:6px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16"/><path d="M10 4v16"/></svg><span>Section Box</span></strong>
          <button id="btn-rvm-section-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:16px;">&times;</button>
        </div>
        <div style="display:grid; gap:10px; font-size:11px;">
          <div><label style="color:#9db7d8; display:flex; justify-content:space-between;">Min X <span id="lbl-rx-min">0</span></label><input type="range" id="rx-min" min="0" max="100" value="0" style="width:100%; accent-color:#4a9eff;"></div>
          <div><label style="color:#9db7d8; display:flex; justify-content:space-between;">Max X <span id="lbl-rx-max">100</span></label><input type="range" id="rx-max" min="0" max="100" value="100" style="width:100%; accent-color:#4a9eff;"></div>
          <div><label style="color:#9db7d8; display:flex; justify-content:space-between;">Min Y <span id="lbl-ry-min">0</span></label><input type="range" id="ry-min" min="0" max="100" value="0" style="width:100%; accent-color:#4a9eff;"></div>
          <div><label style="color:#9db7d8; display:flex; justify-content:space-between;">Max Y <span id="lbl-ry-max">100</span></label><input type="range" id="ry-max" min="0" max="100" value="100" style="width:100%; accent-color:#4a9eff;"></div>
          <div><label style="color:#9db7d8; display:flex; justify-content:space-between;">Min Z <span id="lbl-rz-min">0</span></label><input type="range" id="rz-min" min="0" max="100" value="0" style="width:100%; accent-color:#4a9eff;"></div>
          <div><label style="color:#9db7d8; display:flex; justify-content:space-between;">Max Z <span id="lbl-rz-max">100</span></label><input type="range" id="rz-max" min="0" max="100" value="100" style="width:100%; accent-color:#4a9eff;"></div>
        </div>
        <button id="btn-rvm-section-fit" style="margin-top:12px; width:100%; padding:6px; background:#1a3a5c; border:1px solid #4a9eff; border-radius:6px; color:#7ab3ff; cursor:pointer; font-size:11px;">Reset to Model Bounds</button>
      </div>
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
  <div id="rvm-tag-modal" class="rvm-tag-modal" aria-hidden="true">
    <div class="rvm-tag-modal-card">
      <div class="rvm-tag-modal-title">Create Review Tag</div>
      <label class="rvm-tag-modal-row">Tag ID
        <input id="rvm-tag-id-input" type="text" placeholder="TAG-..." />
      </label>
      <label class="rvm-tag-modal-row">Title
        <input id="rvm-tag-text-input" type="text" placeholder="Enter tag text" />
      </label>
      <label class="rvm-tag-modal-row">Severity
        <select id="rvm-tag-severity-input">
          <option value="info">Info</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label class="rvm-tag-modal-row">Target
        <input id="rvm-tag-target-input" type="text" readonly />
      </label>
      <div class="rvm-tag-modal-actions">
        <button class="rvm-btn" id="rvm-tag-cancel-btn" type="button">Cancel</button>
        <button class="rvm-btn" id="rvm-tag-create-btn" type="button">Create</button>
      </div>
    </div>
  </div>
</div>`.trim();
}

// â”€â”€ Toolbar action dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _bindToolbarActions(container) {
  const sectionPanel = container.querySelector('#rvm-section-panel');
  let _rvmModelBox = null;
  const showSectionPanel = () => {
    if (!sectionPanel) return;
    sectionPanel.style.display = 'block';
    _rvmModelBox = _viewer?.getModelBounds?.() || _rvmModelBox;
  };

  container.querySelector('#btn-rvm-section-close')?.addEventListener('click', () => { if(sectionPanel) sectionPanel.style.display = 'none'; });
  container.querySelector('#btn-rvm-section-fit')?.addEventListener('click', () => {
    ['rx-min','ry-min','rz-min'].forEach(id => { const el = container.querySelector(`#${id}`); if(el){el.value=0; const lbl=container.querySelector(`#lbl-${id}`); if(lbl)lbl.textContent='0%';} });
    ['rx-max','ry-max','rz-max'].forEach(id => { const el = container.querySelector(`#${id}`); if(el){el.value=100; const lbl=container.querySelector(`#lbl-${id}`); if(lbl)lbl.textContent='100%';} });
    _viewer?.resetSectionToModel?.();
  });

  function applyRvmSliders() {
    if (!_rvmModelBox || !_viewer?.setSectionClipBounds) return;
    const pct = id => Number(container.querySelector(`#${id}`)?.value ?? 0) / 100;
    const { min, max } = _rvmModelBox;
    const rx = max.x - min.x, ry = max.y - min.y, rz = max.z - min.z;
    _viewer.setSectionClipBounds({
      minX: min.x + rx * pct('rx-min'), maxX: min.x + rx * pct('rx-max'),
      minY: min.y + ry * pct('ry-min'), maxY: min.y + ry * pct('ry-max'),
      minZ: min.z + rz * pct('rz-min'), maxZ: min.z + rz * pct('rz-max'),
    });
  }

  ['rx-min','rx-max','ry-min','ry-max','rz-min','rz-max'].forEach(id => {
    container.querySelector(`#${id}`)?.addEventListener('input', e => {
      const lbl = container.querySelector(`#lbl-${id}`);
      if (lbl) lbl.textContent = e.target.value + '%';
      applyRvmSliders();
    });
  });

  const ribbon = container.querySelector('#rvm-top-ribbon');
  if (!ribbon) return;
  ribbon.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    _pulseButton(btn);
    const mode = TOOL_ACTION_TO_MODE[action];
    if (mode) {
      _viewer?.setNavMode?.(mode);
      _setActiveToolButton(container, action);
      return;
    }
    switch (action) {
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
      case 'SECTION_BOX': 
        _viewer?.setSectionMode?.('BOX'); 
        showSectionPanel();
        break;
      case 'SECTION_PLANE_UP':
        _viewer?.setSectionMode?.('PLANE_UP');
        showSectionPanel();
        break;
      case 'SECTION_DISABLE': 
        _viewer?.disableSection?.(); 
        if (sectionPanel) sectionPanel.style.display = 'none';
        break;
      default: break;
    }
  });
}

// â”€â”€ ResizeObserver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _bindResize(container) {
  if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
  const viewport = container.querySelector('#rvm-viewport');
  if (!viewport || typeof ResizeObserver === 'undefined') return;
  _resizeObserver = new ResizeObserver(() => {
    _viewer?.onResize?.();
  });
  _resizeObserver.observe(viewport);
}

function _bindToolStateBridge(container) {
  if (_toolChangedHandler) {
    window.removeEventListener('app:tool-changed', _toolChangedHandler);
    _toolChangedHandler = null;
  }
  _toolChangedHandler = (event) => {
    const mode = String(event?.detail?.mode || '').toLowerCase();
    const action = Object.entries(TOOL_ACTION_TO_MODE).find(([, mapped]) => mapped === mode)?.[0];
    if (action) _setActiveToolButton(container, action);
  };
  window.addEventListener('app:tool-changed', _toolChangedHandler);
}

// â”€â”€ Tab event listener (TAB_CHANGED) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


function _bindTabListener() {
  const tabChangedCallback = ({ tabId }) => {
    if (tabId !== 'viewer3d-rvm') {
       const root = document.querySelector('.rvm-tab-root');
       if (root) root.style.display = 'none';
    } else {
       const root = document.querySelector('.rvm-tab-root');
       if (root) root.style.display = '';
    }
  };
  const modelLoadedCallback = (payload) => {
    if (_viewer && payload && payload.gltf && payload.gltf.scene) {
        _viewer.setModel(payload.gltf.scene, payload.manifest?.runtime?.upAxis);
        _viewer.fitAll();
        _viewer.setNavMode?.('orbit');
        const root = document.querySelector('.rvm-tab-root');
        if (root) _setActiveToolButton(root, 'NAV_ORBIT');

        if (payload.indexJson && payload.identityMap) {
            _viewer.searchIndex = new RvmSearchIndex(payload.indexJson, payload.identityMap);
            _viewer.searchIndex.build();
            _viewer.tagStore = new RvmTagXmlStore(payload.identityMap, payload.manifest?.bundleId || state.rvm.activeBundle);
            _viewer.tagStore.getAllTags().forEach((tag) => _viewer.addTag(tag));
        }

        const container = document.querySelector('.rvm-tab-root');
        if (container && payload.indexJson && payload.indexJson.nodes) {
            const tree = container.querySelector('#rvm-hierarchy-tree');
            if (tree) {
                import('../rvm/RvmTreeModel.js').then(module => {
                    if (!_viewer) return;
                    _viewer.treeModel = new module.RvmTreeModel(payload.indexJson, { viewer: _viewer });
                    _viewer.treeModel.build();
                    _viewer.treeModel.renderTree(tree);
                });
            }
            const searchList = container.querySelector('#rvm-search-results');
            if (searchList) searchList.innerHTML = '';
        }

        if (container) {
            const exportBtn = container.querySelector('#rvm-export-tags-btn');
            if (exportBtn) exportBtn.disabled = false;
            const addBtn = container.querySelector('#rvm-add-tag-btn');
            if (addBtn) addBtn.disabled = false;

            // Initial render of tags if any were loaded with bundle
            _renderTagList(container);
        }
    }
  };

  const nodeSelectedCallback = (payload) => {
      const canonicalId = payload?.canonicalId;
      const root = document.querySelector('.rvm-tab-root');
      const attrContent = root?.querySelector('#rvm-attributes-content');
      if (!attrContent) return;

      // Highlight the hierarchy tree node
      if (root) {
          root.querySelectorAll('#rvm-hierarchy-tree li').forEach(li => li.classList.remove('is-selected'));
          if (canonicalId) {
              const match = root.querySelector(`#rvm-hierarchy-tree li[data-id="${CSS.escape(canonicalId)}"]`);
              if (match) { match.classList.add('is-selected'); match.scrollIntoView({ block: 'nearest' }); }
          }
      }

      if (!canonicalId) {
          attrContent.innerHTML = '<div style="padding: 10px; color: #888;">No selection</div>';
          return;
      }

      // Look up in the pre-built search index entries (correct property)
      const entry = _viewer?.searchIndex?._searchableEntries?.find(e => e.canonicalObjectId === canonicalId);
      if (!entry) {
          attrContent.innerHTML = `<div style="padding: 10px; font-weight:bold; color:#ccc;">${escapeHtml(canonicalId)}</div><div style="padding: 6px 10px; color: #888;">No attribute data available</div>`;
          return;
      }

      let html = `<div style="padding:8px 10px; font-weight:bold; font-size:12px; border-bottom:1px solid #444; color:#7ab3ff; margin-bottom:4px;">${escapeHtml(entry.name || canonicalId)}</div>`;
      html += `<div style="padding:2px 10px 4px; font-size:10px; color:#666;">${escapeHtml(entry.kind || '')}</div>`;

      if (entry.attrs && Object.keys(entry.attrs).length > 0) {
          html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
          for (const [key, val] of Object.entries(entry.attrs)) {
              const isCoord = typeof val === 'string' && /^[\{\[]/i.test(val);
              html += `<tr class="rvm-attr-row" style="vertical-align:top;">
                          <td style="padding:3px 6px 3px 10px; color:#8ab; white-space:nowrap; border-bottom:1px solid #2a2d35; font-weight:500;">${escapeHtml(key)}</td>
                          <td style="padding:3px 10px 3px 4px; color:#ddd; word-break:break-all; border-bottom:1px solid #2a2d35; font-size:${isCoord ? '9px' : '11px'};">${escapeHtml(String(val))}</td>
                       </tr>`;
          }
          html += '</table>';
      } else {
          html += '<div style="padding:10px; color:#888;">No attribute data</div>';
      }
      attrContent.innerHTML = html;

      // Re-apply any active search filter
      const filterInput = root?.querySelector('#rvm-attr-search');
      if (filterInput && filterInput.value.trim()) {
          const q = filterInput.value.trim().toLowerCase();
          attrContent.querySelectorAll('.rvm-attr-row').forEach(row => {
              row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
      }
  };

  on(RuntimeEvents.TAB_CHANGED, tabChangedCallback);
  on(RuntimeEvents.RVM_MODEL_LOADED, modelLoadedCallback);
  on(RuntimeEvents.RVM_NODE_SELECTED, nodeSelectedCallback);

  _capabilitiesListenerOff = () => {
    off(RuntimeEvents.TAB_CHANGED, tabChangedCallback);
    off(RuntimeEvents.RVM_MODEL_LOADED, modelLoadedCallback);
    off(RuntimeEvents.RVM_NODE_SELECTED, nodeSelectedCallback);
  };
}

// â”€â”€ Public render function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  _bindToolStateBridge(container);
  _bindShortcuts(container);
  _bindTabListener();
  _bindTags(container);

  // Initialize the actual RvmViewer3D instance inside the viewport container
  const viewport = container.querySelector('.rvm-viewport');
  if (viewport) {
      viewport.innerHTML = '';
      _viewer = new RvmViewer3D(viewport, { identityMap: state.rvm.identityMap });
  }

  const settingsBtn = container.querySelector('#rvm-settings-btn');
  if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('app:switch-tab', { detail: { tabId: 'adapter-mapping' } }));
      });
  }

  // Async capability probe â€” update banner once resolved
  import('../converters/rvm-helper-bridge.js').then(({ RvmHelperBridge }) => {
    const bridge = new RvmHelperBridge();
    detectRvmCapabilities(() => bridge.probe()).then((resolvedCaps) => {
      state.rvm.capabilities = resolvedCaps;
      _renderCapabilityBanner(container, resolvedCaps);
    });
  });

  return _disposeRvmViewer;
}



function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
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

        return `<div class="rvm-tag-item" data-id="${escapeHtml(t.id)}" style="padding:8px;border-left:4px solid ${color};margin-bottom:4px;background:#2a2a2a;cursor:pointer;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <div style="font-weight:bold;">${escapeHtml(t.text || t.id)}</div>
              <div style="display:flex;gap:4px;">
                <button class="rvm-tag-jump" type="button" data-action="jump" data-id="${escapeHtml(t.id)}" title="Jump to tag">Open</button>
                <button class="rvm-tag-delete" type="button" data-action="delete" data-id="${escapeHtml(t.id)}" title="Delete tag">Del</button>
              </div>
            </div>
            <div style="font-size:10px;color:#888;">ID: ${escapeHtml(t.id)} | Severity: ${escapeHtml(sev.toUpperCase())}</div>
            <div style="font-size:10px;color:#888;">Target: ${escapeHtml(t.canonicalObjectId || '-')}</div>
        </div>`;
    }).join('');

    const items = listEl.querySelectorAll('.rvm-tag-item');
    items.forEach((item) => {
      item.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        const tagId = btn?.dataset.id || item.dataset.id;
        if (!_viewer || !tagId) return;
        if (btn?.dataset.action === 'delete') {
          _viewer.tagStore.deleteTag(tagId);
          _viewer.removeTag(tagId);
          return;
        }
        _viewer.jumpToTag(tagId);
        const tag = _viewer.tagStore.getTag(tagId);
        if (tag?.canonicalObjectId) {
          _viewer.selectByCanonicalId(tag.canonicalObjectId);
          _viewer.fitSelection();
        }
      });
    });
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download.txt';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function _openTagModal(container, selection) {
  const modal = container.querySelector('#rvm-tag-modal');
  const idInput = container.querySelector('#rvm-tag-id-input');
  const textInput = container.querySelector('#rvm-tag-text-input');
  const sevInput = container.querySelector('#rvm-tag-severity-input');
  const targetInput = container.querySelector('#rvm-tag-target-input');
  if (!modal || !idInput || !textInput || !sevInput || !targetInput) return;
  idInput.value = `TAG-${Date.now()}`;
  textInput.value = '';
  sevInput.value = 'info';
  targetInput.value = selection?.canonicalObjectId || '';
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  textInput.focus();
}

function _closeTagModal(container) {
  const modal = container.querySelector('#rvm-tag-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function _bindTags(container) {
  const filterSelect = container.querySelector('#rvm-tag-severity-filter');
  if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
          _renderTagList(container, e.target.value);
      });
  }

  if (_tagEventsOff) {
    _tagEventsOff();
    _tagEventsOff = null;
  }
  const onCreated = () => {
    const filter = filterSelect ? filterSelect.value : 'all';
    _renderTagList(container, filter);
  };
  const onDeleted = () => {
    const filter = filterSelect ? filterSelect.value : 'all';
    _renderTagList(container, filter);
  };
  on(RuntimeEvents.RVM_TAG_CREATED, onCreated);
  on(RuntimeEvents.RVM_TAG_DELETED, onDeleted);
  _tagEventsOff = () => {
    off(RuntimeEvents.RVM_TAG_CREATED, onCreated);
    off(RuntimeEvents.RVM_TAG_DELETED, onDeleted);
  };

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
            const tags = _viewer.tagStore.getAllTags();
            tags.forEach((tag) => _viewer.addTag(tag));
            _renderTagList(container, filterSelect ? filterSelect.value : 'all');
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

  const addBtn = container.querySelector('#rvm-add-tag-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!_viewer || !_viewer.tagStore) return;
      const selection = _viewer.getSelection();
      if (!selection.canonicalObjectId) {
         notify({ type: 'warning', message: 'Select an object first to attach a tag.' });
         return;
      }
      _openTagModal(container, selection);
    });
  }

  const cancelBtn = container.querySelector('#rvm-tag-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => _closeTagModal(container));
  }

  const createBtn = container.querySelector('#rvm-tag-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      if (!_viewer || !_viewer.tagStore) return;
      const idInput = container.querySelector('#rvm-tag-id-input');
      const textInput = container.querySelector('#rvm-tag-text-input');
      const sevInput = container.querySelector('#rvm-tag-severity-input');
      const targetInput = container.querySelector('#rvm-tag-target-input');
      const canonicalObjectId = String(targetInput?.value || '').trim();
      const text = String(textInput?.value || '').trim();
      const id = String(idInput?.value || '').trim();
      const severity = String(sevInput?.value || 'info').toLowerCase();
      if (!canonicalObjectId) {
        notify({ type: 'warning', message: 'No target selected for this tag.' });
        return;
      }
      if (!text) {
        notify({ type: 'warning', message: 'Tag text is required.' });
        return;
      }
      const view = _viewer.getSavedView();
      const worldAnchor = _viewer.getSelectionAnchor?.() || view?.camera?.target || null;
      const tag = _viewer.tagStore.createTag({
        id: id || undefined,
        canonicalObjectId,
        text,
        severity,
        cameraState: view.camera,
        worldPosition: worldAnchor
      });
      _viewer.addTag(tag);
      _closeTagModal(container);
      notify({ type: 'success', message: 'Tag created successfully.' });
    });
  }

  const modal = container.querySelector('#rvm-tag-modal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) _closeTagModal(container);
    });
  }
}

