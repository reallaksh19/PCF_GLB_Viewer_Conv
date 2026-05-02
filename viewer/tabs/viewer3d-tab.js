import { RuntimeEvents } from '../contracts/runtime-events.js';
/**
 * viewer3d-tab.js - 3D Viewer tab with dedicated viewer3DConfig wiring.
 */

import { state, saveStickyState } from '../core/state.js';
import { on, emit } from '../core/event-bus.js';
import { addTraceEvent } from '../core/logger.js';
import { buildUniversalCSV, normalizeToPCF } from '../utils/accdb-to-pcf.js';
import { parsePcfText } from '../js/pcf2glb/pcf/parsePcfText.js';
import { normalizePcfModel } from '../js/pcf2glb/pcf/normalizePcfModel.js';
import { pcfxDocumentFromPcfText } from '../pcfx/Pcfx_PcfAdapter.js';
import { viewerComponentFromCanonicalItem } from '../pcfx/Pcfx_GlbAdapter.js';
import { PcfViewer3D } from '../viewer-3d.js';
import { getResolvedViewer3DConfig } from '../viewer-3d-config.js';
import { resolveActionOrder, executeViewerAction } from '../viewer-actions.js';
import { buildComponentPanelModel } from '../viewer3d/component-panel-model.js';
import { renderConfig } from './config-tab.js';
import { importFromRawFile } from '../js/pcf2glb/import/ImportFromRawParser.js';
import { notify } from '../diagnostics/notification-center.js';

let _viewer = null;
let _listenersRegistered = false;
let _shortcutHandler = null;
let _shortcutContainer = null;
let _selectedComponent = null;
let _directPcfData = null;
let _ribbonCollapsed = false;
let _leftSettingsCollapsed = false;
let _mockSeedPayload = null;
const _spareOverlayRuntime = {
  spare1: { rows: [], fields: [], fileName: '' },
  spare2: { rows: [], fields: [], fileName: '' },
};

const ACTION_LABELS = {
  NAV_SELECT: 'Select',
  NAV_ORBIT: 'Orbit',
  NAV_PAN: 'Pan',
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
  MEASURE_TOOL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="8" rx="2" ry="2"/><path d="M6 8v4"/><path d="M10 8v4"/><path d="M14 8v4"/><path d="M18 8v4"/></svg>',
  NAV_PLAN_X: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  NAV_ROTATE_Y: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  NAV_ROTATE_Z: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  NAV_PAN: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
  VIEW_MARQUEE_ZOOM: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="12" height="12" rx="1" stroke-dasharray="3 2"/><circle cx="17" cy="17" r="3"/><path d="m21 21-2.15-2.15"/></svg>',
  VIEW_FIT_ALL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9V5h4"/><path d="M19 9V5h-4"/><path d="M5 15v4h4"/><path d="M19 15v4h-4"/></svg>',
  VIEW_FIT_SELECTION: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9V5h4"/><path d="M19 9V5h-4"/><path d="M5 15v4h4"/><path d="M19 15v4h-4"/><circle cx="12" cy="12" r="3"/></svg>',
  VIEW_TOGGLE_PROJECTION: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="m3 3 18 18"/><path d="m21 3-18 18"/></svg>',
  SNAP_ISO_NW: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M7 7h4"/><path d="M7 11v-4"/></svg>',
  SNAP_ISO_NE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M17 7h-4"/><path d="M17 11v-4"/></svg>',
  SNAP_ISO_SW: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M7 17h4"/><path d="M7 13v4"/></svg>',
  SNAP_ISO_SE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="M17 17h-4"/><path d="M17 13v4"/></svg>',
  SECTION_BOX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity="0.16"/><path d="M4 10h16"/><path d="M10 4v16"/></svg>',
  SECTION_PLANE_UP: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16h18"/><path d="M12 4v10"/><path d="m8.5 8.5 3.5-4 3.5 4"/></svg>',
  SECTION_DISABLE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
};

const SPARE_ICON_UPLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><rect x="4" y="16" width="16" height="4" rx="1.5"/></svg>';

