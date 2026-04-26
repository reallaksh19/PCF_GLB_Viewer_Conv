import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';
import { notify } from '../diagnostics/notification-center.js';
import {
  buildConverterWorkerRequest,
  validateConverterWorkerResponse,
} from '../converters/worker-contract.js';

const STORAGE_KEY = 'model-converters.defaults.v1';
const NATIVE_RVM_ENDPOINT_CANDIDATES = Object.freeze([
  '/api/native/rvm-to-rev',
  'http://127.0.0.1:3000/api/native/rvm-to-rev',
  'http://127.0.0.1:3001/api/native/rvm-to-rev',
  'http://127.0.0.1:3200/api/native/rvm-to-rev',
]);

const CONVERTER_DEFS = Object.freeze({
  rvm_to_rev: {
    id: 'rvm_to_rev',
    label: 'RVM -> REV',
    primaryAccept: '.rvm,.RVM,.rev,.REV,.txt,.TXT',
    primaryLabel: 'RVM Input',
    secondaryLabel: 'ATT/TXT Attribute File (optional)',
    secondaryAccept: '.att,.ATT,.txt,.TXT',
    description: 'Convert RVM source to REV text.',
    defaults: {},
    fields: [],
  },
  rev_to_pcf: {
    id: 'rev_to_pcf',
    label: 'REV -> PCF',
    primaryAccept: '.rev,.REV,.txt,.TXT',
    primaryLabel: 'REV Input',
    secondaryLabel: '',
    secondaryAccept: '',
    description: 'Convert REV text export to PCF.',
    defaults: {
      coordFactor: 1000,
      topologyMergeTolerance: 0.5,
      pipelineReference: '',
      projectIdentifier: '',
      excludeGroupTokens: '-PIPESUPP',
    },
    fields: [
      { key: 'coordFactor', label: 'Coord Factor', type: 'number', step: '0.01' },
      { key: 'topologyMergeTolerance', label: 'Topology Merge Tol.', type: 'number', step: '0.01' },
      { key: 'pipelineReference', label: 'Pipeline Reference', type: 'text' },
      { key: 'projectIdentifier', label: 'Project Identifier', type: 'text' },
      {
        key: 'excludeGroupTokens',
        label: 'Exclude Group Tokens (comma-separated)',
        type: 'text',
      },
    ],
  },
  rev_to_xml: {
    id: 'rev_to_xml',
    label: 'REV -> XML',
    primaryAccept: '.rev,.REV,.txt,.TXT',
    primaryLabel: 'REV Input',
    secondaryLabel: '',
    secondaryAccept: '',
    description: 'Convert REV text export to PSI116-style XML.',
    defaults: {
      coordFactor: 1000,
      nodeStart: 10,
      nodeStep: 10,
      nodeMergeTolerance: 0.5,
      source: 'AVEVA PSI',
      purpose: 'Preliminary stress run',
      titleLine: 'PSI stress Output',
      enablePsiRigidLogic: false,
    },
    fields: [
      { key: 'coordFactor', label: 'Coord Factor', type: 'number', step: '0.01' },
      { key: 'nodeStart', label: 'Node Start', type: 'number', step: '1' },
      { key: 'nodeStep', label: 'Node Step', type: 'number', step: '1' },
      { key: 'nodeMergeTolerance', label: 'Node Merge Tol.', type: 'number', step: '0.01' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'purpose', label: 'Purpose', type: 'text' },
      { key: 'titleLine', label: 'Title Line', type: 'text' },
      { key: 'enablePsiRigidLogic', label: 'Enable PSI Rigid Logic', type: 'checkbox' },
    ],
  },
  rev_to_stp: {
    id: 'rev_to_stp',
    label: 'REV -> STP',
    primaryAccept: '.rev,.REV,.txt,.TXT',
    primaryLabel: 'REV Input',
    secondaryLabel: '',
    secondaryAccept: '',
    description: 'Convert REV support blocks to STEP member polylines.',
    defaults: {
      coordFactor: 1000,
      supportPathContains: 'RRIMS-PIPESUPP',
      includeGenericSupportGroups: false,
      schemaName: 'CIS2',
    },
    fields: [
      { key: 'coordFactor', label: 'Coord Factor', type: 'number', step: '0.01' },
      { key: 'supportPathContains', label: 'Support Path Token', type: 'text' },
      { key: 'schemaName', label: 'STEP Schema Name', type: 'text' },
      { key: 'includeGenericSupportGroups', label: 'Include Generic Support Groups', type: 'checkbox' },
    ],
  },
  xml_to_cii: {
    id: 'xml_to_cii',
    label: 'XML -> CII',
    primaryAccept: '.xml,.XML',
    primaryLabel: 'XML Input',
    secondaryLabel: '',
    secondaryAccept: '',
    description: 'Convert PSI116-style XML to CII.',
    defaults: {
      coordsMode: 'first',
    },
    fields: [
      { key: 'coordsMode', label: 'Coords Mode', type: 'select', options: ['first', 'all', 'none'] },
    ],
  },
  inputxml_to_cii: {
    id: 'inputxml_to_cii',
    label: 'InputXML -> CII',
    primaryAccept: '.xml,.XML',
    primaryLabel: 'Input XML',
    secondaryLabel: 'Reference CII (optional)',
    secondaryAccept: '.cii,.CII',
    description: 'Convert CAESARII Input XML to CII.',
    defaults: {
      inferReducerAngleFromGeometry: false,
      defaultDiameter: 0,
      defaultWallThickness: 0.01,
      defaultInsulationThickness: 0,
      defaultCorrosionAllowance: 0,
      defaultTemperature1: 0,
      defaultTemperature2: 0,
      defaultTemperature3: 0,
      defaultReducerAngle: 0,
    },
    fields: [
      { key: 'inferReducerAngleFromGeometry', label: 'Infer Reducer Angle From Geometry', type: 'checkbox' },
      { key: 'defaultDiameter', label: 'Default Diameter', type: 'number', step: '0.001' },
      { key: 'defaultWallThickness', label: 'Default Wall Thickness', type: 'number', step: '0.001' },
      { key: 'defaultInsulationThickness', label: 'Default Insulation Thickness', type: 'number', step: '0.001' },
      { key: 'defaultCorrosionAllowance', label: 'Default Corrosion Allowance', type: 'number', step: '0.001' },
      { key: 'defaultTemperature1', label: 'Default Temperature1', type: 'number', step: '0.01' },
      { key: 'defaultTemperature2', label: 'Default Temperature2', type: 'number', step: '0.01' },
      { key: 'defaultTemperature3', label: 'Default Temperature3', type: 'number', step: '0.01' },
      { key: 'defaultReducerAngle', label: 'Default Reducer Angle', type: 'number', step: '0.01' },
    ],
  },
});

