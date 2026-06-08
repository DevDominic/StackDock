import type { GitFileStatus, GitStatus } from '../../shared/types';
import { FileIcon } from './fileIcons';

interface Props {
  status: GitStatus | null;
  error?: string | null;
  selectedFile: GitFileStatus | null;
  onSelectFile(file: GitFileStatus, staged?: boolean): void;
  onStage(path: string): void;
  onStageAll(): void;
  onUnstage(path: string): void;
  onDiscard(path: string): void;
  onCommit(message: string): void;
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

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function GitPanel({ status, error, selectedFile, onSelectFile, onStage, onStageAll, onUnstage, onDiscard, onCommit, onRefresh }: Props) {
  const staged = status?.files.filter((file) => file.staged && !file.untracked) ?? [];
  const unstaged = status?.files.filter((file) => file.unstaged || file.untracked) ?? [];

  return (
    <aside className="panel git-panel">
      <div className="panel-title row"><span>Source Control</span><div className="row mini-row"><button className="ghost" onClick={onRefresh}>Refresh</button><button className="ghost" onClick={onStageAll}>Stage All</button></div></div>
      {error ? <div className="banner error git-error">{error}</div> : null}
      {!status?.isRepo ? <div className="muted pad">Not a git repo.</div> : null}
      {status?.isRepo ? (
        <>
          <div className="git-summary"><span>{status.branch ?? 'detached'}</span><span>{status.files.length} dirty</span></div>
          <GitGroup title="Staged" files={staged} selectedFile={selectedFile} onSelectFile={(file) => onSelectFile(file, true)} />
          <GitGroup title="Changes" files={unstaged} selectedFile={selectedFile} onSelectFile={(file) => onSelectFile(file, false)} />
          <div className="git-actions">
            {selectedFile?.staged ? <button className="ghost" onClick={() => onUnstage(selectedFile.path)}>Unstage</button> : null}
            {selectedFile && (selectedFile.unstaged || selectedFile.untracked) ? <button className="ghost" onClick={() => onStage(selectedFile.path)}>Stage</button> : null}
            {selectedFile && (selectedFile.unstaged || selectedFile.untracked) ? <button className="ghost danger" onClick={() => onDiscard(selectedFile.path)}>Discard</button> : null}
            {selectedFile?.staged && selectedFile.unstaged ? <><button className="ghost" onClick={() => onSelectFile(selectedFile, true)}>Staged diff</button><button className="ghost" onClick={() => onSelectFile(selectedFile, false)}>Unstaged diff</button></> : null}
          </div>
          <CommitBox onCommit={onCommit} />
          <div className="git-editor-diff-hint muted">{selectedFile ? 'Diff opened in editor.' : 'Select a file to view its diff in the editor.'}</div>
        </>
      ) : null}
    </aside>
  );
}

function GitGroup({ title, files, selectedFile, onSelectFile }: { title: string; files: GitFileStatus[]; selectedFile: GitFileStatus | null; onSelectFile(file: GitFileStatus): void }) {
  return (
    <div className="git-group">
      <div className="git-group-title">{title} ({files.length})</div>
      <div className="git-list">
        {files.map((file) => {
          const cls = statusClass(file);
          return (
            <button key={`${title}:${file.path}`} className={selectedFile?.path === file.path ? `tree-row git-file ${cls} active` : `tree-row git-file ${cls}`} title={file.path} onClick={() => onSelectFile(file)}>
              <span className="tree-twisty" />
              <FileIcon name={fileName(file.path)} isDirectory={false} expanded={false} />
              <span className="tree-label">{file.path}</span>
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