export function renderViewer3D(container) {
  const cfg = getResolvedViewer3DConfig(state);
  const themeClass = `geo-theme-${String(state.viewerSettings.themePreset || 'NavisDark').toLowerCase()}`;
  const isLiveMount = container?.isConnected && container.id === 'tab-content';

  if (!_listenersRegistered) {
    on('parse-complete', () => {
      _clearDirectPcfData();
      _rerenderIfActive();
    });
    on('file-loaded', () => {
      _clearDirectPcfData();
      _rerenderIfActive();
    });
    // Fast-path: overlay visibility toggles that do NOT need a geometry re-render.
    // Heatmap updates are intentionally excluded — they need a full re-render so
    // applyHeatmap() runs with fresh state.
    const OVERLAY_ONLY_REASONS = new Set([
      'nodes-toggled', 'line-labels-toggled', 'length-labels-toggled',
      'spare1-updated', 'spare2-updated',
    ]);
    on('viewer3d-config-changed', (payload) => {
      const reason = payload && payload.reason;
      if (reason && OVERLAY_ONLY_REASONS.has(reason)) {
        if (!_viewer) { _rerenderIfActive(); return; }
        // Update the viewer's live config reference
        const liveCfg = getResolvedViewer3DConfig(state);
        _viewer.viewerConfig = liveCfg;
        const liveDataSource = _directPcfData || _buildParsedDataSource(state.parsed);
        if (reason === 'length-labels-toggled' || reason === 'length-labels-gap' || reason === 'verification-mode') {
          _viewer.viewerConfig = liveCfg;
          _viewer.refreshLengthLabels?.(liveDataSource.components || []);
        }
        _applyOverlayLayersToViewer(liveCfg, liveDataSource);
        return;
      }
      _rerenderIfActive();
    });
    on('support-mapping-changed', () => _rerenderIfActive());
    on('tab-changed', (tabId) => {
      if (tabId !== 'viewer3d') _disposeViewer();
    });
    _listenersRegistered = true;
  }

  if (isLiveMount) {
    _disposeViewer();
  }

  const parsed = state.parsed;
  const dataSource = _directPcfData || _buildParsedDataSource(parsed);
  const components = [...dataSource.components];
  const supportComponents = components.filter((c) => String(c.type || '').toUpperCase() === 'SUPPORT' || String(c.type || '').toUpperCase() === 'ANCI');
  if ((dataSource.kind === 'parsed' || dataSource.kind === 'xml-direct') && parsed?.restraints?.length && supportComponents.length === 0) {
    components.push(..._buildSupportFallbackComponents(parsed));
  }
  if (isLiveMount) state.viewer3dComponents = components;

  const summary = _summariseComponents(components);
  const resolvedActions = resolveActionOrder(cfg);
  const actions = resolvedActions.includes('VIEW_FIT_ALL')
    ? resolvedActions
    : ['VIEW_FIT_ALL', ...resolvedActions];
  const showComponentPanel = !cfg.disableAllSettings && cfg.featureFlags?.componentPanel !== false && cfg.componentPanel?.enabled !== false;
  const addOnDisabledAttr = cfg.disableAllSettings ? 'disabled' : '';
  const verticalAxis = String(cfg.coordinateMap?.verticalAxis || 'Z').toUpperCase() === 'Y' ? 'Y' : 'Z';
  const isLocalhost = _isLocalhostHost();
  const showMockButtons = !cfg.disableAllSettings && isLocalhost && cfg.mockData?.enabledOnLocalhostOnly !== false;
  const spare1Fields = _spareOverlayRuntime.spare1.fields || [];
  const spare2Fields = _spareOverlayRuntime.spare2.fields || [];
  const spare1SelectedField = _resolvePreferredSpareField(cfg.spareOverlays?.spare1?.selectedField, spare1Fields);
  const spare2SelectedField = _resolvePreferredSpareField(cfg.spareOverlays?.spare2?.selectedField, spare2Fields);
  const statusMessage = dataSource.fileName
    ? `${components.length} rendered component(s) from ${dataSource.fileName}`
    : 'Load a .PCF file to build the model';

  container.innerHTML = `
    <div class="geo-tab ${themeClass}" id="section-viewer3d">
      <div class="geo-main-area" style="width:100%;">
        <div class="geo-ribbon-region ${_ribbonCollapsed ? 'is-collapsed' : ''}" id="viewer3d-ribbon-region">
          <div class="geo-top-ribbon">
            ${_renderToolbar(cfg, actions)}
            <div class="geo-ribbon-utility">
              ${showMockButtons ? '<button class="btn-secondary" id="viewer3d-load-mock1" title="Load seeded localhost mock data set 1">Mock 1</button>' : ''}
              ${showMockButtons ? '<button class="btn-secondary" id="viewer3d-load-mock2" title="Load seeded localhost mock data set 2">Mock 2</button>' : ''}
              ${showMockButtons ? '<button class="btn-secondary" id="viewer3d-load-mock-xml" title="Load Mock XML data">Mock xml</button>' : ''}
              <button class="btn-icon viewer3d-icon-btn viewer3d-mini-icon-btn viewer3d-spare-upload" id="viewer3d-spare1-btn" title="Load Spare 1 Data" type="button">
                <span class="viewer3d-icon-glyph">${SPARE_ICON_UPLOAD}</span>
                <span class="viewer3d-icon-label">Spare 1</span>
              </button>
              <button class="btn-icon viewer3d-icon-btn viewer3d-mini-icon-btn viewer3d-spare-upload" id="viewer3d-spare2-btn" title="Load Spare 2 Data" type="button">
                <span class="viewer3d-icon-glyph">${SPARE_ICON_UPLOAD}</span>
                <span class="viewer3d-icon-label">Spare 2</span>
              </button>
              <div class="viewer-import-group" style="display:flex; gap: 6px; align-items: center; background: rgba(0,0,0,0.15); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-left: 12px;">
                <span style="font-size: 0.75rem; font-weight: 600; opacity: 0.6; text-transform: uppercase; margin-right: 4px; letter-spacing: 0.5px;">Import</span>
                <label class="btn-primary file-label" style="padding: 6px 12px; cursor:pointer;" title="Import main PCF piping model">
                  <input type="file" id="viewer3d-pcf-input" accept=".pcf,.PCF" style="display:none">
                  PCF
                </label>
                <label class="btn-secondary file-label" id="viewer3d-import-step-label" style="padding: 6px 12px; cursor:pointer;" title="Append structural STEP members (.stp/.step)">
                  <input type="file" id="viewer3d-step-input" accept=".stp,.step,.STP,.STEP" style="display:none">
                  STP
                </label>
                <label class="btn-secondary file-label" id="viewer3d-import-raw-label" style="padding: 6px 12px; cursor:pointer;" title="Import piping model directly from ACCDB/MDB, XML, or PDF">
                  <input type="file" id="viewer3d-import-raw-input" accept=".accdb,.mdb,.xml,.pdf" style="display:none">
                  DB/XML
                </label>
              </div>
              <button class="btn-secondary" id="viewer3d-open-config">Config</button>
              <button
                class="ribbon-toggle-btn ${_ribbonCollapsed ? 'is-collapsed' : ''}"
                id="viewer3d-ribbon-toggle"
                aria-label="${_ribbonCollapsed ? 'Expand ribbon' : 'Collapse ribbon'}"
                aria-expanded="${_ribbonCollapsed ? 'false' : 'true'}"
                title="${_ribbonCollapsed ? 'Expand ribbon' : 'Collapse ribbon'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6"></path>
                </svg>
              </button>
            </div>
          </div>

        </div>

        <div class="geo-body">
          <aside class="geo-left-panel viewer3d-settings-panel ${_leftSettingsCollapsed ? 'is-collapsed' : ''}" id="viewer3d-settings-panel">
            <button
              class="left-panel-toggle-btn ${_leftSettingsCollapsed ? 'is-collapsed' : ''}"
              id="viewer3d-settings-toggle"
              aria-label="${_leftSettingsCollapsed ? 'Expand settings panel' : 'Collapse settings panel'}"
              aria-expanded="${_leftSettingsCollapsed ? 'false' : 'true'}"
              title="${_leftSettingsCollapsed ? 'Expand settings panel' : 'Collapse settings panel'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m15 6-6 6 6 6"></path>
              </svg>
            </button>
            <div class="left-panel-body">
              <div class="left-panel-title">Settings</div>

              <div class="left-panel-group">
                <div class="left-panel-group-title">Graphics</div>
                <label class="left-panel-checkbox">
                  <input type="checkbox" id="viewer3d-top-heatmap-enabled" ${cfg.heatmap?.enabled ? 'checked' : ''} ${addOnDisabledAttr}>
                  Heatmap
                </label>
                <label class="left-panel-label">Metric
                  <select id="viewer3d-top-heatmap-metric" ${addOnDisabledAttr}>
                    <option value="T1" ${String(cfg.heatmap?.metric || 'T1') === 'T1' ? 'selected' : ''}>T1</option>
                    <option value="T2" ${String(cfg.heatmap?.metric || 'T1') === 'T2' ? 'selected' : ''}>T2</option>
                    <option value="P1" ${String(cfg.heatmap?.metric || 'T1') === 'P1' ? 'selected' : ''}>P1</option>
                  </select>
                </label>
                <label class="left-panel-label">Steps
                  <input id="viewer3d-top-heatmap-buckets" type="number" min="2" max="12" value="${Number(cfg.heatmap?.bucketCount || 5)}" title="Number of color brackets in the Heatmap" ${addOnDisabledAttr}>
                </label>
                <label class="left-panel-checkbox">
                  <input type="checkbox" id="viewer3d-top-nodes-enabled" ${cfg.nodes?.enabled ? 'checked' : ''} ${addOnDisabledAttr}>
                  Node No.
                </label>
                <label class="left-panel-checkbox">
                  <input type="checkbox" id="viewer3d-top-line-enabled" ${cfg.overlay?.annotations?.messageSquareEnabled !== false ? 'checked' : ''} ${addOnDisabledAttr}>
                  Line No.
                </label>
                <div class="left-panel-inline-pair">
                  <label class="left-panel-checkbox">
                    <input type="checkbox" id="viewer3d-top-spare1-enabled" ${cfg.spareOverlays?.spare1?.enabled ? 'checked' : ''} ${addOnDisabledAttr}>
                    Spare 1
                  </label>
                  <select id="viewer3d-top-spare1-field" class="left-panel-inline-select" ${addOnDisabledAttr} title="Spare 1 field">
                    ${spare1Fields.length
                      ? spare1Fields.map((field) => `<option value="${_escAttr(field)}" ${field === spare1SelectedField ? 'selected' : ''}>${_esc(field)}</option>`).join('')
                      : '<option value="">(load CSV)</option>'}
                  </select>
                </div>
                <div class="left-panel-inline-pair">
                  <label class="left-panel-checkbox">
                    <input type="checkbox" id="viewer3d-top-spare2-enabled" ${cfg.spareOverlays?.spare2?.enabled ? 'checked' : ''} ${addOnDisabledAttr}>
                    Spare 2
                  </label>
                  <select id="viewer3d-top-spare2-field" class="left-panel-inline-select" ${addOnDisabledAttr} title="Spare 2 field">
                    ${spare2Fields.length
                      ? spare2Fields.map((field) => `<option value="${_escAttr(field)}" ${field === spare2SelectedField ? 'selected' : ''}>${_esc(field)}</option>`).join('')
                      : '<option value="">(load CSV)</option>'}
                  </select>
                </div>
                <label class="left-panel-checkbox">
                  <input type="checkbox" id="viewer3d-top-length-enabled" ${cfg.lengthLabels?.enabled ? 'checked' : ''} ${addOnDisabledAttr}>
                  Length
                </label>
                <label class="left-panel-checkbox">
                  <input type="checkbox" id="viewer3d-top-verification-enabled" ${cfg.lengthLabels?.verificationMode ? 'checked' : ''} ${addOnDisabledAttr}>
                  Verify 100%
                </label>
                <label class="left-panel-label">Min gap (mm)
                  <input type="number" id="viewer3d-label-min-gap" class="left-panel-number" min="0" max="2000" step="10" value="${cfg.lengthLabels?.minWorldGap ?? 30}" ${addOnDisabledAttr}>
                </label>
                <label class="left-panel-label">Overlay Scale
                  <input id="viewer3d-overlay-scale" class="left-panel-range" type="range" min="20" max="300" step="5" value="${Math.round(Number(cfg.overlay?.smartScale?.multiplier || 1) * 100)}" ${addOnDisabledAttr}>
                  <span class="left-panel-range-readout mono" id="viewer3d-overlay-scale-value">${Number(cfg.overlay?.smartScale?.multiplier || 1).toFixed(2)}x</span>
                </label>
                <label class="left-panel-label">Support Scale
                  <input id="viewer3d-support-symbol-scale" class="left-panel-range" type="range" min="50" max="400" step="10" value="${Math.round(Number(cfg.supportGeometry?.symbolScale || 2) * 100)}" ${addOnDisabledAttr}>
                  <span class="left-panel-range-readout mono" id="viewer3d-support-symbol-scale-value">${Number(cfg.supportGeometry?.symbolScale || 2).toFixed(2)}x</span>
                </label>
              </div>

              <div class="left-panel-group" id="viewer3d-section-controls-group">
                <div class="left-panel-group-title">Clip / Plane</div>
                <label class="left-panel-label">Clip
                  <select id="viewer3d-section-mode">
                    <option value="OFF">Off</option>
                    <option value="BOX">Box</option>
                    <option value="PLANE_UP">Plane Up (${verticalAxis})</option>
                  </select>
                </label>
                <label class="left-panel-label">Pad
                  <input id="viewer3d-section-boxpad" class="left-panel-range" type="range" min="-1000" max="1000" step="50" value="0">
                  <span class="left-panel-range-readout mono" id="viewer3d-section-boxpad-value">0</span>
                </label>
                <label class="left-panel-label">Offset
                  <input id="viewer3d-section-planeoffset" class="left-panel-range" type="range" min="-2500" max="2500" step="50" value="0">
                  <span class="left-panel-range-readout mono" id="viewer3d-section-planeoffset-value">0</span>
                </label>
              </div>

              <div class="left-panel-group">
                <div class="left-panel-group-title">View</div>
                <label class="left-panel-label">Axis
                  <select id="viewer3d-vertical-axis">
                    <option value="Z" ${String(cfg.coordinateMap?.verticalAxis || 'Z') === 'Z' ? 'selected' : ''}>Z-up</option>
                    <option value="Y" ${String(cfg.coordinateMap?.verticalAxis || 'Z') === 'Y' ? 'selected' : ''}>Y-up</option>
                  </select>
                </label>
                <label class="left-panel-label">Theme
                  <select id="viewer3d-theme-select" ${addOnDisabledAttr}>
                    <option value="NavisDark" ${(state.viewerSettings?.themePreset || 'NavisDark') === 'NavisDark' ? 'selected' : ''}>Dark (Navy)</option>
                    <option value="HighContrast" ${(state.viewerSettings?.themePreset) === 'HighContrast' ? 'selected' : ''}>High Contrast</option>
                    <option value="DrawLight" ${(state.viewerSettings?.themePreset) === 'DrawLight' ? 'selected' : ''}>Light</option>
                  </select>
                </label>
              </div>
            </div>
          </aside>

          <div class="canvas-wrap" id="viewer3d-canvas-wrap">
            ${components.length
              ? '<div class="canvas-placeholder" id="viewer3d-placeholder" style="display:none;">Load data to render the model</div>'
              : `<div class="canvas-placeholder" id="viewer3d-placeholder">${dataSource.fileName ? 'No drawable geometry could be built from the loaded file.' : 'Load a .PCF file to render the model'}</div>`
            }
          </div>

          <aside class="geo-side-panel viewer3d-summary-panel">
            <div class="side-panel-tabs">
              ${showComponentPanel ? '<button class="panel-tab active" type="button" data-target="v3d-panel-component">Component Panel</button>' : ''}
              <button class="panel-tab ${showComponentPanel ? '' : 'active'}" type="button" data-target="v3d-panel-summary">Summary</button>
            </div>
            ${showComponentPanel ? `<div class="panel-content active" id="v3d-panel-component" style="display:block;">${_renderComponentPanel(cfg)}</div>` : ''}
            <div class="panel-content ${showComponentPanel ? '' : 'active'}" id="v3d-panel-summary" style="display:${showComponentPanel ? 'none' : 'block'};">
              ${_renderSummaryPanel(cfg, summary, dataSource, components)}
            </div>
          </aside>
        </div>

        <div class="geo-status-bar" role="status" aria-live="polite">
          <span class="status-title">3D Viewer</span>
          <span class="status-separator"></span>
          <span class="status-message">${_esc(statusMessage)}</span>
        </div>
      </div>
    </div>
    <div id="viewer3d-spare-modal" style="display:none; position:fixed; inset:0; background:rgba(3,9,18,0.62); z-index:1200; padding:32px; overflow:auto;">
      <div style="max-width:640px; margin:0 auto; background:#f5f8fc; border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.3); border:1px solid rgba(14,28,45,0.16);">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid rgba(14,28,45,0.12);">
          <strong id="viewer3d-spare-modal-title" style="font-size:1rem; color:#102033;">Spare 1 — Import CSV</strong>
          <button class="btn-secondary" id="viewer3d-spare-modal-close" type="button">Close</button>
        </div>
        <div style="padding:18px 20px 24px;">
          <label class="btn-secondary file-label" style="margin-bottom:12px; display:inline-block;">
            <input type="file" id="viewer3d-spare-modal-file" accept=".csv,text/csv" style="display:none">
            Choose CSV file…
          </label>
          <div id="viewer3d-spare-modal-preview" style="overflow-x:auto; margin-bottom:12px; font-size:0.8rem;"></div>
          <p style="font-size:0.78rem; color:#555; margin-bottom:12px;">
            Each CSV row must have columns matching existing component coordinates (mm).
            Rows are matched to the nearest pipe endpoint within 180 mm. The selected column
            value is displayed as a label on the canvas.
          </p>
          <div style="display:flex; align-items:center; gap:12px;">
            <label style="font-size:0.85rem;">Show column:
              <select id="viewer3d-spare-modal-field" style="margin-left:6px;"></select>
            </label>
            <button class="btn-primary" id="viewer3d-spare-modal-apply" type="button" disabled>Apply</button>
          </div>
        </div>
      </div>
    </div>
    <div id="viewer3d-config-modal" style="display:none; position:fixed; inset:0; background:rgba(3,9,18,0.62); z-index:1200; padding:32px; overflow:auto;">
      <div style="max-width:1080px; margin:0 auto; background:#f5f8fc; border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.3); border:1px solid rgba(14,28,45,0.16);">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid rgba(14,28,45,0.12);">
          <strong style="font-size:1rem; color:#102033;">3D Viewer Config</strong>
          <button class="btn-secondary" id="viewer3d-config-close">Close</button>
        </div>
        <div id="viewer3d-config-content" style="padding:18px 20px 24px;"></div>
      </div>
    </div>
  `;

  _wireSidePanelTabs(container);
  _wireViewerControls(container, cfg, actions);
  _registerShortcuts(cfg, container);

  if (!components.length || !isLiveMount) return;

  const wrap = container.querySelector('#viewer3d-canvas-wrap');
  if (!wrap) return;

  _viewer = new PcfViewer3D(wrap, {
    viewerConfig: cfg,
    onSelectionChange: (comp) => {
      _selectedComponent = comp || null;
      _updateComponentPanel(container, cfg);
      addTraceEvent({ type: 'selection', category: 'viewer3d', payload: { componentId: comp?.id || null, componentType: comp?.type || null } });
    },
    onMeasurementChange: (summary) => {
      if (summary && Number.isFinite(Number(summary.distance))) {
        _setStatusMessage(container, _formatMeasurementStatus(summary));
        return;
      }
      const mode = String(_viewer?.getNavMode?.() || '');
      if (mode === 'measure') _setStatusMessage(container, 'Measure: click first point.');
    },
    onTrace: (evt) => {
      addTraceEvent(evt);
      const traceType = String(evt?.type || '');
      // When marquee zoom finishes, sync the active button state.
      if (traceType === 'marquee-zoom-done') {
        _syncToolbarToNavMode(container);
      }
      // Section button active states
      if (traceType === 'section-mode') {
        _updateSectionActiveState(container, evt.payload?.mode || 'OFF');
        _syncSectionModeControl(container, evt.payload?.mode || 'OFF');
      }
      if (traceType === 'section-disable') {
        _updateSectionActiveState(container, 'OFF');
        _syncSectionModeControl(container, 'OFF');
      }
      // Projection toggle indicator
      if (traceType === 'projection-toggle') {
        _updateProjectionActiveState(container, evt.payload?.mode || 'orthographic');
      }
      // Measurement complete → copy to clipboard
      if (traceType === 'nav-mode') {
        const mode = String(evt.payload?.mode || '');
        if (mode === 'measure') {
          _setStatusMessage(container, 'Measure: click first point.');
        } else if (mode === 'marquee') {
          _setStatusMessage(container, 'Marquee: drag rectangle to zoom.');
        } else {
          _setStatusMessage(container, statusMessage);
        }
      }
      if (traceType === 'measure-point') {
        const index = Number(evt.payload?.index || 0);
        if (index === 1) _setStatusMessage(container, 'Measure: click second point.');
      }
      if (traceType === 'measure-miss') {
        _setStatusMessage(container, 'Measure: click on model geometry.');
      }
      if (traceType === 'measure-complete') {
        _copyMeasurementToClipboard(evt.payload?.distance);
        _setStatusMessage(container, _formatMeasurementStatus(evt.payload || {}));
      }
      if (traceType === 'measure-cleared') {
        const mode = String(_viewer?.getNavMode?.() || '');
        _setStatusMessage(container, mode === 'measure' ? 'Measure: click first point.' : statusMessage);
      }
    },
  });
  _viewer.render(components);
  _syncToolbarToNavMode(container);
  _syncSectionModeControl(container, _viewer.getSectionMode?.() || 'OFF');
  _applyOverlayLayersToViewer(cfg, dataSource);

  if (cfg.heatmap?.enabled) {
    _viewer.applyHeatmap?.({
      metric: cfg.heatmap.metric,
      bucketCount: cfg.heatmap.bucketCount,
      palette: cfg.heatmap.palette,
      nullColor: cfg.heatmap.nullColor,
    });
  }
  // Double-click canvas → fit selection (if something selected) or fit all
  wrap.addEventListener('dblclick', () => {
    if (_selectedComponent) {
      _viewer?.fitSelection?.();
    } else {
      _viewer?.fitAll?.();
    }
  });

  // Ctrl+Wheel → nudge PLANE_UP section plane offset
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -50 : 50; // mm per notch, invert scroll direction
    _viewer?.nudgeSectionPlane?.(delta);
  }, { passive: false });
}