function _clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function _toText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function _esc(value) {
  return _toText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function _createWorkerRuntime() {
  const worker = new Worker(new URL('../converters/py-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextJobId = 1;

  const onMessage = (event) => {
    const payload = event.data || {};
    const pendingJob = pending.get(payload.jobId);
    if (!pendingJob) return;
    pending.delete(payload.jobId);
    const validation = validateConverterWorkerResponse(payload);
    if (!validation.ok) {
      pendingJob.reject(new Error(validation.error));
      return;
    }
    if (payload.ok) pendingJob.resolve(payload);
    else pendingJob.reject(new Error(_toText(payload.error || 'Converter worker failed.')));
  };

  const onError = (event) => {
    for (const pendingJob of pending.values()) {
      pendingJob.reject(new Error(_toText(event?.message || 'Converter worker crashed.')));
    }
    pending.clear();
  };

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);

  function runJob(request) {
    const jobId = nextJobId;
    nextJobId += 1;
    const transfer = [];
    for (const fileSpec of request.inputFiles || []) {
      if (fileSpec?.bytes instanceof ArrayBuffer) transfer.push(fileSpec.bytes);
    }
    const payload = { type: 'run', jobId, ...request };
    return new Promise((resolve, reject) => {
      pending.set(jobId, { resolve, reject });
      worker.postMessage(
        buildConverterWorkerRequest(jobId, payload.converterId, payload.inputFiles, payload.options),
        transfer,
      );
    });
  }

  function dispose() {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.terminate();
    pending.clear();
  }

  return { runJob, dispose };
}

function _loadStoredState() {
  const defaultsByConverter = {};
  for (const def of Object.values(CONVERTER_DEFS)) {
    defaultsByConverter[def.id] = _clone(def.defaults);
  }

  let selectedConverter = 'rev_to_pcf';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { selectedConverter, defaultsByConverter };
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (CONVERTER_DEFS[parsed.selectedConverter]) selectedConverter = parsed.selectedConverter;
      const source = parsed.defaultsByConverter || {};
      for (const [converterId, sourceValues] of Object.entries(source)) {
        if (!CONVERTER_DEFS[converterId] || !sourceValues || typeof sourceValues !== 'object') continue;
        defaultsByConverter[converterId] = {
          ...defaultsByConverter[converterId],
          ...sourceValues,
        };
      }
    }
  } catch {
    // Keep defaults.
  }

  return { selectedConverter, defaultsByConverter };
}

