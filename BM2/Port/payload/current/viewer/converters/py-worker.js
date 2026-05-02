import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs';
import {
  buildConverterWorkerResponse,
  validateConverterWorkerRequest,
} from './worker-contract.js';
import { buildInvocation } from './invocation-builder.js';

const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';

const SCRIPT_FILE_NAMES = Object.freeze([
  'rvm_to_rev.py',
  'rev_to_pcf.py',
  'rev_to_xml.py',
  'json_to_xml.py',
  'rev_to_stp.py',
  'xml_to_cii.py',
  'inputxml_to_cii.py',
  'rvm_attribute_to_xml.py',
  'rvm_attribute_to_xml_to_cii.py',
]);

const RUN_SNIPPET = `
import runpy
import sys
import traceback

exit_code = 0
sys.argv = list(job_argv)
try:
    runpy.run_path(job_script_path, run_name="__main__")
except SystemExit as exc:
    code = exc.code
    if code is None:
        exit_code = 0
    elif isinstance(code, int):
        exit_code = code
    else:
        print(code, file=sys.stderr)
        exit_code = 1
except Exception:
    traceback.print_exc()
    exit_code = 1

exit_code
`;

let _pyodidePromise = null;
let _scriptsLoaded = false;

function _toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return fallback;
}

function _toString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function _sanitizeFileName(name) {
  const normalized = _toString(name).trim();
  if (!normalized) return 'input.dat';
  return normalized.replace(/[\\/:*?"<>|]/g, '_');
}

function _baseNameWithoutExtension(name) {
  const cleaned = _sanitizeFileName(name);
  const idx = cleaned.lastIndexOf('.');
  if (idx <= 0) return cleaned;
  return cleaned.slice(0, idx);
}

function _outputName(primaryName, converterId, extension) {
  const stem = _baseNameWithoutExtension(primaryName);
  return `${stem}_${converterId}${extension}`;
}

function _pushOptionalStringArg(argv, flag, value) {
  const text = _toString(value).trim();
  if (!text) return;
  // Use --flag=value so values starting with "-" are parsed as data, not option flags.
  argv.push(`${flag}=${text}`);
}

function _pushOptionalNumberArg(argv, flag, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  argv.push(flag, String(numeric));
}

function _converterSpec(converterId) {
  if (converterId === 'rvm_to_rev') return { script: 'rvm_to_rev.py', extension: '.rev' };
  if (converterId === 'rev_to_pcf') return { script: 'rev_to_pcf.py', extension: '.pcf' };
  if (converterId === 'rev_to_xml') return { script: 'rev_to_xml.py', extension: '.xml' };
  if (converterId === 'json_to_xml') return { script: 'json_to_xml.py', extension: '.xml' };
  if (converterId === 'rev_to_stp') return { script: 'rev_to_stp.py', extension: '.stp' };
  if (converterId === 'xml_to_cii') return { script: 'xml_to_cii.py', extension: '.cii' };
  if (converterId === 'inputxml_to_cii') return { script: 'inputxml_to_cii.py', extension: '.cii' };
  throw new Error(`Unsupported converter "${converterId}".`);
}

function _buildInvocation(converterId, primaryPath, primaryName, secondaryPath, options, jobDir) {
  const spec = _converterSpec(converterId);
  const scriptPath = `/scripts/${spec.script}`;
  const outputName = _outputName(primaryName, converterId, spec.extension);
  const outputPath = `${jobDir}/${outputName}`;
  const argv = [scriptPath, '--input', primaryPath, '--output', outputPath];

  if (converterId === 'rvm_to_rev') {
    if (secondaryPath) argv.push('--attributes', secondaryPath);
  } else if (converterId === 'rev_to_pcf') {
    argv.push('--coord-factor', String(_toFiniteNumber(options?.coordFactor, 1000)));
    _pushOptionalStringArg(argv, '--pipeline-reference', options?.pipelineReference);
    _pushOptionalStringArg(argv, '--project-identifier', options?.projectIdentifier);
    _pushOptionalStringArg(argv, '--exclude-group-tokens', options?.excludeGroupTokens);
    _pushOptionalNumberArg(argv, '--topology-merge-tolerance', options?.topologyMergeTolerance);
  } else if (converterId === 'rev_to_xml') {
    argv.push('--coord-factor', String(_toFiniteNumber(options?.coordFactor, 1000)));
    _pushOptionalNumberArg(argv, '--node-start', options?.nodeStart);
    _pushOptionalNumberArg(argv, '--node-step', options?.nodeStep);
    _pushOptionalNumberArg(argv, '--node-merge-tolerance', options?.nodeMergeTolerance);
    _pushOptionalStringArg(argv, '--source', options?.source);
    _pushOptionalStringArg(argv, '--purpose', options?.purpose);
    _pushOptionalStringArg(argv, '--title-line', options?.titleLine);
    if (options?.enablePsiRigidLogic) argv.push('--enable-psi-rigid-logic');
  } else if (converterId === 'rev_to_stp') {
    argv.push('--coord-factor', String(_toFiniteNumber(options?.coordFactor, 1000)));
    _pushOptionalStringArg(argv, '--support-path-contains', options?.supportPathContains);
    _pushOptionalStringArg(argv, '--schema-name', options?.schemaName);
    if (options?.includeGenericSupportGroups) argv.push('--include-generic-support-groups');
  } else if (converterId === 'xml_to_cii') {
    const mode = _toString(options?.coordsMode).trim().toLowerCase();
    argv.push('--coords-mode', mode === 'all' || mode === 'none' ? mode : 'first');
  } else if (converterId === 'inputxml_to_cii') {
    if (secondaryPath) argv.push('--reference-cii', secondaryPath);
    if (options?.inferReducerAngleFromGeometry) argv.push('--infer-reducer-angle-from-geometry');
    _pushOptionalNumberArg(argv, '--default-diameter', options?.defaultDiameter);
    _pushOptionalNumberArg(argv, '--default-wall-thickness', options?.defaultWallThickness);
    _pushOptionalNumberArg(argv, '--default-insulation-thickness', options?.defaultInsulationThickness);
    _pushOptionalNumberArg(argv, '--default-corrosion-allowance', options?.defaultCorrosionAllowance);
    _pushOptionalNumberArg(argv, '--default-temperature1', options?.defaultTemperature1);
    _pushOptionalNumberArg(argv, '--default-temperature2', options?.defaultTemperature2);
    _pushOptionalNumberArg(argv, '--default-temperature3', options?.defaultTemperature3);
    _pushOptionalNumberArg(argv, '--default-reducer-angle', options?.defaultReducerAngle);
  }

  return { scriptPath, outputPath, outputName, argv };
}

async function _getPyodide() {
  if (!_pyodidePromise) {
    _pyodidePromise = loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  }
  return _pyodidePromise;
}

async function _ensureScripts(pyodide) {
  if (_scriptsLoaded) return;
  pyodide.FS.mkdirTree('/scripts');
  pyodide.FS.mkdirTree('/work');
  for (const fileName of SCRIPT_FILE_NAMES) {
    const url = new URL(`./scripts/${fileName}`, import.meta.url);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load converter script ${fileName}: HTTP ${response.status}`);
    }
    const text = await response.text();
    pyodide.FS.writeFile(`/scripts/${fileName}`, text, { encoding: 'utf8' });
  }
  pyodide.runPython(`
import sys
if "/scripts" not in sys.path:
    sys.path.insert(0, "/scripts")
`);
  _scriptsLoaded = true;
}

function _writeInputFile(pyodide, jobDir, fileSpec) {
  const fileName = _sanitizeFileName(fileSpec?.name);
  const path = `${jobDir}/${fileName}`;
  const bytes = new Uint8Array(fileSpec?.bytes || new ArrayBuffer(0));
  pyodide.FS.writeFile(path, bytes);
  return path;
}

function _decodeLogBatches(values) {
  return values
    .map((line) => _toString(line))
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function _extractFailureDetail(stderrLines) {
  if (!stderrLines.length) return '';
  const priorityPatterns = [
    /^usage:/i,
    /^error:/i,
    /^RuntimeError:/i,
    /^ValueError:/i,
    /^Exception:/i,
  ];

  for (let i = stderrLines.length - 1; i >= 0; i -= 1) {
    const line = String(stderrLines[i] || '').trim();
    if (!line) continue;
    for (const pattern of priorityPatterns) {
      if (pattern.test(line)) return line;
    }
  }

  for (let i = stderrLines.length - 1; i >= 0; i -= 1) {
    const line = String(stderrLines[i] || '').trim();
    if (!line) continue;
    if (line.includes('in-browser') || line.includes('rvmparser-windows-bin.exe')) return line;
  }

  return String(stderrLines[stderrLines.length - 1] || '').trim();
}

async function _runJob(message) {
  const converterId = _toString(message?.converterId);
  if (!converterId) throw new Error('Missing converterId.');

  const primary = (message?.inputFiles || []).find((f) => f?.role === 'primary');
  if (!primary) throw new Error('Primary input file is required.');

  const secondary = (message?.inputFiles || []).find((f) => f?.role === 'secondary');
  const options = message?.options || {};

  const pyodide = await _getPyodide();
  await _ensureScripts(pyodide);

  const stdout = [];
  const stderr = [];
  pyodide.setStdout({ batched: (text) => stdout.push(text) });
  pyodide.setStderr({ batched: (text) => stderr.push(text) });

  const jobDir = `/work/job_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  pyodide.FS.mkdirTree(jobDir);

  const primaryPath = _writeInputFile(pyodide, jobDir, primary);
  const secondaryPath = secondary ? _writeInputFile(pyodide, jobDir, secondary) : null;
  const invocation = buildInvocation(
    converterId,
    primaryPath,
    primary.name,
    secondaryPath,
    options,
    jobDir,
  );

  pyodide.globals.set('job_script_path', invocation.scriptPath);
  pyodide.globals.set('job_argv', invocation.argv);
  const exitCode = await pyodide.runPythonAsync(RUN_SNIPPET);
  const stdoutLines = _decodeLogBatches(stdout);
  const stderrLines = _decodeLogBatches(stderr);
  if (Number(exitCode) !== 0) {
    const detail = _extractFailureDetail(stderrLines);
    throw new Error(detail ? `Converter exited with code ${exitCode}: ${detail}` : `Converter exited with code ${exitCode}.`);
  }

  const outputText = pyodide.FS.readFile(invocation.outputPath, { encoding: 'utf8' });
  return {
    output: {
      name: invocation.outputName,
      text: outputText,
      mime: 'text/plain;charset=utf-8',
    },
    logs: {
      stdout: stdoutLines,
      stderr: stderrLines,
      argv: invocation.argv.slice(1),
    },
  };
}

self.addEventListener('message', async (event) => {
  const message = event.data || {};
  if (message.type !== 'run') return;
  const jobId = message.jobId;
  const validation = validateConverterWorkerRequest(message);
  if (!validation.ok) {
    self.postMessage(buildConverterWorkerResponse(jobId, false, null, null, validation.error));
    return;
  }
  try {
    const result = await _runJob(message);
    self.postMessage(buildConverterWorkerResponse(jobId, true, [result.output], result.logs, null));
  } catch (error) {
    self.postMessage(buildConverterWorkerResponse(jobId, false, null, null, _toString(error?.message || error)));
  }
});

