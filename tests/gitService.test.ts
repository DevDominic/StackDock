import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import { getGitFileContents, getGitStatus, ignoreFile } from '../extensions/builtin/git/main/gitService';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  await execFileAsync('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
}

async function makeConflictRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-git-'));
  await git(dir, ['init']);
  await fs.writeFile(path.join(dir, 'file.txt'), 'base\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'base']);
  await git(dir, ['checkout', '-b', 'side']);
  await fs.writeFile(path.join(dir, 'file.txt'), 'side\n');
  await git(dir, ['commit', '-am', 'side']);
  await git(dir, ['checkout', 'main']).catch(() => git(dir, ['checkout', 'master']));
  await fs.writeFile(path.join(dir, 'file.txt'), 'main\n');
  await git(dir, ['commit', '-am', 'main']);
  await git(dir, ['merge', 'side']).catch(() => undefined);
  return dir;
}

describe('gitService ignore support', () => {
  it('adds repository-relative paths to .gitignore once', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-git-ignore-'));
    await git(dir, ['init']);
    await ignoreFile(dir, 'nested/file[1].txt');
    await ignoreFile(dir, path.join(dir, 'nested', 'file[1].txt'));
    const contents = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(contents).toBe('/nested/file\\[1\\].txt\n');
  });
});

describe('gitService status', () => {
  it('lists files inside new untracked folders instead of only the folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-git-status-'));
    await git(dir, ['init']);
    await fs.mkdir(path.join(dir, 'migrated', 'nested'), { recursive: true });
    await fs.writeFile(path.join(dir, 'migrated', 'first.txt'), 'first\n');
    await fs.writeFile(path.join(dir, 'migrated', 'nested', 'second.txt'), 'second\n');

    const status = await getGitStatus(dir);
    const paths = status.files.map((file) => file.path).sort();

    expect(paths).toEqual(['migrated/first.txt', 'migrated/nested/second.txt']);
    expect(status.files.every((file) => file.untracked)).toBe(true);
  });
});

describe('gitService file contents', () => {
  it('marks binary files so the renderer can skip text diff preview', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-git-binary-'));
    await git(dir, ['init']);
    await fs.writeFile(path.join(dir, 'image.bin'), Buffer.from([0, 1, 2, 3]));

    const contents = await getGitFileContents(dir, 'image.bin', false);

    expect(contents.binary).toBe(true);
  });
});

describe('gitService merge state', () => {
  it('detects unresolved merge conflicts', async () => {
    const dir = await makeConflictRepo();
    const status = await getGitStatus(dir);
    expect(status.operation).toBe('merge');
    expect(status.conflicts).toBeGreaterThan(0);
    expect(status.files.some((file) => file.conflicted)).toBe(true);
  });

  it('detects merge ready after resolving and staging', async () => {
    const dir = await makeConflictRepo();
    await fs.writeFile(path.join(dir, 'file.txt'), 'resolved\n');
    await git(dir, ['add', 'file.txt']);
    const status = await getGitStatus(dir);
    expect(status.operation).toBe('merge');
    expect(status.conflicts).toBe(0);
    expect(status.mergeReady).toBe(true);
  });
});