function _buildParsedDataSource(parsed) {
  return {
    kind: 'parsed',
    fileName: state.fileName ?? null,
    parsed,
    components: _buildViewerComponents(parsed),
  };
}

function _rerenderIfActive() {
  const content = document.getElementById('tab-content');
  if (state.activeTab === 'viewer3d' && content) renderViewer3D(content);
}

function _disposeViewer() {
  if (_shortcutHandler) {
    window.removeEventListener('keydown', _shortcutHandler);
    _shortcutHandler = null;
  }
  if (_viewer) {
    _viewer.dispose();
    _viewer = null;
  }
}

function _wireViewerControls(container, cfg, actions) {
  const ribbonRegion = container.querySelector('#viewer3d-ribbon-region');
  const ribbonToggle = container.querySelector('#viewer3d-ribbon-toggle');
  const settingsPanel = container.querySelector('#viewer3d-settings-panel');
  const settingsToggle = container.querySelector('#viewer3d-settings-toggle');
  const setRibbonCollapsed = (collapsed) => {
    _ribbonCollapsed = !!collapsed;
    ribbonRegion?.classList.toggle('is-collapsed', _ribbonCollapsed);
    if (!ribbonToggle) return;
    ribbonToggle.classList.toggle('is-collapsed', _ribbonCollapsed);
    ribbonToggle.setAttribute('aria-expanded', _ribbonCollapsed ? 'false' : 'true');
    const label = _ribbonCollapsed ? 'Expand ribbon' : 'Collapse ribbon';
    ribbonToggle.setAttribute('aria-label', label);
    ribbonToggle.setAttribute('title', label);
  };
  setRibbonCollapsed(_ribbonCollapsed);
  ribbonToggle?.addEventListener('click', () => setRibbonCollapsed(!_ribbonCollapsed));

  const setSettingsCollapsed = (collapsed) => {
    _leftSettingsCollapsed = !!collapsed;
    settingsPanel?.classList.toggle('is-collapsed', _leftSettingsCollapsed);
    if (!settingsToggle) return;
    settingsToggle.classList.toggle('is-collapsed', _leftSettingsCollapsed);
    settingsToggle.setAttribute('aria-expanded', _leftSettingsCollapsed ? 'false' : 'true');
    const label = _leftSettingsCollapsed ? 'Expand settings panel' : 'Collapse settings panel';
    settingsToggle.setAttribute('aria-label', label);
    settingsToggle.setAttribute('title', label);
  };
  setSettingsCollapsed(_leftSettingsCollapsed);
  settingsToggle?.addEventListener('click', () => setSettingsCollapsed(!_leftSettingsCollapsed));
  let sectionFocusTimeoutId = null;
  const revealSectionControls = () => {
    setSettingsCollapsed(false);
    const panelBody = settingsPanel?.querySelector('.left-panel-body');
    const sectionGroup = settingsPanel?.querySelector('#viewer3d-section-controls-group');
    if (panelBody && sectionGroup) {
      panelBody.scrollTop = Math.max(0, sectionGroup.offsetTop - 12);
      sectionGroup.classList.add('section-controls-focus');
      if (sectionFocusTimeoutId !== null) window.clearTimeout(sectionFocusTimeoutId);
      sectionFocusTimeoutId = window.setTimeout(() => {
        sectionGroup.classList.remove('section-controls-focus');
      }, 1000);
    }
  };

  const loadMockData = async (mockKey) => {
    try {
      const mock = await _resolveMockPayload(mockKey);
      const text = String(mock?.pcfText || '');
      if (!text.trim()) {
        notify({ level: 'warning', title: 'Mock Load', message: `Mock payload is empty for ${mockKey}. Update it in Config tab.` });
        return;
      }
      const name = String(mock?.fileName || `${mockKey}.pcf`);
      _directPcfData = _buildDirectPcfData(text, name);
      _rerenderIfActive();
    } catch (error) {
      console.error(error);
      notify({ level: 'error', title: 'Mock Error', message: `Failed to load ${mockKey}: ${String(error?.message || error)}` });
    }
  };

  container.querySelector('#viewer3d-load-mock1')?.addEventListener('click', async () => {
    await loadMockData('mock1');
  });
  container.querySelector('#viewer3d-load-mock2')?.addEventListener('click', async () => {
    await loadMockData('mock2');
  });
  container.querySelector('#viewer3d-load-mock-xml')?.addEventListener('click', async () => {
    try {
      const response = await fetch('opt/mock-xml.xml');
      if (!response.ok) throw new Error('Could not fetch mock xml file.');
      const text = await response.text();
      const file = new File([text], 'R-52-2-P_INPUT.XML', { type: 'text/xml' });
      
      const { importFromRawFile } = await import('../js/pcf2glb/import/ImportFromRawParser.js');
      const log = [];
      const result = await importFromRawFile(file, state, log);
      
      if (result.ok && result.directPcfData) {
        state.fileName = file.name;
        _directPcfData = result.directPcfData;
        // ACCDB/XML/PDF: 2nd coordinate (Y) is vertical
        state.viewer3DConfig.coordinateMap = {
          ...(state.viewer3DConfig.coordinateMap || {}),
          verticalAxis: 'Y',
          axisConvention: 'Y-up',
          gridPlane: 'auto',
        };
        saveStickyState();
        _rerenderIfActive();
      } else {
        notify({ level: 'error', title: 'Parse Error', message: "Failed to parse mock XML: \n" + (log.length > 0 ? log.join('\n') : 'Unknown error.'), details: log });
      }
    } catch (error) {
      console.error(error);
      notify({ level: 'error', title: 'Load Error', message: `Failed to load Mock XML: ${String(error?.message || error)}` });
    }
  });

  container.querySelector('#viewer3d-pcf-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      _directPcfData = _buildDirectPcfData(text, file.name);
      // PCF uses Z as elevation — default to Z-up so the model appears right-side-up.
      // _verticalVector() always returns Three.js Y (0,1,0) because mapCoord() places
      // PCF elevation into Three.js Y regardless of mode, so this is safe.
      if (!state.viewer3DConfig.coordinateMap?.verticalAxis ||
           state.viewer3DConfig.coordinateMap.verticalAxis === 'Y') {
        state.viewer3DConfig.coordinateMap = {
          ...(state.viewer3DConfig.coordinateMap || {}),
          verticalAxis: 'Z',
          axisConvention: 'Z-up',
          gridPlane: 'auto',
        };
        saveStickyState();
      }
      _rerenderIfActive();
    } catch (error) {
      console.error(error);
      notify({ level: 'error', title: 'Load Error', message: `Failed to load PCF: ${String(error?.message || error)}` });
    } finally {
      event.target.value = '';
    }
  });
  container.querySelector('#viewer3d-step-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const label = container.querySelector('#viewer3d-import-step-label');
    if (label) label.style.opacity = '0.5';
    const log = [];
    try {
      const result = await importFromRawFile(file, state, log);
      if (result.ok && result.directPcfData) {
        const activeDataSource = _directPcfData || _buildParsedDataSource(state.parsed);
        const activeComponents = Array.isArray(activeDataSource?.components) ? [...activeDataSource.components] : [];
        const activeSupportCount = activeComponents.filter((c) => {
          const type = String(c?.type || '').toUpperCase();
          return type === 'SUPPORT' || type === 'ANCI';
        }).length;
        if ((activeDataSource?.kind === 'parsed' || activeDataSource?.kind === 'xml-direct') && state.parsed?.restraints?.length && activeSupportCount === 0) {
          activeComponents.push(..._buildSupportFallbackComponents(state.parsed));
        }
        const stepComponents = Array.isArray(result.directPcfData.components) ? result.directPcfData.components : [];
        const activeMessageCircleNodes = Array.isArray(activeDataSource?.messageCircleNodes) ? activeDataSource.messageCircleNodes : [];
        const activeMessageSquareNodes = Array.isArray(activeDataSource?.messageSquareNodes) ? activeDataSource.messageSquareNodes : [];
        const stepMessageCircleNodes = Array.isArray(result.directPcfData.messageCircleNodes) ? result.directPcfData.messageCircleNodes : [];
        const stepMessageSquareNodes = Array.isArray(result.directPcfData.messageSquareNodes) ? result.directPcfData.messageSquareNodes : [];
        const mergedComponents = [...activeComponents, ...stepComponents];
        _directPcfData = {
          kind: 'merged-direct',
          fileName: activeDataSource?.fileName ? `${activeDataSource.fileName} + ${file.name}` : file.name,
          parsed: null,
          components: mergedComponents,
          messageCircleNodes: [...activeMessageCircleNodes, ...stepMessageCircleNodes],
          messageSquareNodes: [...activeMessageSquareNodes, ...stepMessageSquareNodes],
        };
        state.fileName = _directPcfData.fileName;
        if (activeComponents.length === 0) {
          state.viewer3DConfig.coordinateMap = {
            ...(state.viewer3DConfig.coordinateMap || {}),
            verticalAxis: 'Z',
            axisConvention: 'Z-up',
            gridPlane: 'auto',
          };
        }
        saveStickyState();
        _setStatusMessage(container, `STP appended: ${stepComponents.length} structural member(s) from ${file.name}. Total scene components: ${mergedComponents.length}.`);
        _rerenderIfActive();
      } else {
        console.warn('[ImportSTP] Import failed:', log);
        notify({ level: 'error', title: 'STP import failed', message: result.message || 'STP import failed. Check browser console for details.', details: log });
      }
    } catch (err) {
      console.error('[ImportSTP]', err);
      notify({ level: 'error', title: 'STP import error', message: String(err?.message || err) });
    } finally {
      if (label) label.style.opacity = '';
      event.target.value = '';
    }
  });
  // Spare modal state
  let _spareModalKey = 'spare1';
  let _spareModalParsed = null;
  const spareModal = container.querySelector('#viewer3d-spare-modal');
  const spareModalTitle = container.querySelector('#viewer3d-spare-modal-title');
  const spareModalFile = container.querySelector('#viewer3d-spare-modal-file');
  const spareModalPreview = container.querySelector('#viewer3d-spare-modal-preview');
  const spareModalFieldSel = container.querySelector('#viewer3d-spare-modal-field');
  const spareModalApply = container.querySelector('#viewer3d-spare-modal-apply');

  const openSpareModal = (spareKey) => {
    _spareModalKey = spareKey;
    _spareModalParsed = null;
    if (spareModalTitle) spareModalTitle.textContent = `${spareKey === 'spare1' ? 'Spare 1' : 'Spare 2'} — Import CSV`;
    if (spareModalPreview) spareModalPreview.innerHTML = '';
    if (spareModalFieldSel) spareModalFieldSel.innerHTML = '';
    if (spareModalApply) spareModalApply.disabled = true;
    if (spareModalFile) spareModalFile.value = '';
    if (spareModal) spareModal.style.display = 'block';
  };
  const closeSpareModal = () => { if (spareModal) spareModal.style.display = 'none'; };

  container.querySelector('#viewer3d-spare1-btn')?.addEventListener('click', () => openSpareModal('spare1'));
  container.querySelector('#viewer3d-spare2-btn')?.addEventListener('click', () => openSpareModal('spare2'));
  container.querySelector('#viewer3d-spare-modal-close')?.addEventListener('click', closeSpareModal);
  spareModal?.addEventListener('click', (e) => { if (e.target === spareModal) closeSpareModal(); });

  spareModalFile?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = _parseSpareCsvData(text);
      _spareModalParsed = { ...parsed, fileName: file.name };
      // Preview: first 5 rows as table
      if (spareModalPreview) {
        const cols = parsed.fields.slice(0, 8);
        const rows = parsed.rows.slice(0, 5);
        spareModalPreview.innerHTML = `<table style="border-collapse:collapse;width:100%"><thead><tr>${
          cols.map(c => `<th style="border:1px solid #ccc;padding:2px 6px;background:#e8edf3;font-size:0.75rem">${_esc(c)}</th>`).join('')
        }</tr></thead><tbody>${
          rows.map(r => `<tr>${cols.map(c => `<td style="border:1px solid #e0e0e0;padding:2px 6px;font-size:0.75rem">${_esc(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')
        }</tbody></table><p style="font-size:0.75rem;color:#666;margin-top:4px">${parsed.rows.length} row(s)</p>`;
      }
      // Populate field dropdown
      if (spareModalFieldSel) {
        spareModalFieldSel.innerHTML = parsed.fields
          .map(f => `<option value="${_escAttr(f)}">${_esc(f)}</option>`).join('');
      }
      if (spareModalApply) spareModalApply.disabled = false;
    } catch (err) {
      console.error(err);
      if (spareModalPreview) spareModalPreview.innerHTML = `<p style="color:red">Parse error: ${_esc(String(err?.message || err))}</p>`;
      if (spareModalApply) spareModalApply.disabled = true;
    }
  });

  spareModalApply?.addEventListener('click', () => {
    if (!_spareModalParsed) return;
    const spareKey = _spareModalKey;
    const parsed = _spareModalParsed;
    const selectedField = spareModalFieldSel?.value || parsed.fields[0] || '';
    _spareOverlayRuntime[spareKey] = { rows: parsed.rows, fields: parsed.fields, fileName: parsed.fileName };
    if (!state.viewer3DConfig.spareOverlays) {
      state.viewer3DConfig.spareOverlays = {
        spare1: { enabled: false, selectedField: '' },
        spare2: { enabled: false, selectedField: '' },
        snapToNearest: true,
        snapToleranceMm: 180,
      };
    }
    if (!state.viewer3DConfig.spareOverlays[spareKey]) {
      state.viewer3DConfig.spareOverlays[spareKey] = { enabled: false, selectedField: '' };
    }
    state.viewer3DConfig.spareOverlays[spareKey].enabled = true;
    state.viewer3DConfig.spareOverlays[spareKey].selectedField = selectedField;
    saveStickyState();
    _setStatusMessage(container, `${spareKey === 'spare1' ? 'Spare 1' : 'Spare 2'} loaded: ${parsed.rows.length} mapped row(s) from ${parsed.fileName}.`);
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: `${spareKey}-updated` });
    closeSpareModal();
  });
  container.querySelector('#viewer3d-import-raw-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const label = container.querySelector('#viewer3d-import-raw-label');
    if (label) label.style.opacity = '0.5';
    const log = [];
    try {
      const result = await importFromRawFile(file, state, log);
      if (result.ok && result.directPcfData) {
        _directPcfData = result.directPcfData;
        state.fileName = file.name;
        // ACCDB/XML/PDF use Y as the vertical axis (2nd coordinate = elevation)
        state.viewer3DConfig.coordinateMap = {
          ...(state.viewer3DConfig.coordinateMap || {}),
          verticalAxis: 'Y',
          axisConvention: 'Y-up',
          gridPlane: 'auto',
        };
        saveStickyState();
        _rerenderIfActive();
      } else {
        console.warn('[ImportRaw] Import failed:', log);
        notify({ level: 'error', title: 'Import failed', message: result.message || 'Import failed — check the browser console for details.', details: log });
      }
    } catch (err) {
      console.error('[ImportRaw]', err);
      notify({ level: 'error', title: 'Import error', message: String(err?.message || err) });
    } finally {
      if (label) label.style.opacity = '';
      event.target.value = '';
    }
  });
  container.querySelector('#viewer3d-fit-btn')?.addEventListener('click', () => {
    executeViewerAction(_viewer, 'VIEW_FIT_ALL');
  });
  container.querySelector('#viewer3d-fit-sel-btn')?.addEventListener('click', () => {
    executeViewerAction(_viewer, 'VIEW_FIT_SELECTION');
  });
  container.querySelector('#viewer3d-open-config')?.addEventListener('click', () => {
    const modal = container.querySelector('#viewer3d-config-modal');
    const modalContent = container.querySelector('#viewer3d-config-content');
    if (!modal || !modalContent) return;
    renderConfig(modalContent);
    modal.style.display = 'block';
  });
  container.querySelector('#viewer3d-config-close')?.addEventListener('click', () => {
    const modal = container.querySelector('#viewer3d-config-modal');
    if (modal) modal.style.display = 'none';
  });
  container.querySelector('#viewer3d-config-modal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'viewer3d-config-modal') event.currentTarget.style.display = 'none';
  });

  container.querySelector('#viewer3d-vertical-axis')?.addEventListener('change', (e) => {
    const axis = String(e.target.value || 'Z').toUpperCase() === 'Y' ? 'Y' : 'Z';
    _setStatusMessage(container, `Axis changed to ${axis}-up. Plane and measure alignment refreshed.`);
    state.viewer3DConfig.coordinateMap = {
      ...(state.viewer3DConfig.coordinateMap || {}),
      verticalAxis: axis,
      axisConvention: axis === 'Y' ? 'Y-up' : 'Z-up',
      gridPlane: 'auto',
    };
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'vertical-axis' });
  });

  container.querySelectorAll('[data-viewer-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const actionId = btn.getAttribute('data-viewer-action');
      if (actionId === 'SECTION_BOX') {
        revealSectionControls();
        const select = container.querySelector('#viewer3d-section-mode');
        if (select) select.value = 'BOX';
      } else if (actionId === 'SECTION_PLANE_UP') {
        revealSectionControls();
        const select = container.querySelector('#viewer3d-section-mode');
        if (select) select.value = 'PLANE_UP';
      } else if (actionId === 'SECTION_DISABLE') {
        const select = container.querySelector('#viewer3d-section-mode');
        if (select) select.value = 'OFF';
      }
      executeViewerAction(_viewer, actionId);
      _updateToolbarActiveState(container, actionId);
    });
  });

  const heatmapEnabled = container.querySelector('#viewer3d-top-heatmap-enabled');
  const heatmapMetric = container.querySelector('#viewer3d-top-heatmap-metric');
  const heatmapBuckets = container.querySelector('#viewer3d-top-heatmap-buckets');

  const applyHeatmapConfig = () => {
    state.viewer3DConfig.heatmap.enabled = !!heatmapEnabled?.checked;
    state.viewer3DConfig.heatmap.metric = heatmapMetric?.value || 'T1';
    state.viewer3DConfig.heatmap.bucketCount = Number(heatmapBuckets?.value || 5);
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'heatmap-updated' });
  };

  heatmapEnabled?.addEventListener('change', applyHeatmapConfig);
  heatmapMetric?.addEventListener('change', applyHeatmapConfig);
  heatmapBuckets?.addEventListener('change', applyHeatmapConfig);

  const nodesEnabled = container.querySelector('#viewer3d-top-nodes-enabled');
  nodesEnabled?.addEventListener('change', (e) => {
    if (!state.viewer3DConfig.nodes) state.viewer3DConfig.nodes = {};
    state.viewer3DConfig.nodes.enabled = !!e.target.checked;
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'nodes-toggled' });
  });
  const lineEnabled = container.querySelector('#viewer3d-top-line-enabled');
  lineEnabled?.addEventListener('change', (e) => {
    if (!state.viewer3DConfig.overlay) state.viewer3DConfig.overlay = {};
    if (!state.viewer3DConfig.overlay.annotations) state.viewer3DConfig.overlay.annotations = {};
    state.viewer3DConfig.overlay.annotations.messageSquareEnabled = !!e.target.checked;
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'line-labels-toggled' });
  });
  const lengthEnabled = container.querySelector('#viewer3d-top-length-enabled');
  lengthEnabled?.addEventListener('change', (e) => {
    if (!state.viewer3DConfig.lengthLabels) state.viewer3DConfig.lengthLabels = {};
    state.viewer3DConfig.lengthLabels.enabled = !!e.target.checked;
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'length-labels-toggled' });
  });
  container.querySelector('#viewer3d-label-min-gap')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v >= 0) {
      if (!state.viewer3DConfig.lengthLabels) state.viewer3DConfig.lengthLabels = {};
      state.viewer3DConfig.lengthLabels.minWorldGap = v;
      saveStickyState();
      emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'length-labels-toggled' });
    }
  });
  container.querySelector('#viewer3d-theme-select')?.addEventListener('change', (e) => {
    if (!state.viewerSettings) state.viewerSettings = {};
    if (!state.viewer3DConfig) state.viewer3DConfig = {};
    if (!state.viewer3DConfig.scene) state.viewer3DConfig.scene = {};
    
    const newTheme = e.target.value;
    state.viewerSettings.themePreset = newTheme;
    state.viewer3DConfig.scene.themePreset = newTheme;
    
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'theme-changed' });
  });
  const overlayScale = container.querySelector('#viewer3d-overlay-scale');
  const overlayScaleValue = container.querySelector('#viewer3d-overlay-scale-value');
  const applyOverlayScale = () => {
    if (!overlayScale) return;
    const multiplier = Math.max(0.2, Number(overlayScale.value || 100) / 100);
    if (overlayScaleValue) overlayScaleValue.textContent = `${multiplier.toFixed(2)}x`;
    if (!state.viewer3DConfig.overlay) state.viewer3DConfig.overlay = {};
    if (!state.viewer3DConfig.overlay.smartScale) state.viewer3DConfig.overlay.smartScale = {};
    state.viewer3DConfig.overlay.smartScale.multiplier = multiplier;
    _viewer?.setOverlaySmartScaleMultiplier?.(multiplier);
    saveStickyState();
  };
  overlayScale?.addEventListener('input', applyOverlayScale);
  const supportScale = container.querySelector('#viewer3d-support-symbol-scale');
  const supportScaleValue = container.querySelector('#viewer3d-support-symbol-scale-value');
  const applySupportScale = () => {
    if (!supportScale) return;
    const scale = Math.max(0.5, Number(supportScale.value || 200) / 100);
    if (supportScaleValue) supportScaleValue.textContent = `${scale.toFixed(2)}x`;
    if (!state.viewer3DConfig.supportGeometry) state.viewer3DConfig.supportGeometry = {};
    state.viewer3DConfig.supportGeometry.symbolScale = scale;
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: 'support-symbol-scale' });
  };
  supportScale?.addEventListener('input', applySupportScale);

  const spare1Enabled = container.querySelector('#viewer3d-top-spare1-enabled');
  const spare1Field = container.querySelector('#viewer3d-top-spare1-field');
  const spare2Enabled = container.querySelector('#viewer3d-top-spare2-enabled');
  const spare2Field = container.querySelector('#viewer3d-top-spare2-field');
  const applySpareConfig = (spareKey) => {
    if (!state.viewer3DConfig.spareOverlays) {
      state.viewer3DConfig.spareOverlays = {
        spare1: { enabled: false, selectedField: '' },
        spare2: { enabled: false, selectedField: '' },
        snapToNearest: true,
        snapToleranceMm: 180,
      };
    }
    if (!state.viewer3DConfig.spareOverlays[spareKey]) {
      state.viewer3DConfig.spareOverlays[spareKey] = { enabled: false, selectedField: '' };
    }
    if (spareKey === 'spare1') {
      state.viewer3DConfig.spareOverlays.spare1.enabled = !!spare1Enabled?.checked;
      state.viewer3DConfig.spareOverlays.spare1.selectedField = String(spare1Field?.value || '');
    } else {
      state.viewer3DConfig.spareOverlays.spare2.enabled = !!spare2Enabled?.checked;
      state.viewer3DConfig.spareOverlays.spare2.selectedField = String(spare2Field?.value || '');
    }
    saveStickyState();
    emit(RuntimeEvents.VIEWER3D_CONFIG_CHANGED, { source: 'viewer3d-tab', reason: `${spareKey}-updated` });
  };
  spare1Enabled?.addEventListener('change', () => applySpareConfig('spare1'));
  spare1Field?.addEventListener('change', () => applySpareConfig('spare1'));
  spare2Enabled?.addEventListener('change', () => applySpareConfig('spare2'));
  spare2Field?.addEventListener('change', () => applySpareConfig('spare2'));

  const boxPad = container.querySelector('#viewer3d-section-boxpad');
  const boxPadValue = container.querySelector('#viewer3d-section-boxpad-value');
  _wireAdaptiveCenteredSlider(boxPad, boxPadValue, (val) => {
    _viewer?.setSectionBoxPadding?.(val);
  });
  const planeOffset = container.querySelector('#viewer3d-section-planeoffset');
  const planeOffsetValue = container.querySelector('#viewer3d-section-planeoffset-value');
  _wireAdaptiveCenteredSlider(planeOffset, planeOffsetValue, (val) => {
    _viewer?.setSectionPlaneOffset?.(val);
  });

  const sectionMode = container.querySelector('#viewer3d-section-mode');
  sectionMode?.addEventListener('change', () => {
    const mode = String(sectionMode.value || 'OFF').toUpperCase();
    if (mode === 'BOX') {
      _viewer?.setSectionMode?.('BOX');
      _updateSectionActiveState(container, 'BOX');
      return;
    }
    if (mode === 'PLANE_UP') {
      _viewer?.setSectionMode?.('PLANE_UP');
      _updateSectionActiveState(container, 'PLANE_UP');
      return;
    }
    _viewer?.disableSection?.();
    _updateSectionActiveState(container, 'OFF');
  });
}