function _saveStoredState(selectedConverter, defaultsByConverter) {
  const payload = JSON.stringify({ selectedConverter, defaultsByConverter });
  window.localStorage.setItem(STORAGE_KEY, payload);
}

function _readOptionValue(field, input) {
  if (field.type === 'checkbox') return !!input.checked;
  if (field.type === 'number') {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : 0;
  }
  return input.value;
}

function _buildAdvancedFieldsHtml(def, values) {
  return def.fields.map((field) => {
    const key = field.key;
    const value = values[key];
    if (field.type === 'checkbox') {
      return `
        <label class="model-converters-checkbox">
          <input type="checkbox" data-option-key="${key}" ${value ? 'checked' : ''}>
          <span>${_esc(field.label)}</span>
        </label>
      `;
    }
    if (field.type === 'select') {
      return `
        <label class="model-converters-label">
          <span>${_esc(field.label)}</span>
          <select data-option-key="${key}">
            ${(field.options || []).map((option) => `
              <option value="${_esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${_esc(option)}</option>
            `).join('')}
          </select>
        </label>
      `;
    }
    const inputType = field.type === 'number' ? 'number' : 'text';
    const stepAttr = field.step ? `step="${_esc(field.step)}"` : '';
    return `
      <label class="model-converters-label">
        <span>${_esc(field.label)}</span>
        <input type="${inputType}" ${stepAttr} data-option-key="${key}" value="${_esc(value)}">
      </label>
    `;
  }).join('');
}

