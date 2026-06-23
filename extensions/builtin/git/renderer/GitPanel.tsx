import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { GitFileStatus, GitStatus } from '../../../../src/shared/types';
import { FileIcon } from '../../../../src/components/workspace/fileIcons';

type GitSelectionGroup = 'staged' | 'changes';
type GitSelectionEvent = MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>;

interface Props {
  status: GitStatus | null;
  error?: string | null;
  selectedFile: GitFileStatus | null;
  onClearError(): void;
  selectedStagedPaths: string[];
  selectedChangePaths: string[];
  onSelectFile(file: GitFileStatus, staged: boolean, event?: GitSelectionEvent, groupFiles?: GitFileStatus[]): void;
  onStage(path: string): void;
  onStageSelected(paths: string[]): void;
  onStageAll(): void;
  onUnstage(path: string): void;
  onUnstageSelected(paths: string[]): void;
  onDiscard(path: string): void;
  onDiscardSelected(paths: string[]): void;
  onIgnore(path: string): void;
  onCommit(message: string): void;
  onSwitchBranch(branch: string): void;
  onFetch(): void;
  onPull(): void;
  onPullMerge(): void;
  onPush(): void;
  onAbortMerge(): void;
  onRefresh(): void;
}

function statusText(file: GitFileStatus) {
  if (file.conflicted) return file.conflictStatus || '!';
  if (file.untracked) return 'U';
  const code = (file.worktreeStatus.trim() || file.indexStatus.trim() || 'M').toUpperCase();
  return code === 'A' || code === 'D' || code === 'R' ? code : 'M';
}

function statusClass(file: GitFileStatus) {
  if (file.conflicted) return 'git-conflict';
  if (file.untracked) return 'git-untracked';
  const code = statusText(file);
  if (code === 'A') return 'git-added';
  if (code === 'D') return 'git-deleted';
  return 'git-modified';
}

function isDirectoryStatusPath(path: string) {
  return /[\\/]$/.test(path);
}

function splitPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const displayPath = normalized.replace(/\/+$/, '');
  const index = displayPath.lastIndexOf('/');
  return index >= 0
    ? { dir: displayPath.slice(0, index), name: displayPath.slice(index + 1) }
    : { dir: '', name: displayPath };
}

