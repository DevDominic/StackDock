import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { GitStatus, Workspace } from '../../shared/types';

interface Props {
  workspaces: Workspace[];
  onAdd(): void;
  onOpen(id: string): void;
  onRemove(id: string): void;
  onTogglePin(workspace: Workspace): void;
  busy?: boolean;
}

export function WorkspaceDashboard({ workspaces, onAdd, onOpen, onRemove, onTogglePin, busy }: Props) {
  const [statuses, setStatuses] = useState<Record<string, GitStatus | null>>({});

  useEffect(() => {
    let active = true;
    Promise.all(workspaces.map(async (workspace) => [workspace.id, await api.git.status(workspace.path)] as const)).then((entries) => {
      if (!active) return;
      setStatuses(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [workspaces]);

  return (
    <div className="dashboard">
      <header className="hero">
        <div>
          <h1>StackDock</h1>
          <p>Local workspace dock for terminals, git, and quick edits.</p>
        </div>
        <button className="primary" onClick={onAdd} disabled={busy}>
          Add Workspace
        </button>
      </header>

      {workspaces.length === 0 ? (
        <div className="empty-state">
          <h2>No workspaces yet</h2>
          <p>Pick project folder to start.</p>
          <button className="primary" onClick={onAdd} disabled={busy}>
            Add Workspace
          </button>
        </div>
      ) : (
        <div className="workspace-grid">
          {workspaces.map((workspace) => (
            <article key={workspace.id} className="card">
              <div className="card-header">
                <div>
                  <h3>{workspace.name}</h3>
                  <p className="muted">{workspace.path}</p>
                </div>
                <button className="ghost" onClick={() => onTogglePin(workspace)} title="Pin workspace">
                  {workspace.pinned ? 'Unpin' : 'Pin'}
                </button>
              </div>
              <div className="card-meta">
                <span>Branch: {statuses[workspace.id]?.branch ?? '—'}</span>
                <span>Dirty: {statuses[workspace.id]?.files.length ?? 0}</span>
                <span>Created {new Date(workspace.createdAt).toLocaleDateString()}</span>
                {workspace.lastOpenedAt ? <span>Last open {new Date(workspace.lastOpenedAt).toLocaleDateString()}</span> : null}
              </div>
              <div className="card-actions">
                <button className="primary" onClick={() => onOpen(workspace.id)}>
                  Open
                </button>
                <button className="ghost" onClick={() => onRemove(workspace.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