/**
 * Sync the left-panel settings panel HTML to current config state,
 * without touching the 3D canvas/geometry at all.
 * Called after overlay-only config changes to keep checkboxes in sync.
 */
function _updateSettingsPanelSection(container) {
  if (!container) return;
  const panel = container.querySelector('#viewer3d-settings-panel');
  if (!panel) return;
  const cfg = getResolvedViewer3DConfig(state);
  const addOnDisabledAttr = cfg.disableAllSettings ? 'disabled' : '';
  const spare1Fields = _spareOverlayRuntime.spare1.fields || [];
  const spare2Fields = _spareOverlayRuntime.spare2.fields || [];
  const spare1SelectedField = _resolvePreferredSpareField(cfg.spareOverlays?.spare1?.selectedField, spare1Fields);
  const spare2SelectedField = _resolvePreferredSpareField(cfg.spareOverlays?.spare2?.selectedField, spare2Fields);

  // Sync checkboxes/selects directly instead of re-rendering the panel HTML,
  // avoiding any flicker or loss of scroll position.
  const syncCheck = (id, val) => {
    const el = panel.querySelector(`#${id}`);
    if (el) el.checked = !!val;
  };
  const syncSelect = (id, val) => {
    const el = panel.querySelector(`#${id}`);
    if (el) el.value = String(val || '');
  };

  syncCheck('viewer3d-top-heatmap-enabled', cfg.heatmap?.enabled);
  syncSelect('viewer3d-top-heatmap-metric', cfg.heatmap?.metric || 'T1');
  syncCheck('viewer3d-top-nodes-enabled', cfg.nodes?.enabled);
  syncCheck('viewer3d-top-line-enabled', cfg.overlay?.annotations?.messageSquareEnabled !== false);
  syncCheck('viewer3d-top-verification-enabled', !!cfg.lengthLabels?.verificationMode);
  syncCheck('viewer3d-top-length-enabled', cfg.lengthLabels?.enabled);
  syncCheck('viewer3d-top-spare1-enabled', cfg.spareOverlays?.spare1?.enabled);
  syncCheck('viewer3d-top-spare2-enabled', cfg.spareOverlays?.spare2?.enabled);
  syncSelect('viewer3d-top-spare1-field', spare1SelectedField);
  syncSelect('viewer3d-top-spare2-field', spare2SelectedField);
  const overlayScale = panel.querySelector('#viewer3d-overlay-scale');
  const overlayScaleValue = panel.querySelector('#viewer3d-overlay-scale-value');
  if (overlayScale) overlayScale.value = String(Math.round(Number(cfg.overlay?.smartScale?.multiplier || 1) * 100));
  if (overlayScaleValue) overlayScaleValue.textContent = `${Number(cfg.overlay?.smartScale?.multiplier || 1).toFixed(2)}x`;
  const supportScale = panel.querySelector('#viewer3d-support-symbol-scale');
  const supportScaleValue = panel.querySelector('#viewer3d-support-symbol-scale-value');
  if (supportScale) supportScale.value = String(Math.round(Number(cfg.supportGeometry?.symbolScale || 2) * 100));
  if (supportScaleValue) supportScaleValue.textContent = `${Number(cfg.supportGeometry?.symbolScale || 2).toFixed(2)}x`;
}

