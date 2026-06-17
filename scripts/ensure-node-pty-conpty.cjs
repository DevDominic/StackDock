const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') process.exit(0);

const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const source = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', `win32-${arch}`, 'conpty', 'conpty.dll');
const targetDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release', 'conpty');
const target = path.join(targetDir, 'conpty.dll');

if (!fs.existsSync(source)) {
  console.error(`Missing node-pty conpty.dll source: ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied ${source} -> ${target}`);
