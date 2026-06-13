const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const inputs = ['src', 'electron', 'extensions', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'electron/tsconfig.json'];
const outputs = ['dist', 'dist-electron'];
const stampFile = '.buildstamp';
const skipArgs = new Set(['--force', '-f']);
const force = process.argv.slice(2).some((arg) => skipArgs.has(arg));

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function latestMtime(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return 0;
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    latest = Math.max(latest, latestMtime(path.join(target, entry.name)));
  }
  return latest;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status ?? 1;
}

if (!force && outputs.every(exists) && exists(stampFile)) {
  const newestInput = Math.max(...inputs.map(latestMtime));
  const buildStamp = latestMtime(stampFile);
  if (buildStamp >= newestInput) {
    console.log('Build up to date. Skipping. Use `npm run build:force` to rebuild.');
    process.exit(0);
  }
}

const status = run('npm', ['run', 'build:force']);
if (status === 0) fs.writeFileSync(path.join(root, stampFile), new Date().toISOString());
process.exit(status);
