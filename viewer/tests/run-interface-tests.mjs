import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [
  './unit/interchange/conversion-config.test.js',
  './unit/interchange/stp-support-parser.test.js',
  './unit/interchange/converter-worker-contract.test.js',
  './integration/interchange-config-ui.test.js',
  './integration/interchange-export-smoke.test.js',
  './integration/model-exchange-ui.test.js',
  './integration/export-roundtrip.test.js',
  './unit/rvm/rvm-bundle-manifest.test.js',
  './unit/rvm/rvm-identity-map.test.js',
  './unit/rvm/rvm-capabilities.test.js',
  './integration/rvm-tab-shell.test.js',
  './integration/rvm-load-pipeline.test.js',
  './unit/rvm/rvm-tag-xml.test.js',
  './unit/rvm/rvm-saved-views.test.js',
];

for (const rel of tests) {
  const abs = path.join(__dirname, rel);
  const importUrl = pathToFileURL(abs).href;
  const runnerScript = `
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.window = { localStorage: global.localStorage };
    if (!global.crypto) global.crypto = { randomUUID: () => Math.random().toString() };
    import(${JSON.stringify(importUrl)});
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', runnerScript],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('✅ interface test suite passed.');
