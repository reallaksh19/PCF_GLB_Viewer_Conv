import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runTests() {
  let passed = true;

  const uiContent = fs.readFileSync(path.join(__dirname, '../../tabs/model-exchange-tab.js'), 'utf8');

  if (uiContent.includes('alert(')) {
    console.error('Failed: Found alert() in model-exchange-tab.js');
    passed = false;
  }
  if (!uiContent.includes('notify({')) {
    console.error('Failed: No notify() usage found in model-exchange-tab.js');
    passed = false;
  }

  const outDir = path.join(__dirname, '../../../artifacts/A6/pass');
  if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
  }

  if (passed) {
      console.log('\u2705 A6 UI Surface integration tests passed.');
      fs.writeFileSync(path.join(outDir, 'e2e.txt'), '✅ A6 UI Surface integration tests passed.');
  } else {
      process.exit(1);
  }
}

runTests();
