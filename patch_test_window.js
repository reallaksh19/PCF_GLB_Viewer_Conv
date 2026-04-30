const fs = require('fs');
const filepath = 'viewer/tests/integration/rvm-viewer-commands.test.js';
let content = fs.readFileSync(filepath, 'utf8');

const searchStr = `    global.window = { devicePixelRatio: 1 };`;
const replaceStr = `    global.window = {
        devicePixelRatio: 1,
        addEventListener: () => {},
        removeEventListener: () => {}
    };`;

content = content.replace(searchStr, replaceStr);
fs.writeFileSync(filepath, content, 'utf8');
console.log("Done");
