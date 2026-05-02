const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 3001;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const NATIVE_RVM_API_PATH = '/api/native/rvm-to-rev';

function sanitizeFileName(name, fallback) {
    const raw = String(name || '').trim();
    const safe = raw.replace(/[\\/:*?"<>|]+/g, '_');
    return safe || fallback;
}

function splitLines(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
}

function writeJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(body);
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error('Request body too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                const parsed = text ? JSON.parse(text) : {};
                resolve(parsed);
            } catch (error) {
                reject(new Error(`Invalid JSON body: ${error.message}`));
            }
        });
        req.on('error', (error) => reject(error));
    });
}

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

function detectRvmParserBinary() {
    const candidates = [
        path.join(__dirname, '..', 'rvmparser', 'rvmparser-windows-bin.exe'),
        path.join(__dirname, 'rvmparser-windows-bin.exe'),
        'C:\\Code3\\rvmparser\\rvmparser-windows-bin.exe',
        path.join(__dirname, 'viewer', 'converters', 'bin', 'rvmparser-windows-bin.exe'),
    ];
    for (const candidate of candidates) {
        if (fileExists(candidate)) return candidate;
    }
    return null;
}

function runProcess(executable, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(executable, args, { cwd, windowsHide: true });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString('utf8');
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString('utf8');
        });
        child.on('error', (error) => {
            resolve({ code: -1, stdout, stderr, error });
        });
        child.on('close', (code) => {
            resolve({ code: Number(code || 0), stdout, stderr, error: null });
        });
    });
}

function safeCleanup(dirPath) {
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors.
    }
}

