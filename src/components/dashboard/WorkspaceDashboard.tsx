import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import type { GitStatus, Workspace } from '../../shared/types';

interface Props {
  workspaces: Workspace[];
  onAdd(): void;
  onCreate(): void;
  onOpen(id: string): void;
  onRemove(id: string): void;
  onUpdate(workspace: Workspace): void;
  onDuplicate(workspace: Workspace): void;
  onTogglePin(workspace: Workspace): void;
  busy?: boolean;
}

export function WorkspaceDashboard({ workspaces, onAdd, onCreate, onOpen, onRemove, onUpdate, onDuplicate, onTogglePin, busy }: Props) {
  const [statuses, setStatuses] = useState<Record<string, GitStatus | null>>({});
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Workspace | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? workspaces.filter((workspace) => `${workspace.name} ${workspace.path}`.toLowerCase().includes(needle)) : workspaces;
  }, [query, workspaces]);

  useEffect(() => {
    let active = true;
    Promise.all(workspaces.map(async (workspace) => [workspace.id, await api.git.status(workspace.path).catch(() => null)] as const)).then((entries) => {
      if (!active) return;
      setStatuses(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [workspaces]);

  return (
    <div className="dashboard">
      <header className="hero">
        <div><h1>StackDock</h1><p>Local workspace dock for terminals, git, and quick edits.</p></div>
        <div className="row"><button className="ghost" onClick={onCreate} disabled={busy}>Create Workspace</button><button className="primary" onClick={onAdd} disabled={busy}>Add Workspace</button></div>
      </header>
      <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces" />

      {workspaces.length === 0 ? (
        <div className="empty-state"><h2>No workspaces yet</h2><p>Pick project folder to start.</p><button className="primary" onClick={onAdd} disabled={busy}>Add Workspace</button></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><h2>No matching workspaces.</h2></div>
      ) : (
        <div className="workspace-grid">
          {filtered.map((workspace) => (
            <article key={workspace.id} className="card">
              <div className="card-header">
                <div><h3>{workspace.name}</h3><p className="muted">{workspace.path}</p></div>
                <button className="ghost" onClick={() => onTogglePin(workspace)} title="Pin workspace">{workspace.pinned ? 'Unpin' : 'Pin'}</button>
              </div>
              <div className="card-meta">
                <span>Branch: {statuses[workspace.id]?.branch ?? '—'}</span><span>Dirty: {statuses[workspace.id]?.files.length ?? 0}</span><span>Created {new Date(workspace.createdAt).toLocaleDateString()}</span>{workspace.lastOpenedAt ? <span>Last open {new Date(workspace.lastOpenedAt).toLocaleDateString()}</span> : null}
              </div>
              <div className="card-actions">
                <button className="primary" onClick={() => onOpen(workspace.id)}>Open</button>
                <button className="ghost" onClick={() => api.fs.revealInExplorer(workspace.path)}>Open Folder</button>
                <button className="ghost" onClick={() => setEditing(workspace)}>Edit</button>
                <button className="ghost" onClick={() => onDuplicate(workspace)}>Duplicate</button>
                <button className="ghost" onClick={() => { if (window.confirm(`Remove ${workspace.name} from StackDock? Files stay on disk.`)) onRemove(workspace.id); }}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing ? <EditModal workspace={editing} onClose={() => setEditing(null)} onSave={(workspace) => { onUpdate(workspace); setEditing(null); }} /> : null}
    </div>
  );
}

function EditModal({ workspace, onSave, onClose }: { workspace: Workspace; onSave(workspace: Workspace): void; onClose(): void }) {
  const [name, setName] = useState(workspace.name);
  const [path, setPath] = useState(workspace.path);
  const [pinned, setPinned] = useState(!!workspace.pinned);
  const valid = name.trim() && path.trim();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal edit-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title row"><span>Edit workspace</span><button className="ghost" onClick={onClose}>×</button></div>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Path<input value={path} onChange={(event) => setPath(event.target.value)} /></label>
        <label><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> Pinned</label>
        <div className="modal-actions"><button className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!valid} onClick={() => onSave({ ...workspace, name: name.trim(), path: path.trim(), pinned })}>Save</button></div>
      </div>
    </div>
  );
}