function _downloadOutput(output) {
  const blob = new Blob([output.text], { type: output.mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = output.name || 'conversion-output.txt';
  anchor.click();
  URL.revokeObjectURL(url);
}

function _arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function _tryNativeRvmToRev(primaryFile, primaryBytes, secondaryFile, secondaryBytes) {
  const requestBody = {
    inputName: primaryFile.name,
    inputBase64: _arrayBufferToBase64(primaryBytes),
  };
  if (secondaryFile && secondaryBytes) {
    requestBody.attributesName = secondaryFile.name;
    requestBody.attributesBase64 = _arrayBufferToBase64(secondaryBytes);
  }

  let lastDetailedError = '';
  for (const endpoint of NATIVE_RVM_ENDPOINT_CANDIDATES) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch {
      continue;
    }

    if (response.status === 404 || response.status === 405) {
      continue;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = _toText(payload?.error || `${response.status} ${response.statusText}`);
      lastDetailedError = `Native RVM bridge failed (${endpoint}): ${detail}`;
      continue;
    }

    if (!payload?.ok || typeof payload.outputText !== 'string') {
      lastDetailedError = `Native RVM bridge returned invalid payload (${endpoint}).`;
      continue;
    }

    return {
      outputs: [{
        name: _toText(payload.outputName || `${primaryFile.name.replace(/\.[^.]+$/, '')}_rvm_to_rev.rev`),
        text: payload.outputText,
        mime: 'text/plain;charset=utf-8',
      }],
      logs: {
        stdout: Array.isArray(payload.logs?.stdout) ? payload.logs.stdout : [],
        stderr: Array.isArray(payload.logs?.stderr) ? payload.logs.stderr : [],
        argv: Array.isArray(payload.logs?.argv) ? payload.logs.argv : [],
      },
      nativeBridge: true,
      endpoint: endpoint,
    };
  }

  if (lastDetailedError) {
    throw new Error(lastDetailedError);
  }
  return null;
}

export function renderModelConvertersTab(container) {
  const { selectedConverter: initialConverter, defaultsByConverter } = _loadStoredState();
  let selectedConverter = initialConverter;
  let primaryFile = null;
  let secondaryFile = null;
  let runtime = null;
  let disposed = false;

  container.innerHTML = `
    <div class="model-converters-root">
      <aside class="model-converters-left">
        <h2>3D Model Converters</h2>
        <p class="model-converters-subtitle">GitHub Pages-safe in-browser conversion runtime (Pyodide worker).</p>

        <label class="model-converters-label">
          <span>Converter</span>
          <select id="model-converters-select">
            ${Object.values(CONVERTER_DEFS).map((def) => `
              <option value="${def.id}" ${def.id === selectedConverter ? 'selected' : ''}>${_esc(def.label)}</option>
            `).join('')}
          </select>
        </label>

        <label class="model-converters-file">
          <span id="model-converters-primary-label"></span>
          <input type="file" id="model-converters-primary-input">
          <small id="model-converters-primary-name">No file selected.</small>
        </label>

        <label class="model-converters-file" id="model-converters-secondary-wrap" style="display:none">
          <span id="model-converters-secondary-label"></span>
          <input type="file" id="model-converters-secondary-input">
          <small id="model-converters-secondary-name">No file selected.</small>
        </label>

        <details class="model-converters-advanced">
          <summary>Advanced options</summary>
          <div id="model-converters-advanced-fields" class="model-converters-advanced-fields"></div>
        </details>

        <button id="model-converters-run" class="model-converters-run-btn">Run Conversion</button>
      </aside>

      <section class="model-converters-right">
        <div class="model-converters-card">
          <div class="model-converters-card-title">Status</div>
          <div id="model-converters-status" class="model-converters-status">Idle</div>
        </div>
        <div class="model-converters-card">
          <div class="model-converters-card-title">Output</div>
          <div id="model-converters-output"></div>
        </div>
        <div class="model-converters-card">
          <div class="model-converters-card-title">Logs</div>
          <pre id="model-converters-logs" class="model-converters-logs">(no logs)</pre>
        </div>
      </section>
    </div>
  `;

  const selectEl = container.querySelector('#model-converters-select');
  const primaryLabelEl = container.querySelector('#model-converters-primary-label');
  const primaryInputEl = container.querySelector('#model-converters-primary-input');
  const primaryNameEl = container.querySelector('#model-converters-primary-name');
  const secondaryWrapEl = container.querySelector('#model-converters-secondary-wrap');
  const secondaryLabelEl = container.querySelector('#model-converters-secondary-label');
  const secondaryInputEl = container.querySelector('#model-converters-secondary-input');
  const secondaryNameEl = container.querySelector('#model-converters-secondary-name');
  const advancedFieldsEl = container.querySelector('#model-converters-advanced-fields');
  const runBtnEl = container.querySelector('#model-converters-run');
  const statusEl = container.querySelector('#model-converters-status');
  const outputEl = container.querySelector('#model-converters-output');
  const logsEl = container.querySelector('#model-converters-logs');

  function activeDef() {
    return CONVERTER_DEFS[selectedConverter];
  }

  function activeValues() {
    if (!defaultsByConverter[selectedConverter]) {
      defaultsByConverter[selectedConverter] = _clone(activeDef().defaults);
    }
    return defaultsByConverter[selectedConverter];
  }

  function persist() {
    _saveStoredState(selectedConverter, defaultsByConverter);
  }

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.className = `model-converters-status ${tone || ''}`.trim();
  }

  function setLogs(lines) {
    const normalized = Array.isArray(lines) ? lines : [];
    logsEl.textContent = normalized.length ? normalized.join('\n') : '(no logs)';
  }

  function renderAdvanced() {
    const def = activeDef();
    const values = activeValues();
    advancedFieldsEl.innerHTML = _buildAdvancedFieldsHtml(def, values);
    for (const field of def.fields) {
      const input = advancedFieldsEl.querySelector(`[data-option-key="${field.key}"]`);
      if (!input) continue;
      const updateValue = () => {
        values[field.key] = _readOptionValue(field, input);
        persist();
      };
      input.addEventListener('input', updateValue);
      input.addEventListener('change', updateValue);
    }
  }

  function renderFileControls() {
    const def = activeDef();
    primaryLabelEl.textContent = `${def.primaryLabel} (${def.primaryAccept})`;
    primaryInputEl.setAttribute('accept', def.primaryAccept);
    primaryNameEl.textContent = primaryFile ? primaryFile.name : 'No file selected.';

    const showSecondary = !!def.secondaryLabel;
    secondaryWrapEl.style.display = showSecondary ? '' : 'none';
    if (showSecondary) {
      secondaryLabelEl.textContent = `${def.secondaryLabel} (${def.secondaryAccept})`;
      secondaryInputEl.setAttribute('accept', def.secondaryAccept);
      secondaryNameEl.textContent = secondaryFile ? secondaryFile.name : 'No file selected.';
    }
  }

  function renderDescription() {
    setStatus(activeDef().description, '');
  }

  function resetOutput() {
    outputEl.innerHTML = '<span class="model-converters-muted">No output generated yet.</span>';
    setLogs([]);
  }

  function renderAll() {
    renderFileControls();
    renderAdvanced();
    renderDescription();
  }

  async function ensureRuntime() {
    if (!runtime) runtime = _createWorkerRuntime();
    return runtime;
  }

  selectEl.addEventListener('change', () => {
    selectedConverter = selectEl.value;
    primaryFile = null;
    secondaryFile = null;
    persist();
    resetOutput();
    renderAll();
  });

  primaryInputEl.addEventListener('change', () => {
    primaryFile = primaryInputEl.files?.[0] || null;
    primaryNameEl.textContent = primaryFile ? primaryFile.name : 'No file selected.';
  });

  secondaryInputEl.addEventListener('change', () => {
    secondaryFile = secondaryInputEl.files?.[0] || null;
    secondaryNameEl.textContent = secondaryFile ? secondaryFile.name : 'No file selected.';
  });

  runBtnEl.addEventListener('click', async () => {
    if (!primaryFile) {
      notify({ level: 'warning', title: 'Converter', message: 'Select a primary input file first.' });
      return;
    }
    const def = activeDef();
    runBtnEl.disabled = true;
    setStatus('Running converter...', 'running');
    setLogs([]);
    outputEl.innerHTML = '<span class="model-converters-muted">Working...</span>';
    emit(RuntimeEvents.MODEL_CONVERTER_START, { converterId: selectedConverter, input: primaryFile.name });

    try {
      const primaryBytes = await primaryFile.arrayBuffer();
      const secondaryBytes = (def.secondaryLabel && secondaryFile) ? await secondaryFile.arrayBuffer() : null;
      const inputFiles = [
        { role: 'primary', name: primaryFile.name, bytes: primaryBytes },
      ];
      if (def.secondaryLabel && secondaryFile && secondaryBytes) {
        inputFiles.push({ role: 'secondary', name: secondaryFile.name, bytes: secondaryBytes });
      }

      let response = null;
      if (selectedConverter === 'rvm_to_rev') {
        response = await _tryNativeRvmToRev(primaryFile, primaryBytes, secondaryFile, secondaryBytes);
        if (!response) {
          throw new Error(
            'Native RVM bridge is not reachable. Start local server (node test_server.js) so /api/native/rvm-to-rev can run rvmparser-windows-bin.exe.',
          );
        }
      } else {
        response = await (await ensureRuntime()).runJob({
          converterId: selectedConverter,
          inputFiles,
          options: activeValues(),
        });
      }
      const output = response.outputs?.[0];
      if (!output) throw new Error('Converter returned no output payload.');

      outputEl.innerHTML = `
        <div class="model-converters-output-row">
          <strong>${_esc(output.name)}</strong>
          <button id="model-converters-download" class="model-converters-download-btn">Download</button>
        </div>
      `;
      outputEl.querySelector('#model-converters-download')?.addEventListener('click', () => _downloadOutput(output));

      const logLines = []
        .concat(response.logs?.stdout || [])
        .concat(response.logs?.stderr || []);
      setLogs(logLines);
      setStatus(`Completed: ${output.name}`, 'ok');
      notify({ level: 'success', title: 'Converter', message: `${def.label} completed.` });
      emit(RuntimeEvents.MODEL_CONVERTER_SUCCESS, { converterId: selectedConverter, output: output.name });
    } catch (error) {
      const message = _toText(error?.message || error);
      setStatus(`Failed: ${message}`, 'bad');
      outputEl.innerHTML = '<span class="model-converters-muted">No output generated.</span>';
      setLogs([message]);
      notify({ level: 'error', title: 'Converter', message });
      emit(RuntimeEvents.MODEL_CONVERTER_ERROR, { converterId: selectedConverter, error: message });
    } finally {
      if (!disposed) runBtnEl.disabled = false;
    }
  });

  resetOutput();
  renderAll();

  return () => {
    disposed = true;
    try { runtime?.dispose(); } catch {}
  };
}