function _applyOverlayLayersToViewer(cfg, dataSource) {
  if (!_viewer) return;
  const messageCircleNodes = Array.isArray(dataSource?.messageCircleNodes) ? dataSource.messageCircleNodes : [];
  const messageSquareNodes = Array.isArray(dataSource?.messageSquareNodes) ? dataSource.messageSquareNodes : [];
  _viewer.loadMessageCircleNodes?.(messageCircleNodes);
  _viewer.loadMessageSquareNodes?.(messageSquareNodes);
  _viewer.setOverlayLayerVisibility?.('message-circle', !!cfg.nodes?.enabled);
  _viewer.setOverlayLayerVisibility?.('message-square', cfg.overlay?.annotations?.messageSquareEnabled !== false);
  _viewer.refreshLengthLabels?.(dataSource?.components || []);
  _viewer.setOverlayLayerVisibility?.('length', !!cfg.lengthLabels?.enabled);

  const spare1Rows = Array.isArray(_spareOverlayRuntime.spare1.rows) ? _spareOverlayRuntime.spare1.rows : [];
  const spare2Rows = Array.isArray(_spareOverlayRuntime.spare2.rows) ? _spareOverlayRuntime.spare2.rows : [];
  const spare1Field = _resolvePreferredSpareField(cfg.spareOverlays?.spare1?.selectedField, _spareOverlayRuntime.spare1.fields || []);
  const spare2Field = _resolvePreferredSpareField(cfg.spareOverlays?.spare2?.selectedField, _spareOverlayRuntime.spare2.fields || []);
  _viewer.setOverlayLayerData?.('spare1', spare1Rows);
  _viewer.setOverlayLayerData?.('spare2', spare2Rows);
  _viewer.setOverlayLayerField?.('spare1', spare1Field);
  _viewer.setOverlayLayerField?.('spare2', spare2Field);
  _viewer.setOverlayLayerVisibility?.('spare1', !!cfg.spareOverlays?.spare1?.enabled);
  _viewer.setOverlayLayerVisibility?.('spare2', !!cfg.spareOverlays?.spare2?.enabled);
  _viewer.rebuildOverlayLayers?.();
}

function _registerShortcuts(cfg, container) {
  if (_shortcutHandler) {
    window.removeEventListener('keydown', _shortcutHandler);
    _shortcutHandler = null;
  }
  _shortcutContainer = container || _shortcutContainer;
  const shortcutsEnabled = !(cfg.disableAllSettings || cfg.featureFlags?.shortcuts === false);

  _shortcutHandler = (event) => {
    // Global Escape: always return Viewer nav to Select mode.
    if (event.code === 'Escape') {
      event.preventDefault();
      const modal = _shortcutContainer?.querySelector?.('#viewer3d-config-modal');
      if (modal && modal.style.display === 'block') {
        modal.style.display = 'none';
      }
      executeViewerAction(_viewer, 'NAV_SELECT');
      _updateToolbarActiveState(_shortcutContainer, 'NAV_SELECT');
      return;
    }

    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (!shortcutsEnabled) return;

    const actionId = cfg.shortcuts?.[event.code];
    if (!actionId) return;
    event.preventDefault();
    executeViewerAction(_viewer, actionId);
    _updateToolbarActiveState(_shortcutContainer, actionId);
  };
  window.addEventListener('keydown', _shortcutHandler);
}

// Action IDs that represent mutually-exclusive nav modes.
// Only one of these should be active at a time.
const _NAV_MODE_ACTIONS = new Set([
  'NAV_SELECT', 'NAV_ORBIT', 'NAV_PAN',
  'MEASURE_TOOL', 'VIEW_MARQUEE_ZOOM',
  'NAV_PLAN_X', 'NAV_ROTATE_Y', 'NAV_ROTATE_Z',
]);

/**
 * Set data-active="true" on the matching nav-mode button, false on all others.
 * Non-nav actions (FitAll, SnapISO, etc.) are left untouched.
 */
function _updateToolbarActiveState(container, activeActionId) {
  if (!_NAV_MODE_ACTIONS.has(activeActionId)) return;
  container.querySelectorAll('[data-viewer-action]').forEach((btn) => {
    const id = btn.getAttribute('data-viewer-action');
    if (_NAV_MODE_ACTIONS.has(id)) {
      btn.setAttribute('data-active', String(id === activeActionId));
    }
  });
}

/**
 * Read the viewer's current nav mode and sync toolbar button states.
 * Called after any operation that might change the mode internally.
 */
function _syncToolbarToNavMode(container) {
  if (!_viewer) return;
  const mode = _viewer.getNavMode?.();
  const modeToAction = {
    orbit:    'NAV_ORBIT',
    select:   'NAV_SELECT',
    pan:      'NAV_PAN',
    measure:  'MEASURE_TOOL',
    marquee:  'VIEW_MARQUEE_ZOOM',
    plan:     'NAV_PLAN_X',
    rotateY:  'NAV_ROTATE_Y',
    rotateZ:  'NAV_ROTATE_Z',
  };
  const actionId = modeToAction[mode];
  if (actionId) _updateToolbarActiveState(container, actionId);
}

