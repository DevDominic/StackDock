import { GitPanel } from './GitPanel';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { gitExtensionManifest } from '../manifest';
import './git.css';

export const gitExtension: NativeExtension = {
  manifest: gitExtensionManifest,
  renderView: (_contribution, ctx) => (
    <GitPanel
      status={ctx.git}
      error={ctx.gitActions.error}
      selectedFile={ctx.gitActions.selectedFile}
      selectedStagedPaths={ctx.gitActions.selectedStagedPaths}
      selectedChangePaths={ctx.gitActions.selectedChangePaths}
      onSelectFile={ctx.gitActions.selectFile}
      onStage={ctx.gitActions.stage}
      onStageSelected={ctx.gitActions.stageSelected}
      onStageAll={ctx.gitActions.stageAll}
      onUnstage={ctx.gitActions.unstage}
      onUnstageSelected={ctx.gitActions.unstageSelected}
      onDiscard={ctx.gitActions.discard}
      onDiscardSelected={ctx.gitActions.discardSelected}
      onCommit={ctx.gitActions.commit}
      onSwitchBranch={ctx.gitActions.switchBranch}
      onRefresh={ctx.actions.refreshGit}
    />
  ),
  renderStatusBar: (_contribution, { git, actions }) => {
    if (!git?.isRepo) return null;
    const ahead = git.ahead ?? 0;
    const behind = git.behind ?? 0;
    return <button className="statusbar-item" onClick={actions.openGit} title={`${git.files.length} changed file(s) — open Source Control`}><span className="statusbar-icon" aria-hidden>⎇</span><span className="statusbar-branch">{git.branch ?? 'no branch'}</span>{behind > 0 ? <span className="statusbar-sync" title={`${behind} behind`}>↓{behind}</span> : null}{ahead > 0 ? <span className="statusbar-sync" title={`${ahead} ahead`}>↑{ahead}</span> : null}<span className="statusbar-dirty">{git.files.length}</span></button>;
  },
  getCommands: ({ git, actions, gitActions }) => {
    if (!git?.isRepo) return [];
    const staged = git.files.filter((file) => file.staged && !file.untracked).length;
    const unstaged = git.files.filter((file) => file.unstaged || file.untracked).length;
    return [
      { id: 'show-git', label: 'Show Source Control', run: actions.openGit },
      ...(unstaged ? [{ id: 'git-stage-all', label: 'Git: Stage All', description: 'Stage all changed files', run: gitActions.stageAll }] : []),
      { id: 'git-commit', label: 'Git: Commit...', description: git.files.length ? 'Stage all changes, then commit' : 'Commit current index', run: () => undefined, prompt: { placeholder: 'Commit message', run: gitActions.stageAllAndCommit } },
      { id: 'git-commit-staged', label: 'Git: Commit Staged...', description: staged ? `${staged} staged ${staged === 1 ? 'file' : 'files'}` : 'Commit current index', run: () => undefined, prompt: { placeholder: 'Commit message', run: gitActions.commitStaged } },
      { id: 'git-fetch', label: 'Git: Fetch', description: 'Fetch from remote', run: gitActions.fetch },
      { id: 'git-pull', label: 'Git: Pull', description: 'Pull current branch with --ff-only', run: gitActions.pull },
      { id: 'git-push', label: 'Git: Push', description: 'Push current branch', run: gitActions.push },
      ...((git.branches ?? []).filter((branch) => branch !== git.branch).map((branch) => ({ id: `git-switch:${branch}`, label: `Git: Switch Branch: ${branch}`, description: `Checkout ${branch}`, run: () => gitActions.switchBranch(branch) }))),
      { id: 'refresh-git', label: 'Git: Refresh', run: actions.refreshGit },
    ];
  },
};