async function handleNativeRvmToRev(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'no-store',
        });
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
        return;
    }

    const parserExe = detectRvmParserBinary();
    if (!parserExe) {
        writeJson(res, 500, {
            ok: false,
            error: 'Native rvmparser-windows-bin.exe not found. Install it at C:\\Code3\\rvmparser or next to the server script.',
        });
        return;
    }

    let body;
    try {
        body = await parseJsonBody(req);
    } catch (error) {
        writeJson(res, 400, { ok: false, error: error.message });
        return;
    }

    const inputName = sanitizeFileName(body?.inputName, 'input.rvm');
    const inputBase64 = String(body?.inputBase64 || '');
    if (!inputBase64) {
        writeJson(res, 400, { ok: false, error: 'inputBase64 is required.' });
        return;
    }
    if (!String(inputName).toLowerCase().endsWith('.rvm') && !String(inputName).toLowerCase().endsWith('.rev')) {
        writeJson(res, 400, {
            ok: false,
            error: `Unsupported input "${inputName}". Native bridge accepts .rvm or .rev for this endpoint.`,
        });
        return;
    }

    const attributesName = sanitizeFileName(body?.attributesName, 'attributes.att');
    const attributesBase64 = String(body?.attributesBase64 || '');

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfglb-rvm-'));
    try {
        const inputPath = path.join(tempRoot, inputName);
        fs.writeFileSync(inputPath, Buffer.from(inputBase64, 'base64'));

        let attributesPath = null;
        if (attributesBase64) {
            attributesPath = path.join(tempRoot, attributesName);
            fs.writeFileSync(attributesPath, Buffer.from(attributesBase64, 'base64'));
        }

        const stem = path.parse(inputName).name || 'output';

        let args = [];
        let execution;
        const requestedMode = String(body?.mode || 'rvm_to_rev').trim();
        const isGltfMode = requestedMode === 'rvm_to_glb';
        const isJsonMode = requestedMode === 'rvm_to_json';

        const outputRevName = `${stem}_rvm_to_rev.rev`;
        const outputRevPath = path.join(tempRoot, outputRevName);

        const outputJsonName = `${stem}_rvm_to_json.json`;
        const outputGlbName = `${stem}.glb`;
        const outputGlbPath = path.join(tempRoot, outputGlbName);
        const outputJsonPath = path.join(tempRoot, `${stem}.json`);

        if (isGltfMode) {
            args = [
                `--output-gltf=${outputGlbPath}`,
                `--output-json=${outputJsonPath}`,
                '--output-gltf-attributes=true',
                '--output-gltf-center=true',
                '--output-gltf-rotate-z-to-y=true',
                inputPath
            ];
            if (attributesPath) args.push(attributesPath);
            execution = await runProcess(parserExe, args, tempRoot);

            // Post-process JSON to generate RvmIndex format if successful
            if (execution.code === 0 && fileExists(outputJsonPath)) {
                try {
                     const rawJson = JSON.parse(fs.readFileSync(outputJsonPath, 'utf8'));
                     // Very naive gen-rvm-index emulation inline for the API
                     const rvmIndex = {
                         schemaVersion: 'rvm-index/v1',
                         bundleId: `converted-${Date.now()}`,
                         units: 'mm',
                         upAxis: 'Y',
                         nodes: []
                     };

                     // Convert raw parser output nodes to RvmIndex nodes
                     if (Array.isArray(rawJson)) {
                         rawJson.forEach((n, i) => {
                             rvmIndex.nodes.push({
                                 sourceObjectId: n.name || `OBJ:${i}`,
                                 canonicalObjectId: n.name || `OBJ:${i}`,
                                 renderObjectIds: [n.name || `OBJ:${i}`],
                                 parentCanonicalObjectId: null,
                                 name: n.name || `Node ${i}`,
                                 path: n.name || `Node ${i}`,
                                 kind: 'UNKNOWN',
                                 attributes: n.attributes || {}
                             });
                         });
                     }

                     fs.writeFileSync(outputJsonPath, JSON.stringify(rvmIndex));
                } catch(e) {
                     // ignore if json post-process fails, just send raw
                     console.error("Index processing error", e);
                }
            }
        } else if (isJsonMode) {
            args = [`--output-json=${outputJsonPath}`, inputPath];
            if (attributesPath) args.push(attributesPath);
            execution = await runProcess(parserExe, args, tempRoot);
        } else {
            args = [`--output-rev=${outputRevPath}`, inputPath];
            if (attributesPath) args.push(attributesPath);
            execution = await runProcess(parserExe, args, tempRoot);
        }

        const parseFailureRegex = /More END-tags and than NEW-tags|Failed to parse/i;
        if (
            execution.code !== 0 &&
            attributesPath &&
            parseFailureRegex.test(String(execution.stderr || ''))
        ) {
            const retryArgs = isGltfMode
                ? [
                    `--output-gltf=${outputGlbPath}`,
                    `--output-json=${outputJsonPath}`,
                    '--output-gltf-attributes=true',
                    '--output-gltf-center=true',
                    '--output-gltf-rotate-z-to-y=true',
                    inputPath,
                ]
                : isJsonMode
                    ? [`--output-json=${outputJsonPath}`, inputPath]
                    : [`--output-rev=${outputRevPath}`, inputPath];
            const retryExecution = await runProcess(parserExe, retryArgs, tempRoot);
            if (retryExecution.code === 0) {
                retryExecution.stderr = `Recovered from sidecar parse failure by retrying without sidecar.\n${retryExecution.stderr || ''}`;
                execution = retryExecution;
                args = retryArgs;
            }
        }

        const stdoutLines = splitLines(execution.stdout);
        const stderrLines = splitLines(execution.stderr);

        if (execution.error) {
            writeJson(res, 500, {
                ok: false,
                error: `Failed to spawn native converter: ${execution.error.message}`,
                logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
            });
            return;
        }

        if (execution.code !== 0) {
            writeJson(res, 500, {
                ok: false,
                error: `Native converter exited with code ${execution.code}.`,
                logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
            });
            return;
        }

        if (isGltfMode) {
             if (!fileExists(outputGlbPath) || !fileExists(outputJsonPath)) {
                writeJson(res, 500, {
                    ok: false,
                    error: 'Native converter did not produce GLB or JSON file.',
                    logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
                });
                return;
             }

             const glbBuffer = fs.readFileSync(outputGlbPath);
             const indexJsonText = fs.readFileSync(outputJsonPath, 'utf8');

             writeJson(res, 200, {
                 ok: true,
                 glbBase64: glbBuffer.toString('base64'),
                 indexJson: JSON.parse(indexJsonText),
                 logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe }
             });

        } else if (isJsonMode) {
            if (!fileExists(outputJsonPath)) {
                writeJson(res, 500, {
                    ok: false,
                    error: 'Native converter did not produce output JSON file.',
                    logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
                });
                return;
            }

            const outputText = fs.readFileSync(outputJsonPath, 'utf8');
            writeJson(res, 200, {
                ok: true,
                outputName: outputJsonName,
                outputText,
                logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
            });
        } else {
            if (!fileExists(outputRevPath)) {
                writeJson(res, 500, {
                    ok: false,
                    error: 'Native converter did not produce output REV file.',
                    logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
                });
                return;
            }

            const outputText = fs.readFileSync(outputRevPath, 'utf8');
            writeJson(res, 200, {
                ok: true,
                outputName: outputRevName,
                outputText,
                logs: { stdout: stdoutLines, stderr: stderrLines, argv: args, binary: parserExe },
            });
        }
    } catch (error) {
        writeJson(res, 500, { ok: false, error: error.message });
    } finally {
        safeCleanup(tempRoot);
    }
}

function resolveRequestPath(urlPath) {
    const cleanPath = String(urlPath || '/').split('?')[0];
    if (cleanPath === '/' || cleanPath === '') {
        return path.join(__dirname, 'viewer', 'index.html');
    }

    let direct = path.join(__dirname, cleanPath);
    if (fileExists(direct)) {
        if (fs.statSync(direct).isDirectory()) {
            direct = path.join(direct, 'index.html');
        }
        if (fileExists(direct)) return direct;
    }

    let inViewer = path.join(__dirname, 'viewer', cleanPath.replace(/^[/\\]+/, ''));
    if (fileExists(inViewer)) {
        if (fs.statSync(inViewer).isDirectory()) {
            inViewer = path.join(inViewer, 'index.html');
        }
        if (fileExists(inViewer)) return inViewer;
    }

    return null;
}

http.createServer(async (req, res) => {
    const cleanPath = String(req.url || '/').split('?')[0];
    if (cleanPath === NATIVE_RVM_API_PATH) {
        await handleNativeRvmToRev(req, res);
        return;
    }

    const filePath = resolveRequestPath(req.url);
    if (!filePath) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        else if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(data);
    });
}).listen(PORT);

console.log(`Server running at http://localhost:${PORT}/`);
