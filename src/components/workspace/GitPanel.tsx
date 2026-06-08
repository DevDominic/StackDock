import type { GitFileStatus, GitStatus } from '../../shared/types';

interface Props {
  status: GitStatus | null;
  diff: string;
  selectedFile: GitFileStatus | null;
  onSelectFile(file: GitFileStatus): void;
  onStage(path: string): void;
  onUnstage(path: string): void;
  onDiscard(path: string): void;
  onCommit(message: string): void;
  onRefresh(): void;
}

export function GitPanel({ status, diff, selectedFile, onSelectFile, onStage, onUnstage, onDiscard, onCommit, onRefresh }: Props) {
  return (
    <aside className="panel git-panel">
      <div className="panel-title row">
        <span>Git</span>
        <button className="ghost" onClick={onRefresh}>Refresh</button>
      </div>
      {!status?.isRepo ? <div className="muted pad">Not a git repo.</div> : null}
      {status?.isRepo ? (
        <>
          <div className="git-summary pad">
            <div><strong>Branch:</strong> {status.branch ?? 'detached'}</div>
            <div><strong>Dirty:</strong> {status.files.length}</div>
          </div>
          <div className="git-list">
            {status.files.map((file) => (
              <button key={file.path} className={selectedFile?.path === file.path ? 'git-file active' : 'git-file'} onClick={() => onSelectFile(file)}>
                <span>{file.path}</span>
                <small>{file.untracked ? '??' : `${file.indexStatus}${file.worktreeStatus}`}</small>
              </button>
            ))}
          </div>
          <div className="git-actions pad">
            {selectedFile ? (
              <>
                <button className="ghost" onClick={() => onStage(selectedFile.path)}>Stage</button>
                <button className="ghost" onClick={() => onUnstage(selectedFile.path)}>Unstage</button>
                <button className="ghost danger" onClick={() => onDiscard(selectedFile.path)}>Discard</button>
              </>
            ) : null}
          </div>
          <CommitBox onCommit={onCommit} />
          <div className="diff-view">
            <pre>{diff || 'Select file for diff.'}</pre>
          </div>
        </>
      ) : null}
    </aside>
  );
}

function CommitBox({ onCommit }: { onCommit(message: string): void }) {
  return (
    <div className="commit-box pad">
      <textarea id="commit-message" placeholder="Commit message" rows={3} />
      <button
        className="primary"
        onClick={() => {
          const input = document.getElementById('commit-message') as HTMLTextAreaElement | null;
          if (!input?.value.trim()) return;
          onCommit(input.value.trim());
          input.value = '';
        }}
      >
        Commit
      </button>
    </div>
  );
}
