const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const inputs = ['src', 'electron', 'extensions', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'electron/tsconfig.json', 'scripts/build-if-needed.cjs', 'scripts/copy-extension-assets.cjs'];
const outputs = ['dist', 'dist-electron'];
const stampFile = '.buildstamp';
const forceArgs = new Set(['--force', '-f']);
const force = process.argv.slice(2).some((arg) => forceArgs.has(arg));

function fullPath(file) {
  return path.join(root, file);
}

function exists(file) {
  return fs.existsSync(fullPath(file));
}

function collectFiles(target, files = []) {
  const full = fullPath(target);
  if (!fs.existsSync(full)) return files;
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    files.push(target.replace(/\\/g, '/'));
    return files;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    collectFiles(path.join(target, entry.name), files);
  }
  return files;
}

function inputHash() {
  const hash = crypto.createHash('sha256');
  const files = inputs.flatMap((input) => collectFiles(input)).sort();
  for (const file of files) {
    const stat = fs.statSync(fullPath(file));
    hash.update(file);
    hash.update('\0');
    hash.update(String(stat.size));
    hash.update('\0');
    hash.update(fs.readFileSync(fullPath(file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(fullPath(stampFile), 'utf8'));
  } catch {
    return null;
  }
}

function writeStamp(hash) {
  fs.writeFileSync(fullPath(stampFile), JSON.stringify({ version: 1, hash, builtAt: new Date().toISOString() }, null, 2));
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status ?? 1;
}

const currentHash = inputHash();
const stamp = readStamp();

if (!force && outputs.every(exists) && stamp?.version === 1 && stamp.hash === currentHash) {
  console.log(`Build cache current (${currentHash.slice(0, 12)} from ${stamp.builtAt ?? 'unknown time'}). Skipping. Use \`npm run build:force\` to rebuild.`);
  process.exit(0);
}

const status = run('npm', ['run', 'build:force']);
if (status === 0) writeStamp(currentHash);
process.exit(status);