export function GitPanel({ status, error, selectedFile, selectedStagedPaths, selectedChangePaths, onSelectFile, onStage, onStageSelected, onStageAll, onUnstage, onUnstageSelected, onDiscard, onDiscardSelected, onIgnore, onCommit, onSwitchBranch, onFetch, onPull, onPullMerge, onPush, onAbortMerge, onRefresh, onClearError }: Props) {
  const conflicts = status?.files.filter((file) => file.conflicted) ?? [];
  const staged = status?.files.filter((file) => file.staged && !file.untracked && !file.conflicted) ?? [];
  const unstaged = status?.files.filter((file) => (file.unstaged || file.untracked) && !file.conflicted) ?? [];
  const branches = status?.branches ?? [];
  const branchOptions = status?.branch && !branches.includes(status.branch) ? [status.branch, ...branches] : branches;
  const activeSelection: GitSelectionGroup | null = selectedStagedPaths.length ? 'staged' : selectedChangePaths.length ? 'changes' : null;

  return (
    <aside className="panel git-panel">
      <div className="panel-title row">
        <span>Source Control</span>
        <div className="row mini-row">
          <button className="icon-btn git-header-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="icon-btn git-header-btn" onClick={onStageAll} disabled={!unstaged.length} title="Stage all changes" aria-label="Stage all changes">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          {status?.isRepo ? <GitRemoteMenu onFetch={onFetch} onPull={onPull} onPullMerge={onPullMerge} onPush={onPush} /> : null}
        </div>
      </div>
      {error ? (
        <div className="banner error git-error" role="alert">
          <span>{error}</span>
          <button className="git-error-close" type="button" onClick={onClearError} title="Dismiss error" aria-label="Dismiss git error">×</button>
        </div>
      ) : null}
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

          {status.operation === 'merge' ? <div className="git-merge-banner">
            <div>{status.mergeReady ? 'Merge ready: commit to finish the merge.' : 'Merge in progress: resolve conflicts, stage resolved files, then commit.'}</div>
            <button className="git-action git-discard" onClick={onAbortMerge}>Abort Merge</button>
          </div> : null}
          {conflicts.length ? <GitGroup title="Conflicts" group="changes" files={conflicts} selectedFile={selectedFile} selectedPaths={selectedChangePaths} onSelectFile={(file, event, files) => onSelectFile(file, false, event, files)} onStage={onStage} onUndo={onDiscard} onIgnore={onIgnore} /> : null}
          {staged.length ? <GitGroup title="Staged" group="staged" files={staged} selectedFile={selectedFile} selectedPaths={selectedStagedPaths} onSelectFile={(file, event, files) => onSelectFile(file, true, event, files)} onUndo={onUnstage} onIgnore={onIgnore} /> : null}
          <GitGroup title="Changes" group="changes" files={unstaged} selectedFile={selectedFile} selectedPaths={selectedChangePaths} onSelectFile={(file, event, files) => onSelectFile(file, false, event, files)} onStage={onStage} onUndo={onDiscard} onIgnore={onIgnore} />
          <div className={`git-actions git-batch-actions${activeSelection ? ' is-active' : ''}`}>
            {activeSelection === 'staged' ? <button className="git-action ghost" onClick={() => onUnstageSelected(selectedStagedPaths)}>Unstage Selected ({selectedStagedPaths.length})</button> : null}
            {activeSelection === 'changes' ? <button className="git-action git-stage" onClick={() => onStageSelected(selectedChangePaths)}>Stage Selected ({selectedChangePaths.length})</button> : null}
            {activeSelection === 'changes' ? <button className="git-action git-discard" onClick={() => onDiscardSelected(selectedChangePaths)}>Discard Selected ({selectedChangePaths.length})</button> : null}
            {!activeSelection ? <span className="muted git-selection-hint">Select changed files to stage, unstage, or discard together.</span> : null}
          </div>
          <CommitBox onCommit={onCommit} onPush={onPush} merge={status.operation === 'merge'} />
        </>
      ) : null}
    </aside>
  );
}

