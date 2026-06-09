import { useEffect, useMemo, useState } from 'react';
import {
  mdiCog,
  mdiContentCopy,
  mdiFolderOpenOutline,
  mdiFolderPlusOutline,
  mdiLayersTripleOutline,
  mdiMagnify,
  mdiPencilOutline,
  mdiPin,
  mdiPinOutline,
  mdiPlus,
  mdiSourceBranch,
  mdiTrashCanOutline,
} from '@mdi/js';
import { api } from '../../lib/api';
import { SettingsModal } from '../workspace/SettingsModal';
import { applyTheme } from '../../lib/themeSupport';
import type { GitStatus, StackDockSettings, Workspace } from '../../shared/types';

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
  settings?: StackDockSettings | null;
  onSettingsApplied?(settings: StackDockSettings): void;
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function initialOf(name: string) {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

export function WorkspaceDashboard({ workspaces, onAdd, onCreate, onOpen, onRemove, onUpdate, onDuplicate, onTogglePin, busy, settings: appSettings, onSettingsApplied }: Props) {
  const [statuses, setStatuses] = useState<Record<string, GitStatus | null>>({});
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [settings, setSettings] = useState<StackDockSettings | null>(appSettings ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle ? workspaces.filter((workspace) => `${workspace.name} ${workspace.path}`.toLowerCase().includes(needle)) : workspaces;
    // Pinned first, then most-recently opened, then alphabetical.
    return [...matches].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const at = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
      const bt = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name);
    });
  }, [query, workspaces]);

  useEffect(() => {
    if (appSettings) setSettings(appSettings);
  }, [appSettings]);

  useEffect(() => {
    if (appSettings) return;
    let active = true;
    api.settings.load().then((loaded) => { if (active) { setSettings(loaded); applyTheme(loaded.themeId, loaded.importedThemes); } }).catch(() => {});
    return () => { active = false; };
  }, [appSettings]);

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
        <div className="brand">
          <div className="brand-mark"><Icon path={mdiLayersTripleOutline} /></div>
          <div className="brand-text">
            <h1>StackDock</h1>
            <p>Local workspace dock for terminals, git, and quick edits.</p>
          </div>
        </div>
        <div className="hero-actions">
          <button className="ghost icon-text" onClick={() => setSettingsOpen(true)} disabled={!settings} title="Settings"><Icon path={mdiCog} /> Settings</button>
          <button className="ghost icon-text" onClick={onCreate} disabled={busy}><Icon path={mdiPlus} /> Create</button>
          <button className="primary icon-text" onClick={onAdd} disabled={busy}><Icon path={mdiFolderPlusOutline} /> Add Workspace</button>
        </div>
      </header>

      <div className="search-wrap">
        <Icon path={mdiMagnify} className="search-icon" />
        <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces by name or path" />
      </div>

      {workspaces.length === 0 ? (
        <div className="empty-state">
          <div className="brand-mark"><Icon path={mdiLayersTripleOutline} /></div>
          <h2>No workspaces yet</h2>
          <p className="muted">Add a project folder to start docking your terminals, git, and edits.</p>
          <button className="primary icon-text" onClick={onAdd} disabled={busy}><Icon path={mdiFolderPlusOutline} /> Add Workspace</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h2>No matching workspaces</h2>
          <p className="muted">Try a different search.</p>
        </div>
      ) : (
        <div className="workspace-grid">
          {filtered.map((workspace) => {
            const status = statuses[workspace.id];
            const changeCount = status?.files.length ?? 0;
            const when = workspace.lastOpenedAt ? `Opened ${new Date(workspace.lastOpenedAt).toLocaleDateString()}` : `Created ${new Date(workspace.createdAt).toLocaleDateString()}`;
            return (
              <article key={workspace.id} className={`ws-card${workspace.pinned ? ' pinned' : ''}`} onDoubleClick={() => onOpen(workspace.id)}>
                <div className="ws-card-top">
                  <div className="ws-avatar">{initialOf(workspace.name)}</div>
                  <div className="ws-id">
                    <h3 className="ws-title" title={workspace.name}>{workspace.name}</h3>
                    <p className="ws-path muted" title={workspace.path}>{workspace.path}</p>
                  </div>
                  <button className={`icon-btn pin-btn${workspace.pinned ? ' active' : ''}`} onClick={() => onTogglePin(workspace)} title={workspace.pinned ? 'Unpin workspace' : 'Pin workspace'}>
                    <Icon path={workspace.pinned ? mdiPin : mdiPinOutline} />
                  </button>
                </div>
                <div className="ws-chips">
                  <span className="chip"><Icon path={mdiSourceBranch} /> {status?.branch ?? '—'}</span>
                  <span className={`chip${changeCount ? ' dirty' : ''}`}>{changeCount ? `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}` : 'Clean'}</span>
                  <span className="chip subtle">{when}</span>
                </div>
                <div className="ws-actions">
                  <button className="primary" onClick={() => onOpen(workspace.id)}>Open</button>
                  <button className="icon-btn" title="Open folder" onClick={() => api.fs.revealInExplorer(workspace.path)}><Icon path={mdiFolderOpenOutline} /></button>
                  <button className="icon-btn" title="Edit" onClick={() => setEditing(workspace)}><Icon path={mdiPencilOutline} /></button>
                  <button className="icon-btn" title="Duplicate" onClick={() => onDuplicate(workspace)}><Icon path={mdiContentCopy} /></button>
                  <button className="icon-btn danger" title="Remove" onClick={() => { if (window.confirm(`Remove ${workspace.name} from StackDock? Files stay on disk.`)) onRemove(workspace.id); }}><Icon path={mdiTrashCanOutline} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing ? <EditModal workspace={editing} onClose={() => setEditing(null)} onSave={(workspace) => { onUpdate(workspace); setEditing(null); }} /> : null}
      {settingsOpen && settings ? (
        <SettingsModal
          settings={settings}
          currentWorkspaceId=""
          onSave={async (next) => { const saved = await api.settings.save(next); setSettings(saved); applyTheme(saved.themeId, saved.importedThemes); onSettingsApplied?.(saved); }}
          onAutomationSaved={() => {}}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
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
