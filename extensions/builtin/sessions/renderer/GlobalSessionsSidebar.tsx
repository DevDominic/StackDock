import { useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalProfile, Workspace, WorkspaceTerminalSession } from '../../../../src/shared/types';

const LAST_PROFILE_KEY = 'stackdock.lastProfileId';

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeSessionId: string | null;
  sessions: WorkspaceTerminalSession[];
  profiles: TerminalProfile[];
  defaultProfileId?: string;
  emptySessionsVisible: boolean;
  showSessionCwdForAll: boolean;
  onCreateSession(workspace: Workspace, profileId: string): Promise<void>;
  onSelectSession(id: string): void;
  onOpenWorkspace(id: string): void;
  onCloseSession(id: string): void;
  onRenameSession(id: string, name: string): void;
  onRestartSession(id: string): void;
  onDuplicateSession(id: string): void;
  onSetCwd(id: string, cwd: string): void;
  onSplitSession(id: string, direction: 'row' | 'column'): void;
}

export function GlobalSessionsSidebar({ workspaces, activeWorkspaceId, activeSessionId, sessions, profiles, defaultProfileId, emptySessionsVisible, showSessionCwdForAll, onCreateSession, onSelectSession, onOpenWorkspace, onCloseSession, onRenameSession, onRestartSession, onDuplicateSession, onSetCwd, onSplitSession }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<{ session: WorkspaceTerminalSession; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [profileId, setProfileId] = useState(() => localStorage.getItem(LAST_PROFILE_KEY) ?? defaultProfileId ?? profiles[0]?.id ?? 'powershell');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const visibleWorkspaces = useMemo(() => workspaces.filter((workspace) => emptySessionsVisible || sessions.some((session) => session.workspaceId === workspace.id)), [emptySessionsVisible, sessions, workspaces]);
  const flatWorkspace = visibleWorkspaces.length <= 1 ? visibleWorkspaces[0] ?? workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null : null;
  const defaultProfile = profiles.find((profile) => profile.id === profileId) ?? profiles.find((profile) => profile.id === defaultProfileId) ?? profiles[0] ?? null;
  const filteredWorkspaces = useMemo(() => workspaces.filter((workspace) => `${workspace.name} ${workspace.path}`.toLowerCase().includes(query.toLowerCase())), [query, workspaces]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  useEffect(() => {
    if (!actionMenu) return;
    const close = (event: MouseEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) return;
      setActionMenu(null);
    };
    const onResize = () => setActionMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setActionMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [actionMenu]);

  async function createWith(workspace: Workspace, nextProfileId = defaultProfile?.id ?? profileId) {
    setProfileId(nextProfileId);
    localStorage.setItem(LAST_PROFILE_KEY, nextProfileId);
    setMenuOpen(false);
    await onCreateSession(workspace, nextProfileId);
  }

  function promptRename(session: WorkspaceTerminalSession) {
    const next = window.prompt('Session name', session.name)?.trim();
    if (next) onRenameSession(session.id, next);
  }

  function promptCwd(session: WorkspaceTerminalSession) {
    const next = window.prompt('CWD', session.cwd)?.trim();
    if (next) onSetCwd(session.id, next);
  }

  function openActionMenu(session: WorkspaceTerminalSession, x: number, y: number) {
    const menuWidth = 190;
    const menuHeight = 250;
    setActionMenu({
      session,
      x: Math.min(Math.max(8, x), window.innerWidth - menuWidth - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - menuHeight - 8),
    });
  }

  function runAction(action: () => void) {
    setActionMenu(null);
    action();
  }

  function renderSession(session: WorkspaceTerminalSession, index: number) {
    const active = session.id === activeSessionId;
    return (
      <div
        key={session.id}
        className={active ? 'global-session-card active' : 'global-session-card'}
        onContextMenu={(event) => { event.preventDefault(); openActionMenu(session, event.clientX, event.clientY); }}
      >
        <div className="global-session-row">
          <button className="global-session-main" title={session.cwd} onClick={() => onSelectSession(session.id)} onDoubleClick={() => promptRename(session)}>
            <span className="session-index">{index + 1}</span>
            <span className="global-session-copy">
              <span className="session-name">{session.name}</span>
              {showSessionCwdForAll || active ? <small>{session.cwd}</small> : null}
            </span>
          </button>
          <button
            className="session-more"
            aria-label={`${session.name} actions`}
            title="Session actions"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openActionMenu(session, rect.left, rect.bottom + 4);
            }}
          >
            ⋯
          </button>
        </div>
      </div>
    );
  }

  function renderFlatSessions() {
    if (!flatWorkspace) return null;
    const group = sessions.filter((session) => session.workspaceId === flatWorkspace.id);
    if (!group.length) return <div className="muted global-empty">No sessions</div>;
    return group.map(renderSession);
  }

  return (
    <aside className="global-sessions-sidebar">
      <div className="panel-title sessions-title">
        <span>Sessions</span>
        <div className="new-session" ref={menuRef}>
          <button className="new-session-main" onClick={() => flatWorkspace ? void createWith(flatWorkspace) : setMenuOpen((open) => !open)}>New</button>
          <button className="new-session-caret" aria-label="Choose terminal target" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>▾</button>
          {menuOpen ? (
            <div className="new-session-menu session-create-menu" role="menu">
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workspace" />
              {profiles.length ? <div className="profile-pills">{profiles.map((profile) => <button key={profile.id} className={profile.id === (defaultProfile?.id ?? profileId) ? 'ghost active-toggle' : 'ghost'} onClick={() => setProfileId(profile.id)}>{profile.name}</button>)}</div> : null}
              <div className="workspace-pick-list">
                {filteredWorkspaces.map((workspace) => <button key={workspace.id} className="workspace-pick" onClick={() => void createWith(workspace, defaultProfile?.id ?? profileId)}><strong>{workspace.name}</strong><small>{workspace.path}</small></button>)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="global-session-list">
        {flatWorkspace ? renderFlatSessions() : visibleWorkspaces.map((workspace) => {
          const group = sessions.filter((session) => session.workspaceId === workspace.id);
          if (!group.length && !emptySessionsVisible) return null;
          return (
            <div className={workspace.id === activeWorkspaceId ? 'global-workspace active' : 'global-workspace'} key={workspace.id}>
              <button className="global-workspace-title" onClick={() => onOpenWorkspace(workspace.id)}>
                <span>{workspace.name}</span>
                <small>{group.length}</small>
              </button>
              <div className="global-workspace-children">
                {group.length ? group.map(renderSession) : <div className="muted global-empty">No sessions</div>}
              </div>
            </div>
          );
        })}
      </div>
      {actionMenu ? (
        <div ref={actionMenuRef} className="context-menu session-context-menu" style={{ left: actionMenu.x, top: actionMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button className="context-menu-item" onClick={() => runAction(() => promptRename(actionMenu.session))}>Rename</button>
          <button className="context-menu-item" onClick={() => runAction(() => onRestartSession(actionMenu.session.id))}>Restart</button>
          <button className="context-menu-item" onClick={() => runAction(() => onDuplicateSession(actionMenu.session.id))}>Duplicate</button>
          <button className="context-menu-item" onClick={() => runAction(() => promptCwd(actionMenu.session))}>Change CWD</button>
          <button className="context-menu-item" onClick={() => runAction(() => onSplitSession(actionMenu.session.id, 'row'))}>Split Right</button>
          <button className="context-menu-item" onClick={() => runAction(() => onSplitSession(actionMenu.session.id, 'column'))}>Split Down</button>
          <button className="context-menu-item danger" onClick={() => runAction(() => onCloseSession(actionMenu.session.id))}>Close</button>
        </div>
      ) : null}
    </aside>
  );
}
