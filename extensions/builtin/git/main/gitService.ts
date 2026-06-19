import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { GitFileContents, GitFileStatus, GitStatus } from '../../../../src/shared/types';
import { parseStatusLine } from './gitParser';

const execFileAsync = promisify(execFile);

interface GitResult { stdout: string; stderr: string }

export class GitCommandError extends Error {
  stdout: string;
  stderr: string;
  remoteErrorKind: 'auth' | 'terminal-required' | 'other';

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = 'GitCommandError';
    this.stdout = stdout;
    this.stderr = stderr;
    this.remoteErrorKind = isAuthErrorText(`${stderr}\n${stdout}`) ? 'auth' : 'other';
  }
}

function formatGitError(stdout: string, stderr: string) {
  const detail = `${stderr}\n${stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8).join('\n');
  return detail || 'Git command failed';
}

async function runGit(cwd: string, args: string[], options?: { timeoutMs?: number }): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], {
      maxBuffer: 1024 * 1024 * 10,
      timeout: options?.timeoutMs ?? 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    const stdout = typeof error === 'object' && error && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '';
    const stderr = typeof error === 'object' && error && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    throw new GitCommandError(formatGitError(stdout, stderr), stdout, stderr);
  }
}

function isAuthErrorText(text: string) {
  return /Authentication failed|Credentials are incorrect or have expired|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|Repository not found.*(Authentication|auth|credential|permission)/i.test(text);
}

export function isAuthError(error: unknown) {
  if (error instanceof GitCommandError) return error.remoteErrorKind === 'auth';
  return error instanceof Error ? isAuthErrorText(error.message) : isAuthErrorText(String(error));
}

async function gitOutput(cwd: string, args: string[], options?: { timeoutMs?: number }) {
  return (await runGit(cwd, args, options)).stdout;
}

async function gitPathExists(cwd: string, gitPath: string) {
  try {
    const resolved = (await gitOutput(cwd, ['rev-parse', '--git-path', gitPath])).trim();
    if (!resolved) return false;
    const target = path.isAbsolute(resolved) ? resolved : path.join(cwd, resolved);
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function detectOperation(cwd: string): Promise<GitStatus['operation']> {
  if (await gitPathExists(cwd, 'MERGE_HEAD')) return 'merge';
  if (await gitPathExists(cwd, 'REBASE_HEAD') || await gitPathExists(cwd, 'rebase-merge') || await gitPathExists(cwd, 'rebase-apply')) return 'rebase';
  if (await gitPathExists(cwd, 'CHERRY_PICK_HEAD')) return 'cherry-pick';
  return undefined;
}

function assertSafeGitRef(ref: string) {
  const value = ref.trim();
  if (!value) throw new Error('Branch required');
  if (value.startsWith('-')) throw new Error('Branch cannot start with -');
  return value;
}

export async function listBranches(cwd: string): Promise<string[]> {
  try {
    const output = await gitOutput(cwd, ['branch', '--format=%(refname:short)']);
    return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  try {
    const output = await gitOutput(cwd, ['status', '--porcelain=v1', '-b']);
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
    status.operation = await detectOperation(cwd);
    status.conflicts = status.files.filter((file) => file.conflicted).length;
    status.mergeReady = status.operation === 'merge' && status.conflicts === 0;
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
    return await gitOutput(cwd, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function readGitObject(cwd: string, revision: string, filePath: string) {
  try { return await gitOutput(cwd, ['show', `${revision}:${filePath}`]); } catch { return ''; }
}
async function readIndexObject(cwd: string, filePath: string) {
  try { return await gitOutput(cwd, ['show', `:${filePath}`]); } catch { return ''; }
}
async function readWorkingFile(cwd: string, filePath: string) {
  try { return await fs.readFile(path.join(cwd, filePath), 'utf8'); } catch { return ''; }
}

export async function getGitFileContents(cwd: string, filePath: string, staged = false): Promise<GitFileContents> {
  if (staged) {
    const [original, modified] = await Promise.all([readGitObject(cwd, 'HEAD', filePath), readIndexObject(cwd, filePath)]);
    return { path: filePath, original, modified };
  }
  const indexContent = await readIndexObject(cwd, filePath);
  const original = indexContent || await readGitObject(cwd, 'HEAD', filePath);
  const modified = await readWorkingFile(cwd, filePath);
  return { path: filePath, original, modified };
}

export async function stageFile(cwd: string, filePath: string) { await runGit(cwd, ['add', '--', filePath]); }
export async function unstageFile(cwd: string, filePath: string) { await runGit(cwd, ['restore', '--staged', '--', filePath]); }
export async function discardFile(cwd: string, filePath: string) { await runGit(cwd, ['restore', '--', filePath]); }

function toGitIgnorePattern(cwd: string, filePath: string) {
  const relative = path.relative(cwd, path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Path must be inside the repository');
  return `/${relative.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}`;
}

export async function ignoreFile(cwd: string, filePath: string) {
  const pattern = toGitIgnorePattern(cwd, filePath);
  const gitignorePath = path.join(cwd, '.gitignore');
  let existing = '';
  try { existing = await fs.readFile(gitignorePath, 'utf8'); } catch { existing = ''; }
  const lines = existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.includes(pattern)) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    await fs.appendFile(gitignorePath, `${prefix}${pattern}\n`, 'utf8');
  }
}

export async function commit(cwd: string, message: string) { await runGit(cwd, ['commit', '-m', message]); }
export async function addAll(cwd: string) { await runGit(cwd, ['add', '.']); }

export async function switchBranch(cwd: string, branch: string) {
  const safeBranch = assertSafeGitRef(branch);
  const branches = await listBranches(cwd);
  if (!branches.includes(safeBranch)) throw new Error('Unknown branch');
  await runGit(cwd, ['switch', safeBranch]);
}

export async function push(cwd: string) { await runGit(cwd, ['push'], { timeoutMs: 120000 }); }
export async function pull(cwd: string) { await runGit(cwd, ['pull', '--ff-only'], { timeoutMs: 120000 }); }
export async function pullMerge(cwd: string) {
  try {
    await runGit(cwd, ['pull', '--no-rebase', '--no-edit'], { timeoutMs: 120000 });
  } catch (error) {
    const status = await getGitStatus(cwd);
    if (status.operation === 'merge' && (status.conflicts ?? 0) > 0) throw new Error('Merge has conflicts. Resolve them, stage the files, then commit the merge.');
    throw error;
  }
}
export async function abortMerge(cwd: string) { await runGit(cwd, ['merge', '--abort']); }
export async function fetch(cwd: string) { await runGit(cwd, ['fetch'], { timeoutMs: 120000 }); }

export async function getIgnoredFiles(cwd: string, filePaths: string[]): Promise<string[]> {
  if (!filePaths.length) return [];
  const relativePaths = filePaths.map((filePath) => path.relative(cwd, path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)).replace(/\\/g, '/'));
  try {
    const output = await gitOutput(cwd, ['check-ignore', ...relativePaths]);
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    const output = error instanceof GitCommandError ? error.stdout : '';
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
}
