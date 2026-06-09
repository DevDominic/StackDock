import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectAttachmentPath } from '../electron/attachmentService';

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-attachment-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('inspectAttachmentPath', () => {
  it('keeps large file reference as file path instead of parent directory', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'large.txt');
    await fs.writeFile(filePath, 'abcdef', 'utf8');

    const attachment = await inspectAttachmentPath(filePath, 'drop', { largeFileThresholdBytes: 1 });

    expect(attachment.isLarge).toBe(true);
    expect(attachment.path).toBe(filePath);
    expect(attachment.referencePath).toBe(filePath);
  });
});
