import type { MouseEvent } from 'react';
import type { GitFileStatus, GitStatus } from '../../../../src/shared/types';
import { FileIcon } from '../../../../src/components/workspace/fileIcons';

type GitSelectionGroup = 'staged' | 'changes';

interface Props {
  status: GitStatus | null;
  error?: string | null;
  selectedFile: GitFileStatus | null;
  selectedStagedPaths: string[];
  selectedChangePaths: string[];
  onSelectFile(file: GitFileStatus, staged: boolean, event?: MouseEvent<HTMLButtonElement>, groupFiles?: GitFileStatus[]): void;
  onStage(path: string): void;
  onStageSelected(paths: string[]): void;
  onStageAll(): void;
  onUnstage(path: string): void;
  onUnstageSelected(paths: string[]): void;
  onDiscard(path: string): void;
  onDiscardSelected(paths: string[]): void;
  onCommit(message: string): void;
  onSwitchBranch(branch: string): void;
  onRefresh(): void;
}

function statusText(file: GitFileStatus) {
  if (file.untracked) return 'U';
  const code = (file.worktreeStatus.trim() || file.indexStatus.trim() || 'M').toUpperCase();
  return code === 'A' || code === 'D' || code === 'R' ? code : 'M';
}

function statusClass(file: GitFileStatus) {
  if (file.untracked) return 'git-untracked';
  const code = statusText(file);
  if (code === 'A') return 'git-added';
  if (code === 'D') return 'git-deleted';
  return 'git-modified';
}

function splitPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0
    ? { dir: normalized.slice(0, index + 1), name: normalized.slice(index + 1) }
    : { dir: '', name: normalized };
}

export function GitPanel({ status, error, selectedFile, selectedStagedPaths, selectedChangePaths, onSelectFile, onStage, onStageSelected, onStageAll, onUnstage, onUnstageSelected, onDiscard, onDiscardSelected, onCommit, onSwitchBranch, onRefresh }: Props) {
  const staged = status?.files.filter((file) => file.staged && !file.untracked) ?? [];
  const unstaged = status?.files.filter((file) => file.unstaged || file.untracked) ?? [];
  const branches = status?.branches ?? [];
  const branchOptions = status?.branch && !branches.includes(status.branch) ? [status.branch, ...branches] : branches;
  const activeSelection: GitSelectionGroup | null = selectedStagedPaths.length ? 'staged' : selectedChangePaths.length ? 'changes' : null;

  return (
    <aside className="panel git-panel">
      <div className="panel-title row">
        <span>Source Control</span>
        <div className="row mini-row">
          <button className="ghost" onClick={onRefresh}>Refresh</button>
          <button className="ghost" onClick={onStageAll} disabled={!unstaged.length}>Stage All</button>
        </div>
      </div>
      {error ? <div className="banner error git-error">{error}</div> : null}
      {!status?.isRepo ? <div className="muted pad">Not a git repo.</div> : null}
      {status?.isRepo ? (
        <>
          <div className="git-summary">
            <select className="git-branch-select" aria-label="Git branch" value={status.branch ?? ''} disabled={!branchOptions.length} onChange={(event) => event.target.value && onSwitchBranch(event.target.value)}>
              {!status.branch ? <option value="">detached</option> : null}
              {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
            <span>{status.files.length} {status.files.length === 1 ? 'change' : 'changes'}</span>
          </div>
          {staged.length ? <GitGroup title="Staged" group="staged" files={staged} selectedFile={selectedFile} selectedPaths={selectedStagedPaths} onSelectFile={(file, event, files) => onSelectFile(file, true, event, files)} onUndo={onUnstage} /> : null}
          <GitGroup title="Changes" group="changes" files={unstaged} selectedFile={selectedFile} selectedPaths={selectedChangePaths} onSelectFile={(file, event, files) => onSelectFile(file, false, event, files)} onStage={onStage} onUndo={onDiscard} />
          <div className={`git-actions git-batch-actions${activeSelection ? ' is-active' : ''}`}>
            {activeSelection === 'staged' ? <button className="git-action ghost" onClick={() => onUnstageSelected(selectedStagedPaths)}>Unstage Selected ({selectedStagedPaths.length})</button> : null}
            {activeSelection === 'changes' ? <button className="git-action git-stage" onClick={() => onStageSelected(selectedChangePaths)}>Stage Selected ({selectedChangePaths.length})</button> : null}
            {activeSelection === 'changes' ? <button className="git-action git-discard" onClick={() => onDiscardSelected(selectedChangePaths)}>Discard Selected ({selectedChangePaths.length})</button> : null}
            {!activeSelection ? <span className="muted git-selection-hint">Select changed files to stage, unstage, or discard together.</span> : null}
          </div>
          <CommitBox onCommit={onCommit} />
        </>
      ) : null}
    </aside>
  );
}

function GitGroup({ title, group, files, selectedFile, selectedPaths, onSelectFile, onStage, onUndo }: { title: string; group: GitSelectionGroup; files: GitFileStatus[]; selectedFile: GitFileStatus | null; selectedPaths: string[]; onSelectFile(file: GitFileStatus, event: MouseEvent<HTMLButtonElement>, files: GitFileStatus[]): void; onStage?(path: string): void; onUndo(path: string): void }) {
  const selected = new Set(selectedPaths);
  return (
    <div className="git-group">
      <div className="git-group-title">{title} ({files.length})</div>
      <div className="git-list">
        {files.map((file) => {
          const cls = statusClass(file);
          const { dir, name } = splitPath(file.path);
          const isSelected = selected.has(file.path);
          const isActive = selectedFile?.path === file.path;
          return (
            <button key={`${title}:${file.path}`} className={`tree-row git-file ${cls}${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`} title={file.path} onClick={(event) => onSelectFile(file, event, files)}>
              <span className="tree-twisty" />
              <FileIcon name={name} isDirectory={false} expanded={false} />
              <span className="git-path">
                {dir ? <span className="git-path-dir">{dir}</span> : null}
                <span className="tree-label git-path-name">{name}</span>
              </span>
              <span className="git-row-actions" aria-label={`${title} actions`}>
                {group === 'changes' ? <span role="button" tabIndex={0} className="git-row-action git-row-stage" title="Stage" onClick={(event) => { event.stopPropagation(); onStage?.(file.path); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onStage?.(file.path); } }}>+</span> : null}
                <span role="button" tabIndex={0} className="git-row-action git-row-undo" title={group === 'staged' ? 'Unstage' : 'Discard changes'} onClick={(event) => { event.stopPropagation(); onUndo(file.path); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onUndo(file.path); } }}>{'<-'}</span>
              </span>
              <span className={`git-badge ${cls}`}>{statusText(file)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CommitBox({ onCommit }: { onCommit(message: string): void }) {
  return (
    <div className="commit-box pad">
      <textarea id="commit-message" placeholder="Commit message" rows={3} />
      <button className="primary" onClick={() => { const input = document.getElementById('commit-message') as HTMLTextAreaElement | null; if (!input?.value.trim()) return; onCommit(input.value.trim()); input.value = ''; }}>Commit</button>
    </div>
  );
}
