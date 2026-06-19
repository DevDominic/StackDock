import type { ExtensionMainContext } from '../../../../electron/extensionHost';
import { assertAbsolutePath, assertNonEmptyString } from '../../../../electron/validation';
import { abortMerge, addAll, commit, discardFile, fetch, getGitDiff, getGitFileContents, getGitStatus, getIgnoredFiles, ignoreFile, listBranches, pull, pullMerge, push, stageFile, switchBranch, unstageFile } from './gitService';

const pathArg = (value: unknown, name = 'targetPath') => assertAbsolutePath(value, name);
const stringArg = (value: unknown, name: string) => assertNonEmptyString(value, name);
const pathsArg = (value: unknown) => Array.isArray(value) ? value.map((item, index) => assertNonEmptyString(item, `paths[${index}]`)) : [];

export function activateMain(ctx: ExtensionMainContext) {
  ctx.rpc.handle('status', (targetPath) => getGitStatus(pathArg(targetPath)));
  ctx.rpc.handle('branches', (targetPath) => listBranches(pathArg(targetPath)));
  ctx.rpc.handle('diff', (targetPath, filePath, staged) => getGitDiff(pathArg(targetPath), filePath == null ? undefined : stringArg(filePath, 'filePath'), Boolean(staged)));
  ctx.rpc.handle('fileContents', (targetPath, filePath, staged) => getGitFileContents(pathArg(targetPath), stringArg(filePath, 'filePath'), Boolean(staged)));
  ctx.rpc.handle('stage', (targetPath, filePath) => stageFile(pathArg(targetPath), stringArg(filePath, 'filePath')));
  ctx.rpc.handle('unstage', (targetPath, filePath) => unstageFile(pathArg(targetPath), stringArg(filePath, 'filePath')));
  ctx.rpc.handle('discard', (targetPath, filePath) => discardFile(pathArg(targetPath), stringArg(filePath, 'filePath')));
  ctx.rpc.handle('ignore', (targetPath, filePath) => ignoreFile(pathArg(targetPath), stringArg(filePath, 'filePath')));
  ctx.rpc.handle('commit', (targetPath, message) => commit(pathArg(targetPath), stringArg(message, 'message')));
  ctx.rpc.handle('addAll', (targetPath) => addAll(pathArg(targetPath)));
  ctx.rpc.handle('switchBranch', (targetPath, branch) => switchBranch(pathArg(targetPath), stringArg(branch, 'branch')));
  ctx.rpc.handle('push', (targetPath) => push(pathArg(targetPath)));
  ctx.rpc.handle('pull', (targetPath) => pull(pathArg(targetPath)));
  ctx.rpc.handle('pullMerge', (targetPath) => pullMerge(pathArg(targetPath)));
  ctx.rpc.handle('abortMerge', (targetPath) => abortMerge(pathArg(targetPath)));
  ctx.rpc.handle('fetch', (targetPath) => fetch(pathArg(targetPath)));
  ctx.rpc.handle('ignored', (targetPath, paths) => getIgnoredFiles(pathArg(targetPath), pathsArg(paths)));
}
