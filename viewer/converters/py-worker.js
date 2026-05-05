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
  'stagedjson_to_xml.py',
  'rev_to_stp.py',
  'xml_to_cii.py',
  'inputxml_to_cii.py',
  'pdf_to_inputxml.py',
  'pdf_to_inputxml_cii14.py',
  'pdf_to_inputxml_profiles.json',
  'pdf_inputxml_profile_bm_cii.xml',
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

function _toString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function _sanitizeFileName(name) {
  const normalized = _toString(name).trim();
  if (!normalized) return 'input.dat';
  return normalized.replace(/[\\/:*?"<>|]/g, '_');
}

function _decodeLogBatches(values) {
  return values
    .map((line) => _toString(line))
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function _extractFailureDetail(stderrLines) {
  if (!stderrLines.length) return '';
  const priorityPatterns = [/^usage:/i, /^error:/i, /^RuntimeError:/i, /^ValueError:/i, /^Exception:/i];
  for (let i = stderrLines.length - 1; i >= 0; i -= 1) {
    const line = String(stderrLines[i] || '').trim();
    if (!line) continue;
    for (const pattern of priorityPatterns) if (pattern.test(line)) return line;
  }
  return String(stderrLines[stderrLines.length - 1] || '').trim();
}

async function _getPyodide() {
  if (!_pyodidePromise) _pyodidePromise = loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  return _pyodidePromise;
}

async function _ensureScripts(pyodide) {
  if (_scriptsLoaded) return;
  pyodide.FS.mkdirTree('/scripts');
  pyodide.FS.mkdirTree('/work');
  for (const fileName of SCRIPT_FILE_NAMES) {
    const url = new URL(`./scripts/${fileName}`, import.meta.url);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load converter script ${fileName}: HTTP ${response.status}`);
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
  const invocation = buildInvocation(converterId, primaryPath, primary.name, secondaryPath, options, jobDir);

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
    output: { name: invocation.outputName, text: outputText, mime: 'text/plain;charset=utf-8' },
    logs: { stdout: stdoutLines, stderr: stderrLines, argv: invocation.argv.slice(1) },
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
