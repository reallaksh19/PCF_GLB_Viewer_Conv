import { createModelExchangeStore } from '../viewer/state/model-exchange-store.js';
import { importIntoModelExchange, updateViewState } from '../viewer/state/model-exchange-actions.js';
import { summarizeProjectFidelity } from '../viewer/validation/FidelityEvaluator.js';
import { validateCanonicalProject } from '../viewer/validation/CanonicalValidator.js';
import { validateSupports } from '../viewer/validation/SupportValidator.js';
import { validateAnnotations } from '../viewer/validation/AnnotationValidator.js';

const store = createModelExchangeStore();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLeftPanel() {
  const source = store.sourcePreview;
  const canonical = store.canonicalPreview;
  return `
    <div class="model-exchange-panel model-exchange-left">
      <div class="model-exchange-section-title">Source Preview</div>
      ${source ? `
        <div><strong>${escapeHtml(source.name)}</strong></div>
        <div>Format: ${escapeHtml(source.format)}</div>
        <div>Dialect: ${escapeHtml(source.dialect)}</div>
        <div>Messages: ${source.messageCount}</div>
      ` : '<div>No source loaded.</div>'}
      <hr>
      <div class="model-exchange-section-title">Canonical Preview</div>
      ${canonical ? canonical.assemblies.map((asm) => `
        <div style="margin-bottom:8px; padding:8px; border:1px solid #243247; border-radius:8px;">
          <div><strong>${escapeHtml(asm.name)}</strong></div>
          <div>Nodes: ${asm.nodes}</div>
          <div>Segments: ${asm.segments}</div>
          <div>Supports: ${asm.supports}</div>
          <div>Annotations: ${asm.annotations}</div>
        </div>
      `).join('') : '<div>No canonical project.</div>'}
    </div>
  `;
}

function renderCenterPanel() {
  const rendered = store.renderedPreview;
  const fidelity = store.project ? summarizeProjectFidelity(store.project) : null;
  return `
    <div class="model-exchange-panel model-exchange-center">
      <div class="model-exchange-toolbar">
        <button class="model-exchange-button" data-action="preview-source">Source Preview</button>
        <button class="model-exchange-button" data-action="preview-canonical">Canonical Preview</button>
        <button class="model-exchange-button" data-action="preview-rendered">Rendered Preview</button>
        <select class="model-exchange-select" data-action="support-mode">
          <option value="SYMBOL">Support: Symbol</option>
          <option value="SIMPLIFIED_GEOMETRY">Support: Simplified Geometry</option>
          <option value="METADATA_ONLY">Support: Metadata Only</option>
        </select>
        <button class="model-exchange-button" data-action="toggle-verification">Verify 100%</button>
      </div>
      <div class="model-exchange-section-title">Rendered Preview (data-driven placeholder)</div>
      <div class="model-exchange-code">${escapeHtml(JSON.stringify({
        theme: store.viewState.theme,
        supportRenderMode: store.viewState.supportRenderMode,
        verificationMode: store.viewState.verificationMode,
        renderedSummary: rendered ? {
          assemblies: rendered.assemblies.length,
          nodes: rendered.nodes.length,
          segments: rendered.segments.length,
          supports: rendered.supportRenderItems.length,
          annotations: rendered.annotationRenderItems.length,
        } : null,
        fidelity,
      }, null, 2))}</div>
    </div>
  `;
}

function renderRightPanel() {
  const project = store.project;
  const issues = project ? [
    ...validateCanonicalProject(project),
    ...validateSupports(project),
    ...validateAnnotations(project),
  ] : [];
  return `
    <div class="model-exchange-panel model-exchange-right">
      <div class="model-exchange-section-title">Inspector</div>
      ${project ? `
        <div><strong>${escapeHtml(project.name)}</strong></div>
        <div>Assemblies: ${project.assemblies.length}</div>
        <div>Nodes: ${(project.nodes || []).length}</div>
        <div>Segments: ${(project.segments || []).length}</div>
        <div>Supports: ${(project.supports || []).length}</div>
        <div>Annotations: ${(project.annotations || []).length}</div>
      ` : '<div>No project loaded.</div>'}
      <hr>
      <div class="model-exchange-section-title">Validation</div>
      <div class="model-exchange-code">${escapeHtml(JSON.stringify(issues, null, 2))}</div>
    </div>
  `;
}

function renderBottomPanel() {
  const messages = [
    ...(store.sourceRecord?.messages || []),
    ...(store.project?.diagnostics?.messages || []),
  ];
  return `
    <div class="model-exchange-panel model-exchange-bottom">
      <div class="model-exchange-section-title">Diagnostics / Log</div>
      <div class="model-exchange-code">${escapeHtml(JSON.stringify(messages, null, 2))}</div>
    </div>
  `;
}

function renderRoot(container) {
  container.innerHTML = `
    <div class="model-exchange-root">
      ${renderLeftPanel()}
      ${renderCenterPanel()}
      ${renderRightPanel()}
      ${renderBottomPanel()}
    </div>
  `;

  container.querySelector('[data-action="toggle-verification"]')?.addEventListener('click', () => {
    updateViewState(store, { verificationMode: !store.viewState.verificationMode });
  });
  container.querySelector('[data-action="support-mode"]')?.addEventListener('change', (e) => {
    updateViewState(store, { supportRenderMode: e.target.value });
  });
}

export function createModelExchangeTab(container) {
  store.subscribe(() => renderRoot(container));
  renderRoot(container);
  return {
    async importSource(payload) {
      await importIntoModelExchange(store, payload);
    },
    getStore() {
      return store;
    },
  };
}
