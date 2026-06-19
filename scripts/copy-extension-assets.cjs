const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'extensions', 'builtin');
const targetRoot = path.join(root, 'dist-electron', 'extensions', 'builtin');
const copiedFileNames = new Set(['stackdock.extension.json']);

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (copiedFileNames.has(entry.name)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

copyDirectory(sourceRoot, targetRoot);
