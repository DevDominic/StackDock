import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitFileStatus, GitStatus } from '../src/shared/types';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 1024 * 1024 * 10 });
  return stdout.toString();
}

function parseStatusLine(line: string): GitFileStatus | null {
  if (line.startsWith('?? ')) {
    const filePath = line.slice(3).trim();
    return { path: filePath, indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, untracked: true };
  }
  if (line.length < 4) return null;
  const indexStatus = line[0] ?? ' ';
  const worktreeStatus = line[1] ?? ' ';
  let filePath = line.slice(3).trim();
  if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop() ?? filePath;
  return {
    path: filePath,
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== ' ',
    unstaged: worktreeStatus !== ' ',
    untracked: false,
  };
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
