import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { GitFileContents, GitFileStatus, GitStatus } from '../../../../src/shared/types';
import { parseStatusLine } from './gitParser';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[], options?: { timeoutMs?: number }) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    maxBuffer: 1024 * 1024 * 10,
    timeout: options?.timeoutMs ?? 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.toString();
}

function assertSafeGitRef(ref: string) {
  const value = ref.trim();
  if (!value) throw new Error('Branch required');
  if (value.startsWith('-')) throw new Error('Branch cannot start with -');
  return value;
}

export async function listBranches(cwd: string): Promise<string[]> {
  try {
    const output = await runGit(cwd, ['branch', '--format=%(refname:short)']);
    return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  try {
    const output = await runGit(cwd, ['status', '--porcelain=v1', '-b']);
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    const branchLine = lines.shift() ?? '';
    const status: GitStatus = { isRepo: true, files: [] };
    const branchMatch = branchLine.match(/^##\s+([^\.\[]+)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?/);
    if (branchMatch) {
      status.branch = branchMatch[1]?.trim();
      const extra = branchMatch[3] ?? '';
      const ahead = extra.match(/ahead (\d+)/)?.[1];
      const behind = extra.match(/behind (\d+)/)?.[1];
      if (ahead) status.ahead = Number(ahead);
      if (behind) status.behind = Number(behind);
    }
    status.files = lines.map(parseStatusLine).filter(Boolean) as GitFileStatus[];
    status.branches = await listBranches(cwd);
    return status;
  } catch {
    return { isRepo: false, files: [] };
  }
}

export async function getGitDiff(cwd: string, filePath?: string, staged = false) {
  try {
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (filePath) args.push('--', filePath);
    return await runGit(cwd, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function readGitObject(cwd: string, revision: string, filePath: string) {
  try {
    return await runGit(cwd, ['show', `${revision}:${filePath}`]);
  } catch {
    return '';
  }
}

async function readIndexObject(cwd: string, filePath: string) {
  try {
    return await runGit(cwd, ['show', `:${filePath}`]);
  } catch {
    return '';
  }
}

async function readWorkingFile(cwd: string, filePath: string) {
  try {
    return await fs.readFile(path.join(cwd, filePath), 'utf8');
  } catch {
    return '';
  }
}

export async function getGitFileContents(cwd: string, filePath: string, staged = false): Promise<GitFileContents> {
  if (staged) {
    const [original, modified] = await Promise.all([
      readGitObject(cwd, 'HEAD', filePath),
      readIndexObject(cwd, filePath),
    ]);
    return { path: filePath, original, modified };
  }

  const indexContent = await readIndexObject(cwd, filePath);
  const original = indexContent || await readGitObject(cwd, 'HEAD', filePath);
  const modified = await readWorkingFile(cwd, filePath);
  return { path: filePath, original, modified };
}

export async function stageFile(cwd: string, filePath: string) {
  await runGit(cwd, ['add', '--', filePath]);
}

export async function unstageFile(cwd: string, filePath: string) {
  await runGit(cwd, ['restore', '--staged', '--', filePath]);
}

export async function discardFile(cwd: string, filePath: string) {
  await runGit(cwd, ['restore', '--', filePath]);
}

export async function commit(cwd: string, message: string) {
  await runGit(cwd, ['commit', '-m', message]);
}

export async function addAll(cwd: string) {
  await runGit(cwd, ['add', '.']);
}

export async function switchBranch(cwd: string, branch: string) {
  const safeBranch = assertSafeGitRef(branch);
  const branches = await listBranches(cwd);
  if (!branches.includes(safeBranch)) throw new Error('Unknown branch');
  await runGit(cwd, ['switch', safeBranch]);
}

export async function push(cwd: string) {
  await runGit(cwd, ['push'], { timeoutMs: 120000 });
}

export async function pull(cwd: string) {
  await runGit(cwd, ['pull', '--ff-only'], { timeoutMs: 120000 });
}

export async function fetch(cwd: string) {
  await runGit(cwd, ['fetch'], { timeoutMs: 120000 });
}