function GitGroup({ title, group, files, selectedFile, selectedPaths, onSelectFile, onStage, onUndo, onIgnore }: { title: string; group: GitSelectionGroup; files: GitFileStatus[]; selectedFile: GitFileStatus | null; selectedPaths: string[]; onSelectFile(file: GitFileStatus, event: GitSelectionEvent, files: GitFileStatus[]): void; onStage?(path: string): void; onUndo(path: string): void; onIgnore(path: string): void }) {
  const selected = new Set(selectedPaths);
  const [menu, setMenu] = useState<{ file: GitFileStatus; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', onKey); };
  }, [menu]);
  const runMenu = (action: () => void) => (event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); setMenu(null); action(); };
  return (
    <div className="git-group">
      <div className="git-group-title">{title} ({files.length})</div>
      <div className="git-list">
        {files.map((file) => {
          const cls = statusClass(file);
          const { dir, name } = splitPath(file.path);
          const isSelected = selected.has(file.path);
          const isActive = selectedFile?.path === file.path;
          const isDirectory = isDirectoryStatusPath(file.path);
          return (
            <button key={`${title}:${file.path}`} className={`tree-row git-file ${cls}${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`} title={file.path} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); onSelectFile(file, event, files); }} onClick={(event) => { if (event.detail === 0) onSelectFile(file, event, files); }} onContextMenu={(event) => { event.preventDefault(); onSelectFile(file, event, files); setMenu({ file, x: event.clientX, y: event.clientY }); }}>
              <span className="tree-twisty" />
              <FileIcon name={name} isDirectory={isDirectory} expanded={false} />
              <span className="git-path">
                {dir ? <><span className="git-path-dir">{dir}</span><span className="git-path-separator">/</span></> : null}
                <span className="tree-label git-path-name">{name}</span>
              </span>
              <span className="git-row-actions" aria-label={`${title} actions`} onPointerDown={(event) => event.stopPropagation()}>
                {group === 'changes' ? <span role="button" tabIndex={0} className="git-row-action git-row-stage" title="Stage" onClick={(event) => { event.stopPropagation(); onStage?.(file.path); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onStage?.(file.path); } }}>+</span> : null}
                <span role="button" tabIndex={0} className="git-row-action git-row-undo" title={group === 'staged' ? 'Unstage' : 'Discard changes'} onClick={(event) => { event.stopPropagation(); onUndo(file.path); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onUndo(file.path); } }}>{'<-'}</span>
              </span>
              <span className={`git-badge ${cls}`}>{statusText(file)}</span>
            </button>
          );
        })}
      </div>
      {menu ? (
        <div className="git-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          {group === 'changes' ? <button role="menuitem" className="git-menu-item" onClick={runMenu(() => onStage?.(menu.file.path))}>Stage</button> : null}
          {group === 'staged' ? <button role="menuitem" className="git-menu-item" onClick={runMenu(() => onUndo(menu.file.path))}>Unstage</button> : null}
          {group === 'changes' && !menu.file.untracked ? <button role="menuitem" className="git-menu-item" onClick={runMenu(() => onUndo(menu.file.path))}>Revert Changes</button> : null}
          {group === 'changes' ? <button role="menuitem" className="git-menu-item danger" onClick={runMenu(() => onUndo(menu.file.path))}>{menu.file.untracked ? 'Discard File' : 'Discard Changes'}</button> : null}
          <button role="menuitem" className="git-menu-item" onClick={runMenu(() => onIgnore(menu.file.path))}>Ignore</button>
        </div>
      ) : null}
    </div>
  );
}

function GitRemoteMenu({ onFetch, onPull, onPullMerge, onPush }: { onFetch(): void; onPull(): void; onPullMerge(): void; onPush(): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: Event) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return (
    <div className="git-menu" ref={ref}>
      <button className="icon-btn git-header-btn" aria-haspopup="menu" aria-expanded={open} title="Remote actions" aria-label="Remote actions" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
      </button>
      {open ? (
        <div className="git-menu-pop" role="menu">
          <button role="menuitem" className="git-menu-item" onClick={run(onFetch)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v7m0 0L5.2 6.2M8 9l2.8-2.8M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Fetch</span>
          </button>
          <button role="menuitem" className="git-menu-item" onClick={run(onPull)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v8m0 0L4.5 7M8 10.5 11.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Pull</span>
          </button>
          <button role="menuitem" className="git-menu-item" onClick={run(onPullMerge)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="4.5" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.3" /><circle cx="11.5" cy="12" r="1.7" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 5.7v2.3a3 3 0 0 0 3 3h2.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Pull Merge</span>
          </button>
          <div className="git-menu-sep" />
          <button role="menuitem" className="git-menu-item" onClick={run(onPush)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13.5v-8m0 0L4.5 9M8 5.5 11.5 9M3 3.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Push</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CommitBox({ onCommit, onPush, merge }: { onCommit(message: string): void; onPush(): void; merge: boolean }) {
  return (
    <div className="commit-box pad">
      <textarea id="commit-message" placeholder="Commit message" rows={3} />
      <div className="commit-actions">
        <button className="primary commit-btn" onClick={() => { const input = document.getElementById('commit-message') as HTMLTextAreaElement | null; if (!input?.value.trim()) return; onCommit(input.value.trim()); input.value = ''; }}>{merge ? 'Commit Merge' : 'Commit'}</button>
        <button className="commit-push-btn" onClick={onPush} title="Push to remote">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13.5v-8m0 0L4.5 9M8 5.5 11.5 9M3 3.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Push</span>
        </button>
      </div>
    </div>
  );
}