/** Highlight the active section button (BOX / PLANE_UP / SECTION_DISABLE). */
function _updateSectionActiveState(container, mode) {
  const map = { BOX: 'SECTION_BOX', PLANE_UP: 'SECTION_PLANE_UP', OFF: 'SECTION_DISABLE' };
  const activeId = map[mode] || null;
  container.querySelectorAll('[data-viewer-action]').forEach((btn) => {
    const id = btn.getAttribute('data-viewer-action');
    if (id === 'SECTION_BOX' || id === 'SECTION_PLANE_UP' || id === 'SECTION_DISABLE') {
      btn.setAttribute('data-active', String(id === activeId));
    }
  });
}

/** Keep the left settings Clip Plane selector in sync with the active section mode. */
function _syncSectionModeControl(container, mode) {
  const select = container.querySelector('#viewer3d-section-mode');
  if (!select) return;
  const normalized = mode === 'BOX' || mode === 'PLANE_UP' ? mode : 'OFF';
  if (select.value !== normalized) select.value = normalized;
}

/** Highlight VIEW_TOGGLE_PROJECTION when perspective is active. */
function _updateProjectionActiveState(container, mode) {
  container.querySelectorAll('[data-viewer-action="VIEW_TOGGLE_PROJECTION"]').forEach((btn) => {
    btn.setAttribute('data-active', String(mode === 'perspective'));
  });
}

/**
 * Copy a measurement distance (mm) to the clipboard with a brief toast.
 */
function _copyMeasurementToClipboard(distance) {
  if (distance == null || !Number.isFinite(Number(distance))) return;
  const text = `${Number(distance).toFixed(2)} mm`;
  navigator.clipboard?.writeText(text).catch(() => {});
  // Brief visual toast — reuse any existing toast element or console
  console.info(`[Measure] Copied to clipboard: ${text}`);
}

function _setStatusMessage(container, message) {
  const el = container?.querySelector?.('.status-message');
  if (!el) return;
  el.textContent = String(message || '');
}

function _formatMeasurementStatus(payload) {
  const distance = Number(payload?.distance || 0);
  const dx = Number(payload?.dx ?? payload?.absDx ?? 0);
  const dy = Number(payload?.dy ?? payload?.absDy ?? 0);
  const dz = Number(payload?.dz ?? payload?.absDz ?? 0);
  return `Measure: ${distance.toFixed(1)} mm | dx ${dx.toFixed(1)} dy ${dy.toFixed(1)} dz ${dz.toFixed(1)} mm`;
}

function _wireAdaptiveCenteredSlider(slider, readout, onInput) {
  if (!slider) return;
  const step = Math.max(1, Number(slider.step || 1));
  const initialMin = Number(slider.min || -1000);
  const initialMax = Number(slider.max || 1000);
  let min = initialMin;
  let max = initialMax;
  const center = 0;
  const hardAbsLimit = 250000;
  let edgeLock = '';

  const updateReadout = (v) => {
    if (!readout) return;
    const value = Number(v || 0);
    const abs = Math.abs(value);
    const compact = abs >= 100000
      ? value.toExponential(2)
      : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
    readout.textContent = compact;
    readout.title = value.toFixed(0);
  };

  const expandRangeIfNeeded = (v) => {
    const edgeThreshold = Math.max(step * 1.5, (max - min) * 0.015);
    let direction = '';
    if (v <= min + edgeThreshold) direction = 'min';
    if (v >= max - edgeThreshold) direction = 'max';
    if (!direction) {
      edgeLock = '';
      return;
    }
    if (edgeLock === direction) return;
    edgeLock = direction;

    const span = Math.max(step * 10, max - min);
    const growBy = Math.max(step * 10, span * 0.35);
    if (direction === 'min') min = Math.max(-hardAbsLimit, Math.round(min - growBy));
    if (direction === 'max') max = Math.min(hardAbsLimit, Math.round(max + growBy));
    slider.min = String(min);
    slider.max = String(max);
  };

  const applyValue = () => {
    const raw = Number(slider.value || 0);
    const v = Math.max(min, Math.min(max, raw));
    if (v !== raw) slider.value = String(v);
    expandRangeIfNeeded(v);
    updateReadout(v);
    if (typeof onInput === 'function') onInput(v);
  };

  slider.min = String(initialMin);
  slider.max = String(initialMax);
  slider.value = String(center);
  updateReadout(center);
  if (typeof onInput === 'function') onInput(center);
  slider.addEventListener('input', applyValue);
}

function _wireSidePanelTabs(container) {
  const tabs = container.querySelectorAll('.panel-tab[data-target]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-target');
      container.querySelectorAll('.panel-tab[data-target]').forEach((x) => x.classList.remove('active'));
      container.querySelectorAll('.panel-content').forEach((x) => {
        x.classList.remove('active');
        x.style.display = 'none';
      });
      tab.classList.add('active');
      const panel = container.querySelector(`#${target}`);
      if (panel) {
        panel.classList.add('active');
        panel.style.display = 'block';
      }
    });
  });
}

