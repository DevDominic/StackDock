import { GitPanel } from '../../components/workspace/GitPanel';
import type { NativeExtension } from '../extensionTypes';

export const gitExtension: NativeExtension = {
  manifest: { id: 'stackdock.git', name: 'Source Control', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { views: [{ id: 'stackdock.git.view', extensionId: 'stackdock.git', title: 'Source Control', icon: 'git', location: 'activity', order: 20, native: true, when: 'gitRepo' }], statusBar: [{ id: 'stackdock.git.status', extensionId: 'stackdock.git', side: 'left', order: 10, native: true, when: 'gitRepo' }] } },
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
      onRefresh={ctx.actions.refreshGit}
    />
  ),
  renderStatusBar: (_contribution, { git, actions }) => {
    if (!git?.isRepo) return null;
    const ahead = git.ahead ?? 0;
    const behind = git.behind ?? 0;
    return <button className="statusbar-item" onClick={actions.openGit} title={`${git.files.length} changed file(s) — open Source Control`}><span className="statusbar-icon" aria-hidden>⎇</span><span className="statusbar-branch">{git.branch ?? 'no branch'}</span>{behind > 0 ? <span className="statusbar-sync" title={`${behind} behind`}>↓{behind}</span> : null}{ahead > 0 ? <span className="statusbar-sync" title={`${ahead} ahead`}>↑{ahead}</span> : null}<span className="statusbar-dirty">{git.files.length}</span></button>;
  },
};
