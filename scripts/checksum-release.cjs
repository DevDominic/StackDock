#!/usr/bin/env node
const { createHash } = require('node:crypto');
const { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const [platform, arch] = process.argv.slice(2);

if (!platform || !arch) {
  console.error('Usage: node scripts/checksum-release.cjs <platform> <arch>');
  process.exit(1);
}

const releaseDir = 'release';
mkdirSync(releaseDir, { recursive: true });

const checksumName = `SHA256SUMS-${platform}-${arch}.txt`;
const lines = readdirSync(releaseDir)
  .sort((a, b) => a.localeCompare(b))
  .filter((name) => name !== checksumName)
  .filter((name) => statSync(join(releaseDir, name)).isFile())
  .map((name) => {
    const hash = createHash('sha256').update(readFileSync(join(releaseDir, name))).digest('hex');
    return `${hash}  ${name}`;
  });

writeFileSync(join(releaseDir, checksumName), `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${checksumName}`);
