import { RuntimeEvents } from '../contracts/runtime-events.js';
import { state, saveStickyState } from '../core/state.js';
import { on, emit } from '../core/event-bus.js';
import { detectRvmCapabilities } from '../rvm/RvmCapabilities.js';
import { notify } from '../diagnostics/notification-center.js';

let _viewer = null;
let _shortcutHandler = null;
let _resizeObserver = null;
let _capabilitiesListenerOff = null;

// ── Toolbar action labels ───────────────────────────────────────────────────

const ACTION_LABELS = {
  NAV_ORBIT: 'Orbit',
  NAV_PAN: 'Pan',
  NAV_SELECT: 'Select',
  VIEW_FIT_ALL: 'Reset',
  VIEW_FIT_SELECTION: 'FitSel',
  VIEW_TOGGLE_PROJECTION: 'Proj',
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
  const input = container.querySelector('#rvm-bundle-file-input');
  if (!input) return;
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      state.rvm.manifest = json;
      state.rvm.activeBundle = json.bundleId || null;
      saveStickyState();
      emit(RuntimeEvents.RVM_CONFIG_CHANGED, { reason: 'bundle-loaded' });
      notify({ type: 'info', message: `RVM bundle loaded: ${json.bundleId || file.name}` });
    } catch (err) {
      notify({ type: 'error', message: `Failed to load bundle manifest: ${err.message}` });
    }
  });
}

// ── Search handler ──────────────────────────────────────────────────────────

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
  const isStaticMode = !caps?.rawRvmImport;
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
    </div>
    <div class="rvm-ribbon-section rvm-ribbon-nav">
      ${Object.entries(ACTION_ICONS).map(([id, icon]) => `
        <button class="rvm-tool-btn" data-action="${id}" title="${ACTION_LABELS[id] || id}">
          ${icon}<span>${ACTION_LABELS[id] || id}</span>
        </button>
      `).join('')}
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
      <div id="rvm-attributes-content" class="rvm-attributes-panel"></div>
      <div class="rvm-panel-header">Review Tags</div>
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
      case 'VIEW_FIT_ALL': _viewer?.fitAll?.(); break;
      case 'VIEW_FIT_SELECTION': _viewer?.fitSelection?.(); break;
      case 'VIEW_TOGGLE_PROJECTION': _viewer?.toggleProjection?.(); break;
      case 'SECTION_BOX': _viewer?.setSectionMode?.('BOX'); break;
      case 'SECTION_PLANE_UP': _viewer?.setSectionMode?.('PLANE_UP'); break;
      case 'SECTION_DISABLE': _viewer?.disableSection?.(); break;
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
  const off = on(RuntimeEvents.TAB_CHANGED, ({ tabId }) => {
    if (tabId !== 'viewer3d-rvm') _disposeRvmViewer();
  });
  _capabilitiesListenerOff = off;
}

// ── Public render function ─────────────────────────────────────────────────

export function renderViewer3DRvm(container) {
  _disposeRvmViewer();

  // Capability probe runs async; render with static caps first, update banner when resolved
  const caps = { ...state.rvm.capabilities } || null;
  container.innerHTML = _buildHTML(caps);

  _renderCapabilityBanner(container, caps);
  _bindBundleLoader(container);
  _bindSearch(container);
  _bindToolbarActions(container);
  _bindResize(container);
  _bindShortcuts(container);
  _bindTabListener();

  // Initialise viewer stub (replaced by RvmViewer3D in Agent 3)
  _viewer = _createViewerStub(container);

  // Async capability probe — update banner once resolved
  detectRvmCapabilities(null).then((resolvedCaps) => {
    state.rvm.capabilities = resolvedCaps;
    _renderCapabilityBanner(container, resolvedCaps);
  });

  return _disposeRvmViewer;
}