function _renderToolbar(cfg, actions) {
  const style = `style="opacity:${Number(cfg.toolbar?.opacity ?? 1)}"`;

  if (cfg.disableAllSettings || cfg.featureFlags?.toolbar === false || cfg.toolbar?.enabled === false) {
    return `<div class="viewer3d-ribbon-actions viewer3d-ribbon-actions-disabled" ${style}></div>`;
  }

  const groups = [
    { label: 'Navigate', actions: ['NAV_SELECT', 'NAV_ORBIT', 'NAV_PAN', 'MEASURE_TOOL', 'VIEW_MARQUEE_ZOOM'] },
    { label: 'Rotate', actions: ['NAV_PLAN_X', 'NAV_ROTATE_Y', 'NAV_ROTATE_Z'] },
    { label: 'Snaps', actions: ['SNAP_ISO_NW', 'SNAP_ISO_NE', 'SNAP_ISO_SW', 'SNAP_ISO_SE'] },
    { label: 'View', actions: ['VIEW_FIT_ALL', 'VIEW_FIT_SELECTION', 'VIEW_TOGGLE_PROJECTION'] },
    { label: 'Section', actions: ['SECTION_BOX', 'SECTION_PLANE_UP', 'SECTION_DISABLE'] },
  ];

  const mappedActions = new Set(groups.flatMap((group) => group.actions));
  const unmapped = actions.filter((actionId) => !mappedActions.has(actionId));
  if (unmapped.length > 0) {
    groups.push({ label: 'More', actions: unmapped });
  }

  let html = `<div class="viewer3d-ribbon-actions" ${style}>`;

  for (const group of groups) {
    const groupItems = group.actions.filter((actionId) => actions.includes(actionId));
    if (groupItems.length === 0) continue;

    html += `
      <div class="ribbon-action-group">
        <div class="ribbon-group-label">${_esc(group.label)}</div>
        <div class="ribbon-group-buttons">
          ${groupItems.map((actionId) => {
            const label = ACTION_LABELS[actionId] || actionId;
            const tooltip = cfg.actions?.[actionId]?.tooltip || label;
            const title = `title="${_esc(tooltip)}"`;
            const icon = ACTION_ICONS[actionId];
            const glyph = icon
              ? `<span class="viewer3d-icon-glyph">${icon}</span>`
              : `<span class="viewer3d-icon-fallback">${_esc(label)}</span>`;
            return `<button class="btn-icon viewer3d-icon-btn" data-viewer-action="${actionId}" aria-label="${_esc(tooltip)}" ${title}>${glyph}<span class="viewer3d-icon-label">${_esc(label)}</span></button>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function _updateComponentPanel(container, cfg) {
  const panel = container.querySelector('#v3d-panel-component');
  if (!panel) return;
  panel.innerHTML = _renderComponentPanel(cfg);
}

function _renderComponentPanel(cfg) {
  if (cfg.disableAllSettings) {
    return '<div class="panel-placeholder">Disable-all mode enabled: add-on component panel is bypassed.</div>';
  }
  if (cfg.featureFlags?.componentPanel === false || cfg.componentPanel?.enabled === false) {
    return '<div class="panel-placeholder">Component panel is disabled in viewer3DConfig.</div>';
  }
  const model = buildComponentPanelModel(_selectedComponent, cfg.componentPanel || {});
  if (!model.sections.length) return '<div class="panel-placeholder">Select a component to inspect.</div>';

  return `
    <div class="geo-legend-panel" style="background:linear-gradient(180deg, #0f1b31 0%, #101a2a 100%); color:#eff6ff; border:1px solid rgba(98,144,210,0.2); box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);">
      <div class="legend-title" style="color:#f8fbff; border-bottom:1px solid rgba(98,144,210,0.24); padding-bottom:10px;">${_esc(model.title)}</div>
      ${model.sections.map((section) => `
        <h4 class="sub-heading" style="margin:0.85rem 0 0.45rem; color:#2f86ff; letter-spacing:0.06em;">${_esc(section.title)}</h4>
        <table class="data-table" style="font-size:11px; background:rgba(255,255,255,0.95); border:1px solid rgba(31,58,92,0.12);">
          <tbody>
            ${section.rows.map(([k, v]) => `<tr><td style="color:#5f7594; font-weight:600;">${_esc(k)}</td><td class="mono" style="color:#11253d; font-weight:700;">${_esc(String(v ?? '-'))}</td></tr>`).join('')}
          </tbody>
        </table>
      `).join('')}
    </div>
  `;
}

function _renderSummaryPanel(cfg, summary, dataSource, components) {
  const heat = cfg.heatmap || {};
  const typeCounts = summary;
  const parsed = dataSource?.parsed || null;
  const nodes = Object.keys(parsed?.nodes || {}).length;
  const elements = parsed?.elements?.length || 0;
  const csvRows = parsed ? buildUniversalCSV(parsed, { supportMappings: state.sticky?.supportMappings || [] }) : [];
  const pipeRefs = [...new Set((components || []).map((c) => c.attributes?.['PIPELINE-REFERENCE']).filter(Boolean))];
  const sourceLabel = dataSource?.kind === 'direct-pcf' ? 'Direct PCF import' : 'ACCDB data via accdb-to-pcf.js';

  return `
    <div class="geo-legend-panel">
      <div class="legend-title">Heatmap</div>
      <div class="legend-row"><span>Heatmap</span><span class="mono" style="margin-left:auto;">${heat.enabled ? 'ON' : 'OFF'}</span></div>
      <div class="legend-row"><span>Metric</span><span class="mono" style="margin-left:auto;">${_esc(String(heat.metric || 'T1'))}</span></div>
      <div class="legend-row"><span>Steps</span><span class="mono" style="margin-left:auto;">${Number(heat.bucketCount || 5)}</span></div>

      <h4 class="sub-heading" style="margin-top:1rem;">Component Mix</h4>
      ${typeCounts.length
        ? typeCounts.map((row) => `<div class="legend-row"><span>${_esc(row.type)}</span><span class="mono" style="margin-left:auto;">${row.count}</span></div>`).join('')
        : '<div class="panel-placeholder">No components.</div>'}

      <h4 class="sub-heading" style="margin-top:1rem;">Source Summary</h4>
      <div class="legend-row"><span class="legend-swatch" style="background:#1e90ff"></span><span>${elements} parsed element(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#32cd32"></span><span>${nodes} resolved node(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#808080"></span><span>${summary.length} rendered component group(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff4500"></span><span>${_esc(sourceLabel)}</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#8a2be2"></span><span>${csvRows.length} universal CSV row(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e07020"></span><span>${pipeRefs.length ? `${pipeRefs.length} pipeline reference(s)` : 'No pipeline reference found'}</span></div>
    </div>
  `;
}

function _buildViewerComponents(parsed) {
  if (!parsed?.elements?.length) return [];

  const csvRows = buildUniversalCSV(parsed, { supportMappings: state.sticky?.supportMappings || [] });
  // Engine Mode Selection
  const method = state.engineMode === 'common' ? 'ContEngineMethod' : 'Legacy';
  const segments = normalizeToPCF(csvRows, { method });
  if (!segments.length) return [];

  const nodePos = _resolveNodePositions(csvRows);
  const components = [];

  for (const seg of segments) {
    const type = String(seg.COMPONENT_TYPE || 'PIPE').toUpperCase();
    if (type === 'GHOST' || type === 'MESSAGE-SQUARE') continue;

    const p1 = _pt(seg.EP1) || _pt(nodePos.get(seg.FROM_NODE));
    const p2 = _pt(seg.EP2) || _pt(nodePos.get(seg.TO_NODE));
    const centre = type === 'BEND'
      ? _resolveBendCentrePoint(seg, p1, p2, nodePos)
      : (_pt(seg.CENTRE_POINT) || null);
    const supportCoord = _pt(seg.SUPPORT_COORDS) || _pt(nodePos.get(seg.FROM_NODE)) || _pt(nodePos.get(seg.TO_NODE));

    const materialNumeric = (seg.MATERIAL && seg.MATERIAL.match(/\d+/)) ? seg.MATERIAL.match(/\d+/)[0] : seg.MATERIAL;

    const attributes = {
      'PIPELINE-REFERENCE': seg.PIPELINE_REFERENCE || '',
      MATERIAL: seg.MATERIAL || '',
      SKEY: seg.SKEY || '',
      'COMPONENT-ATTRIBUTE1': seg.P1 ? `${Math.round(seg.P1 * 100)} KPA` : '',
      'COMPONENT-ATTRIBUTE2': seg.T1 ? `${Math.round(seg.T1)} C` : '',
      'COMPONENT-ATTRIBUTE3': materialNumeric || '',
      'COMPONENT-ATTRIBUTE4': seg.WALL_THICK ? `${seg.WALL_THICK} MM` : '',
      'COMPONENT-ATTRIBUTE5': seg.CORR_ALLOW ? `${seg.CORR_ALLOW} MM` : '',
      'COMPONENT-ATTRIBUTE6': seg.INSUL_DENSITY ? `${Math.round(seg.INSUL_DENSITY * 1000000)} KG/M3` : '',
      'COMPONENT-ATTRIBUTE8': seg.RIGID_WEIGHT && type !== 'PIPE' ? `${seg.RIGID_WEIGHT} KG` : '',
      'COMPONENT-ATTRIBUTE9': seg.FLUID_DENSITY ? `${Math.round(seg.FLUID_DENSITY * 1000000)} KG/M3` : '',
      'COMPONENT-ATTRIBUTE10': seg.P_HYDRO ? `${Math.round(seg.P_HYDRO * 100)} KPA` : '',
      'COMPONENT-ATTRIBUTE97': seg.REF_NO || '',
      'COMPONENT-ATTRIBUTE98': seg.SEQ_NO || '',
    };

    if (type === 'SUPPORT') {
      const supportName = seg.SUPPORT_NAME || seg.SUPPORT_TAG || 'RST';
      attributes.SKEY = supportName;
      attributes.SUPPORT_TAG = seg.SUPPORT_TAG || '';
      attributes.SUPPORT_NAME = supportName;
      attributes.SUPPORT_KIND = seg.SUPPORT_KIND || '';
      attributes.SUPPORT_DESC = seg.SUPPORT_DESC || '';
      attributes.SUPPORT_FRICTION = seg.SUPPORT_FRICTION ?? '';
      attributes.SUPPORT_GAP = seg.SUPPORT_GAP ?? '';
      attributes.SUPPORT_GUID = seg.SUPPORT_GUID || 'UCI:UNKNOWN';
      attributes.SUPPORT_DOFS = seg.SUPPORT_DOFS || '';
      attributes['COMPONENT-ATTRIBUTE1'] = supportName;
      attributes['<SUPPORT_NAME>'] = supportName;
      attributes['<SUPPORT_GUID>'] = seg.SUPPORT_GUID || 'UCI:UNKNOWN';
      attributes.AXIS_COSINES = seg.AXIS_COSINES || '';
      attributes.PIPE_AXIS_COSINES = seg.PIPE_AXIS_COSINES || '';
      if (seg.SUPPORT_COORDS) {
        attributes.SUPPORT_COORDS = `${seg.SUPPORT_COORDS.x ?? 0}, ${seg.SUPPORT_COORDS.y ?? 0}, ${seg.SUPPORT_COORDS.z ?? 0}`;
      }
    }

    components.push({
      id: seg.REF_NO || `viewer3d-${seg.SEQ_NO}`,
      type,
      points: p1 && p2 ? [p1, p2] : [],
      centrePoint: centre,
      branch1Point: null,
      coOrds: type === 'SUPPORT' ? supportCoord : null,
      bore: Number(seg.DIAMETER || 0),
      fixingAction: '',
      attributes,
      source: seg,
    });
  }

  return components;
}

function _buildSupportFallbackComponents(parsed) {
  const supports = [];
  if (!parsed?.restraints?.length || !parsed?.nodes) return supports;

  for (const r of parsed.restraints) {
    const nodeId = Number(r.node ?? r.NODE ?? r.id);
    const pos = parsed.nodes?.[nodeId] || parsed.nodes?.[String(nodeId)];
    if (!pos) continue;

    const rawType = String(r.rawType || r.type || r.name || 'RST').trim();
    const blockCode = String(r.supportBlock || '').toUpperCase() || ((rawType.toUpperCase().match(/\bCA\d+\b/) || [])[0] || '');
    const supportKind = blockCode === 'CA100'
      ? 'GDE'
      : (blockCode === 'CA150' || blockCode === 'CA250')
        ? 'RST'
        : /(^|[^A-Z0-9])(RIGID\s+)?ANC(HOR)?([^A-Z0-9]|$)|\bFIXED\b/i.test(rawType)
          ? 'ANC'
          : /(\bGDE\b|\bGUI\b|GUIDE|SLIDE|SLID|HANGER)/i.test(rawType)
            ? 'GDE'
            : /(\bRST\b|\bREST\b|\+Y)/i.test(rawType)
              ? 'RST'
              : /STOP/i.test(rawType)
                ? 'STP'
                : 'UNK';

    const supportName = blockCode || supportKind;
    if (supportKind === 'UNK' && !r.axisCosines) continue;

    supports.push({
      id: `support-${nodeId}-${supportName || supportKind}`,
      type: 'SUPPORT',
      points: [],
      centrePoint: null,
      branch1Point: null,
      coOrds: _pt(pos),
      bore: Number(pos.bore || 0),
      fixingAction: '',
      attributes: {
        SKEY: supportName,
        SUPPORT_TAG: rawType,
        SUPPORT_NAME: supportName,
        SUPPORT_KIND: supportKind,
        SUPPORT_DESC: r.supportDescription || '',
        SUPPORT_GUID: `UCI:${nodeId}`,
        '<SUPPORT_NAME>': supportName,
        '<SUPPORT_GUID>': `UCI:${nodeId}`,
        AXIS_COSINES: r.axisCosines
          ? `${r.axisCosines.x ?? 0}, ${r.axisCosines.y ?? 0}, ${r.axisCosines.z ?? 0}`
          : '',
      },
    });
  }

  return supports;
}

function _buildDirectPcfData(text, fileName) {
  // Route through PCFX canonical layer for a clean, normalised representation.
  // pcfxDocumentFromPcfText returns the document object directly (not { doc }).
  const doc = pcfxDocumentFromPcfText(text, fileName, {}, null);
  const canonicalItems = (doc && doc.canonical && doc.canonical.items) ? doc.canonical.items : [];

  const messageCircleNodes = canonicalItems
    .filter(c => String(c.type || '').toUpperCase() === 'MESSAGE-CIRCLE' && c.extras?.circleCoord && c.extras?.circleText)
    .map(c => ({ pos: c.extras.circleCoord, text: c.extras.circleText }));
  const messageSquareNodes = canonicalItems
    .filter(c => String(c.type || '').toUpperCase() === 'MESSAGE-SQUARE' && c.extras?.squarePos && c.extras?.squareText)
    .map(c => ({ pos: c.extras.squarePos, text: c.extras.squareText }));

  // Fall back to raw model for MESSAGE node data if extras not populated
  if (!messageCircleNodes.length || !messageSquareNodes.length) {
    try {
      const parsedPcf = parsePcfText(text, null);
      const model = normalizePcfModel(parsedPcf, null);
      if (!messageCircleNodes.length) {
        messageCircleNodes.push(...model.components
          .filter(c => c.type === 'MESSAGE-CIRCLE' && c.circleCoord && c.circleText)
          .map(c => ({ pos: c.circleCoord, text: c.circleText })));
      }
      if (!messageSquareNodes.length) {
        messageSquareNodes.push(...model.components
          .filter(c => c.type === 'MESSAGE-SQUARE' && c.squarePos && c.squareText)
          .map(c => ({ pos: c.squarePos, text: c.squareText })));
      }
    } catch (_) { /* ignore */ }
  }

  const components = canonicalItems
    .filter(c => {
      const t = String(c.type || '').toUpperCase();
      return t !== 'MESSAGE-CIRCLE' && t !== 'MESSAGE-SQUARE';
    })
    .map(item => viewerComponentFromCanonicalItem(item))
    .filter(Boolean);

  return {
    kind: 'direct-pcf',
    fileName,
    parsed: null,
    components,
    messageCircleNodes,
    messageSquareNodes,
  };
}

function _isLocalhostHost() {
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Load seeded mock payloads (JSON) from app static assets once.
 * Fallback: raises an explicit error if seed file is unavailable.
 */
async function _fetchMockSeedPayload() {
  if (_mockSeedPayload) return _mockSeedPayload;
  const response = await fetch('./opt/mock-pcf-data.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Mock seed request failed (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  _mockSeedPayload = payload && typeof payload === 'object' ? payload : {};
  return _mockSeedPayload;
}

/**
 * Resolve mock payload for a given key from config, and if missing,
 * hydrate from seeded JSON file, persist to sticky config, then return it.
 */
async function _resolveMockPayload(mockKey) {
  const mockData = state.viewer3DConfig?.mockData || {};
  const current = mockData[mockKey] && typeof mockData[mockKey] === 'object' ? mockData[mockKey] : {};
  const shouldRefreshLegacyMock1 =
    mockKey === 'mock1' &&
    String(current.fileName || '').trim() === 'ImportPcfDemo_20Rows.pcf';
  if (String(current.pcfText || '').trim() && !shouldRefreshLegacyMock1) return current;

  const seeded = await _fetchMockSeedPayload();
  const seededEntry = seeded[mockKey] && typeof seeded[mockKey] === 'object' ? seeded[mockKey] : null;
  if (!seededEntry || !String(seededEntry.pcfText || '').trim()) {
    throw new Error(`No seeded mock payload found for ${mockKey}.`);
  }

  if (!state.viewer3DConfig.mockData || typeof state.viewer3DConfig.mockData !== 'object') {
    state.viewer3DConfig.mockData = {};
  }
  state.viewer3DConfig.mockData[mockKey] = {
    ...(state.viewer3DConfig.mockData[mockKey] || {}),
    label: String(seededEntry.label || current.label || mockKey),
    fileName: String(seededEntry.fileName || current.fileName || `${mockKey}.pcf`),
    pcfText: String(seededEntry.pcfText || ''),
  };
  if (typeof state.viewer3DConfig.mockData.enabledOnLocalhostOnly !== 'boolean') {
    state.viewer3DConfig.mockData.enabledOnLocalhostOnly = true;
  }
  saveStickyState();

  return state.viewer3DConfig.mockData[mockKey];
}

function _mapDirectPcfComponent(comp) {
  const raw = comp?.raw || {};
  const type = _normalizeDirectPcfType(comp?.type);
  const point1 = _pt(comp?.ep1);
  const point2 = _pt(comp?.ep2);
  const centrePoint = _parseDirectPcfPoint(raw['CENTRE-POINT']);
  const branch1Point = _parseDirectPcfPoint(raw['BRANCH1-POINT']);
  const supportPoint = point1 || _parseDirectPcfPoint(raw['CO-ORDS']);
  const id = String(raw['COMPONENT-IDENTIFIER'] || comp?.id || `${type}-pcf`);
  // Map SUPPORT-DIRECTION keyword → SUPPORT_KIND for rendering classification
  const _DIRECTION_KIND = { DOWN: 'REST', UP: 'REST', NORTH: 'GUIDE', SOUTH: 'GUIDE', EAST: 'GUIDE', WEST: 'GUIDE' };
  const supportDir = String(raw['SUPPORT-DIRECTION'] || '').toUpperCase();
  const inferredKind = _DIRECTION_KIND[supportDir] || '';

  const attrs = {
    ...raw,
    SKEY: raw['SKEY'] || raw['COMPONENT-IDENTIFIER'] || '',
    SUPPORT_NAME: raw['SUPPORT-NAME'] || raw['<SUPPORT_NAME>'] || raw['COMPONENT-IDENTIFIER'] || '',
    SUPPORT_TAG: raw['SUPPORT-DIRECTION'] || '',
    SUPPORT_KIND: raw['SUPPORT_KIND'] || inferredKind,
    'SUPPORT-FRICTION': raw['SUPPORT-FRICTION'] ?? '',
    'SUPPORT-GAP': raw['SUPPORT-GAP'] || '',
    RATING: raw['RATING'] || '',
    'CORROSION-ALLOWANCE': raw['CORROSION-ALLOWANCE'] || raw['CORR'] || '',
    'ITEM-DESCRIPTION': raw['ITEM-DESCRIPTION'] || '',
    'PIPELINE-REFERENCE': raw['PIPELINE-REFERENCE'] || '',
  };

  return {
    id,
    type,
    points: point1 && point2 ? [point1, point2] : [],
    centrePoint,
    branch1Point,
    coOrds: type === 'SUPPORT' ? supportPoint : null,
    bore: Number(comp?.bore || point1?.bore || point2?.bore || 0),
    fixingAction: '',
    attributes: attrs,
    source: comp,
  };
}

function _normalizeDirectPcfType(type) {
  const value = String(type || 'UNKNOWN').toUpperCase();
  if (value.startsWith('REDUCER')) return 'REDUCER';
  if (value === 'ELBOW') return 'BEND';
  return value;
}

function _parseDirectPcfPoint(value) {
  if (!value) return null;
  const parts = String(value).trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return {
    x: Number(parts[0] || 0),
    y: Number(parts[1] || 0),
    z: Number(parts[2] || 0),
    bore: Number(parts[3] || 0),
  };
}

function _clearDirectPcfData() {
  _directPcfData = null;
}

function _resolveBendCentrePoint(seg, p1, p2, nodePos) {
  const declaredCentre = _pt(seg.CENTRE_POINT);
  if (declaredCentre) return declaredCentre;
  const controlPoint = _pt(nodePos.get(seg.CONTROL_NODE));
  if (controlPoint) return controlPoint;

  // §10.5.4: CP is the corner intersection — NOT the midpoint.
  // Midpoint gives a 180° angle → degenerate → renders as a cylinder.
  // Corner CP: try all 6 combinations of (EP1 or EP2) per coordinate axis;
  // the valid one has dist(CP,EP1) = dist(CP,EP2) and a non-zero radius.
  return _bendCornerCP(p1, p2) || null;
}

/**
 * Compute the 90° bend corner-intersection CP from two endpoints.
 * Per §10.5.4: CP shares one axis-coord with EP1 and the complementary
 * axis-coord with EP2, so dist(CP,EP1) = dist(CP,EP2) = bend_radius.
 * @param {{x,y,z}} p1
 * @param {{x,y,z}} p2
 * @returns {{x,y,z,bore}|null}
 */
function _bendCornerCP(p1, p2) {
  if (!p1 || !p2) return null;
  const bore = p1.bore || p2.bore || 0;
  const dist3 = (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);

  // 6 possible corner-intersection candidates (one axis from EP1, others from EP2)
  const candidates = [
    { x: p1.x, y: p2.y, z: p1.z },  // CP.x=EP1.x, CP.z=EP1.z, CP.y=EP2.y  (XZ-plane, Y turns)
    { x: p2.x, y: p1.y, z: p1.z },  // CP.y=EP1.y, CP.z=EP1.z, CP.x=EP2.x  (YZ-plane, X turns)
    { x: p1.x, y: p1.y, z: p2.z },  // CP.x=EP1.x, CP.y=EP1.y, CP.z=EP2.z  (XY-plane, Z turns)
    { x: p2.x, y: p1.y, z: p2.z },
    { x: p1.x, y: p2.y, z: p2.z },
    { x: p2.x, y: p2.y, z: p1.z },
  ];

  let best = null;
  let bestErr = Infinity;
  for (const cp of candidates) {
    const d1 = dist3(cp, p1);
    const d2 = dist3(cp, p2);
    if (d1 < 0.1 || d2 < 0.1) continue;   // endpoint ON corner → degenerate
    const err = Math.abs(d1 - d2);
    if (err < bestErr) { bestErr = err; best = cp; }
  }

  if (!best || bestErr > 1.0) return null;  // no valid corner found (not a 90° bend)
  return { x: best.x, y: best.y, z: best.z, bore };
}

function _resolveNodePositions(csvRows) {
  const nodePos = new Map();
  if (!csvRows?.length) return nodePos;

  const first = csvRows[0];
  if (first?.FROM_NODE !== undefined) {
    nodePos.set(first.FROM_NODE, { x: 0, y: 0, z: 0 });
  }

  let progress = true;
  let guard = 0;
  while (progress && guard < csvRows.length * 4) {
    guard += 1;
    progress = false;
    for (const row of csvRows) {
      const a = nodePos.get(row.FROM_NODE);
      const b = nodePos.get(row.TO_NODE);
      const dx = Number(row.DELTA_X || 0);
      const dy = Number(row.DELTA_Y || 0);
      const dz = Number(row.DELTA_Z || 0);

      if (a && !b) {
        nodePos.set(row.TO_NODE, { x: a.x + dx, y: a.y + dy, z: a.z + dz });
        progress = true;
      } else if (!a && b) {
        nodePos.set(row.FROM_NODE, { x: b.x - dx, y: b.y - dy, z: b.z - dz });
        progress = true;
      }
    }
  }

  return nodePos;
}

function _pt(v) {
  if (!v) return null;
  return {
    x: Number(v.x ?? 0),
    y: Number(v.y ?? 0),
    z: Number(v.z ?? 0),
    bore: Number(v.bore ?? 0),
  };
}

function _midPoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (Number(a.x) + Number(b.x)) / 2,
    y: (Number(a.y) + Number(b.y)) / 2,
    z: (Number(a.z) + Number(b.z)) / 2,
    bore: Number(a.bore || b.bore || 0),
  };
}

function _subPoint(a, b) {
  return {
    x: Number(a.x || 0) - Number(b.x || 0),
    y: Number(a.y || 0) - Number(b.y || 0),
    z: Number(a.z || 0) - Number(b.z || 0),
  };
}

function _lengthPoint(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function _crossPoint(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function _dotPoint(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function _scalePoint(v, factor) {
  return {
    x: v.x * factor,
    y: v.y * factor,
    z: v.z * factor,
  };
}

function _addPoint(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function _circumcentreFromThreePoints(a, b, c) {
  const ab = _subPoint(b, a);
  const ac = _subPoint(c, a);
  const normal = _crossPoint(ab, ac);
  const normalLengthSquared = _dotPoint(normal, normal);
  if (normalLengthSquared < 1e-6) return null;

  const abLengthSquared = _dotPoint(ab, ab);
  const acLengthSquared = _dotPoint(ac, ac);
  const term1 = _crossPoint(normal, ab);
  const term2 = _crossPoint(ac, normal);
  const numerator = _addPoint(
    _scalePoint(term1, acLengthSquared),
    _scalePoint(term2, abLengthSquared),
  );
  const offset = _scalePoint(numerator, 1 / (2 * normalLengthSquared));
  return {
    x: Number(a.x || 0) + offset.x,
    y: Number(a.y || 0) + offset.y,
    z: Number(a.z || 0) + offset.z,
  };
}

function _summariseComponents(components) {
  const counts = new Map();
  for (const comp of components || []) {
    const type = String(comp.type || 'UNKNOWN').toUpperCase();
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function _resolvePreferredSpareField(selectedField, fields) {
  const list = Array.isArray(fields) ? fields.map((f) => String(f || '').trim()).filter(Boolean) : [];
  if (!list.length) return '';
  const selected = String(selectedField || '').trim();
  if (selected && list.includes(selected)) return selected;
  return list[0];
}

/**
 * Parse Spare overlay CSV input into normalized rows:
 * - required coordinate columns: x,y,z (case-insensitive)
 * - all other columns exposed as field dropdown candidates
 */
function _parseSpareCsvData(text) {
  const table = _parseCsvTable(text);
  if (!table.length) throw new Error('CSV is empty.');
  const headers = table[0].map((h) => String(h || '').trim());
  const normalizedHeaders = headers.map((h) => h.toLowerCase());
  const xIndex = normalizedHeaders.indexOf('x');
  const yIndex = normalizedHeaders.indexOf('y');
  const zIndex = normalizedHeaders.indexOf('z');
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) {
    throw new Error('CSV must include coordinate headers: x,y,z (case-insensitive).');
  }
  const dataFields = headers
    .map((header, index) => ({ header, index }))
    .filter((entry) => entry.header && entry.index !== xIndex && entry.index !== yIndex && entry.index !== zIndex)
    .map((entry) => entry.header);
  const rows = [];
  for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
    const row = table[rowIndex] || [];
    const rawX = String(row[xIndex] ?? '').trim();
    const rawY = String(row[yIndex] ?? '').trim();
    const rawZ = String(row[zIndex] ?? '').trim();
    if (!rawX && !rawY && !rawZ) continue;
    const x = Number(rawX);
    const y = Number(rawY);
    const z = Number(rawZ);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const fields = {};
    for (const fieldName of dataFields) {
      const idx = headers.indexOf(fieldName);
      if (idx < 0) continue;
      fields[fieldName] = String(row[idx] ?? '').trim();
    }
    rows.push({ x, y, z, fields, styleKey: 'spare' });
  }
  if (!rows.length) throw new Error('No valid coordinate rows found in CSV.');
  return { rows, fields: dataFields };
}

function _parseCsvTable(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '' || rows.length === 0) rows.push(row);
  return rows.filter((r) => r.some((value) => String(value || '').trim() !== ''));
}

function _renderSummary(summary, parsed, components) {
  const nodes = Object.keys(parsed?.nodes || {}).length;
  const elements = parsed?.elements?.length || 0;
  const csvRows = parsed ? buildUniversalCSV(parsed, { supportMappings: state.sticky?.supportMappings || [] }) : [];
  const pipeRefs = [...new Set((components || []).map((c) => c.attributes?.['PIPELINE-REFERENCE']).filter(Boolean))];

  return `
    <div class="geo-legend-panel">
      <div class="legend-title">Source Summary</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#1e90ff"></span><span>${elements} parsed element(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#32cd32"></span><span>${nodes} resolved node(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#808080"></span><span>${summary.length} rendered component group(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff4500"></span><span>ACCDB data via accdb-to-pcf.js</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#8a2be2"></span><span>${csvRows.length} universal CSV row(s)</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e07020"></span><span>${pipeRefs.length ? `${pipeRefs.length} pipeline reference(s)` : 'No pipeline reference found'}</span></div>
    </div>

    <h4 class="sub-heading" style="margin-top:1rem">Component Types</h4>
    <div class="table-scroll" style="max-height:220px;">
      <table class="data-table" style="width:100%;">
        <thead><tr><th>Type</th><th style="width:80px">Count</th></tr></thead>
        <tbody>
          ${summary.length
            ? summary.map((row) => `<tr><td>${_esc(row.type)}</td><td class="mono">${row.count}</td></tr>`).join('')
            : '<tr><td colspan="2" class="center muted">No 3D components available</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _escAttr(s) {
  return _esc(s).replace(/"/g, '&quot;');
}
