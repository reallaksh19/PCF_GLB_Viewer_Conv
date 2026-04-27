import { loadStickyState, state, setActiveTab } from './state.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';
import { renderViewer3D } from '../tabs/viewer3d-tab.js';
import { renderViewer3DRvm } from '../tabs/viewer3d-rvm-tab.js';
import { renderAdvancedGlbViewerPanel } from '../js/pcf2glb/ui/AdvancedGlbViewerPanel.js';
import { renderPcfxConverterTab } from '../tabs/pcfx-converter-tab.js';
import { renderModelExchangeTab } from '../tabs/model-exchange-tab.js';
import { renderInterchangeConfigTab } from '../tabs/interchange-config-tab.js';
import { renderModelConvertersTab } from '../tabs/model-converters-tab.js';
import { emit, on } from './event-bus.js';
import { initDevDebugWindow, destroyDevDebugWindow } from '../debug/dev-debug-window.js';
import { loadRvmSource } from '../rvm/RvmLoadPipeline.js';
import { RvmStaticBundleLoader } from '../rvm/RvmStaticBundleLoader.js';
import { RvmHelperBridge } from '../converters/rvm-helper-bridge.js';

const TAB_CONFIG_URL = './opt/tab-visibility.json';

const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const TABS = [
  { id: 'viewer3d', label: '3D Viewer', render: renderViewer3D },
  { id: 'viewer3d-rvm', label: '3D RVM Viewer', render: renderViewer3DRvm },
  ...(IS_DEV ? [{ id: 'adv-glb', label: 'Advanced GLB Viewer', render: renderAdvancedGlbViewerPanel }] : []),
  { id: 'pcfx-converter', label: 'PCF<->PCFX<->GLB', render: renderPcfxConverterTab },
  { id: 'model-exchange', label: 'Model Exchange', render: renderModelExchangeTab },
  { id: 'interchange-config', label: 'Interchange Config', render: renderInterchangeConfigTab },
  { id: 'model-converters', label: '3D Model Converters', render: renderModelConvertersTab },
];

let _activeDestroyFn = null;
let _visibleTabs = [...TABS];
let _switchHandlerBound = false;

export async function init() {
  loadStickyState();
  if (IS_DEV) {
    try { destroyDevDebugWindow(); } catch {}
  }
  _visibleTabs = await _loadVisibleTabs();
  _buildTabBar();
  _bindAppSwitchHandler();
  _bindGlobalEvents();
  if (IS_DEV) {
    initDevDebugWindow();
  }
  _switchTab(_resolveInitialTabId());
}

function _bindGlobalEvents() {
  on(RuntimeEvents.FILE_LOADED, async (payload) => {
    if (payload.source === 'rvm-tab') {
      try {
        // Fallback to local assisted mode configuration if capabilities are unpopulated or static
        let caps = state.rvm?.capabilities;
        if (!caps || !caps.rawRvmImport) {
             caps = { rawRvmImport: true, deploymentMode: 'assisted' };
        }

        const ctx = {
          capabilities: caps,
          staticBundleLoader: new RvmStaticBundleLoader(),
          assistedBridge: new RvmHelperBridge()
        };

        await loadRvmSource({ kind: 'raw-rvm', file: payload.payload }, ctx);
      } catch (err) {
        console.error('RVM Load Pipeline failed:', err);
      }
    }
  });
}

function _bindAppSwitchHandler() {
  if (_switchHandlerBound) return;
  window.addEventListener('app:switch-tab', (event) => {
    const nextId = event?.detail?.tabId;
    if (nextId) _switchTab(nextId);
  });
  _switchHandlerBound = true;
}

function _buildTabBar() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = _visibleTabs.map(t =>
    `<button class="tab-btn" data-tab="${t.id}">${t.label}</button>`
  ).join('');

  bar.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    _switchTab(btn.dataset.tab);
  });
}

function _switchTab(tabId) {
  const content = document.getElementById('tab-content');
  setActiveTab(tabId);
  emit(RuntimeEvents.TAB_CHANGED, { tabId });
  if (_activeDestroyFn) {
    try { _activeDestroyFn(); } catch (err) { console.error(err); }
    _activeDestroyFn = null;
  }
  content.innerHTML = '';
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  const tabDef = _visibleTabs.find(t => t.id === tabId);
  if (tabDef && tabDef.render) {
    const destroyFn = tabDef.render(content);
    if (typeof destroyFn === 'function') {
      _activeDestroyFn = destroyFn;
    }
  }
}

async function _loadVisibleTabs() {
  try {
    const response = await fetch(TAB_CONFIG_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    const visibleTabs = TABS.filter((tab) => _configFlagEnabled(config?.[tab.id]));
    return visibleTabs.length ? visibleTabs : [TABS[0]];
  } catch (error) {
    console.warn('[app] Tab visibility config unavailable, using built-in defaults.', error);
    return [...TABS];
  }
}

function _configFlagEnabled(value) {
  return value === undefined || value === 1 || value === true || value === '1' || value === 'true' || value === 'on';
}

function _resolveInitialTabId() {
  const requested = String(state.activeTab || 'viewer3d');
  const match = _visibleTabs.find((tab) => tab.id === requested);
  return match?.id || _visibleTabs[0]?.id || 'viewer3d';
}
