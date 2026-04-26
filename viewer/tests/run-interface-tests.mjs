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
  './integration/rvm-viewer-commands.test.js',
];

for (const rel of tests) {
  const abs = path.join(__dirname, rel);
  const importUrl = pathToFileURL(abs).href;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `import(${JSON.stringify(importUrl)});`],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('✅ interface test suite passed.');
