import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TerminalProfile, TerminalSplitSide, Workspace, WorkspaceTerminalSession } from '../../../../src/shared/types';
import { usePromptDialog } from '../../../../src/components/common/PromptProvider';

const LAST_PROFILE_KEY = 'stackdock.lastProfileId';

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeSessionId: string | null;
  highlightedSessionIds: string[];
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
  onSplitSession(id: string, side: TerminalSplitSide): void;
  onDetachSession(id: string): void;
}

export function GlobalSessionsSidebar({ workspaces, activeWorkspaceId, activeSessionId, highlightedSessionIds, sessions, profiles, defaultProfileId, emptySessionsVisible, showSessionCwdForAll, onCreateSession, onSelectSession, onOpenWorkspace, onCloseSession, onRenameSession, onRestartSession, onDuplicateSession, onSetCwd, onSplitSession, onDetachSession }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number; width: number } | null>(null);
  const [actionMenu, setActionMenu] = useState<{ session: WorkspaceTerminalSession; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState(() => localStorage.getItem(LAST_PROFILE_KEY) ?? defaultProfileId ?? profiles[0]?.id ?? 'powershell');
  const promptDialog = usePromptDialog();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const visibleWorkspaces = useMemo(() => workspaces.filter((workspace) => emptySessionsVisible || sessions.some((session) => session.workspaceId === workspace.id)), [emptySessionsVisible, sessions, workspaces]);
  const flatWorkspace = visibleWorkspaces.length <= 1 ? visibleWorkspaces[0] ?? workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null : null;
  const defaultProfile = profiles.find((profile) => profile.id === profileId) ?? profiles.find((profile) => profile.id === defaultProfileId) ?? profiles[0] ?? null;
  const loadedWorkspaces = visibleWorkspaces.length > 1 ? visibleWorkspaces : [];
  const filteredWorkspaces = useMemo(() => loadedWorkspaces.filter((workspace) => `${workspace.name} ${workspace.path}`.toLowerCase().includes(query.toLowerCase())), [query, loadedWorkspaces]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || createMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onResize = () => setMenuOpen(false);
    window.addEventListener('mousedown', handle);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', handle);
      window.removeEventListener('resize', onResize);
    };
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

  function toggleCreateMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    const width = Math.min(flatWorkspace ? 220 : 380, window.innerWidth - 16);
    const estimatedHeight = flatWorkspace ? Math.min(260, Math.max(52, (profiles.length || 1) * 36 + 20)) : Math.min(420, Math.max(180, filteredWorkspaces.length * 50 + 92));
    const anchorRight = rect?.right ?? window.innerWidth - 8;
    const anchorBottom = rect?.bottom ?? 40;
    const nextY = anchorBottom + 6;
    setMenuPosition({
      x: Math.min(Math.max(8, anchorRight - width), window.innerWidth - width - 8),
      y: Math.min(Math.max(8, nextY), Math.max(8, window.innerHeight - estimatedHeight - 8)),
      width,
    });
    setMenuOpen(true);
  }

  async function createWith(workspace: Workspace, nextProfileId = defaultProfile?.id ?? profileId) {
    setProfileId(nextProfileId);
    localStorage.setItem(LAST_PROFILE_KEY, nextProfileId);
    setMenuOpen(false);
    await onCreateSession(workspace, nextProfileId);
  }

  async function promptRename(session: WorkspaceTerminalSession) {
    const next = (await promptDialog.input({ title: 'Session name', defaultValue: session.name, confirmLabel: 'Rename' }))?.trim();
    if (next) void Promise.resolve(onRenameSession(session.id, next)).catch(() => undefined);
  }

  async function promptCwd(session: WorkspaceTerminalSession) {
    const next = (await promptDialog.input({ title: 'Working directory', defaultValue: session.cwd, confirmLabel: 'Restart' }))?.trim();
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
    const highlighted = highlightedSessionIds.includes(session.id);
    return (
      <div
        key={session.id}
        className={`global-session-card${active ? ' active' : ''}${highlighted ? ' attention' : ''}${draggingSessionId === session.id ? ' dragging' : ''}`}
        draggable
        onDragStart={(event) => {
          setDraggingSessionId(session.id);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-stackdock-session-id', session.id);
          event.dataTransfer.setData('text/plain', session.name);
        }}
        onDragEnd={() => setDraggingSessionId(null)}
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

  const createMenu = menuOpen && menuPosition ? createPortal(
    <div ref={createMenuRef} className="new-session-menu session-create-menu" role="menu" style={{ left: menuPosition.x, top: menuPosition.y, width: menuPosition.width }}>
      {flatWorkspace ? (
        <div className="profile-pick-list">
          {(profiles.length ? profiles : [{ id: profileId, name: defaultProfile?.name ?? profileId } as TerminalProfile]).map((profile) => (
            <button key={profile.id} className="new-session-item" onClick={() => void createWith(flatWorkspace, profile.id)}>{profile.name}</button>
          ))}
        </div>
      ) : (
        <>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workspace" />
          {profiles.length ? <div className="profile-pills">{profiles.map((profile) => <button key={profile.id} className={profile.id === (defaultProfile?.id ?? profileId) ? 'ghost active-toggle' : 'ghost'} onClick={() => setProfileId(profile.id)}>{profile.name}</button>)}</div> : null}
          <div className="workspace-pick-list">
            {filteredWorkspaces.map((workspace) => <button key={workspace.id} className="workspace-pick" onClick={() => void createWith(workspace, defaultProfile?.id ?? profileId)}><strong>{workspace.name}</strong><small>{workspace.path}</small></button>)}
          </div>
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <aside className="global-sessions-sidebar">
      <div className="panel-title sessions-title">
        <span>Sessions</span>
        <div className="new-session" ref={menuRef}>
          <button className="new-session-main" onClick={() => flatWorkspace ? void createWith(flatWorkspace) : toggleCreateMenu()}>New</button>
          <button className="new-session-caret" aria-label="Choose terminal target" aria-haspopup="menu" aria-expanded={menuOpen} onClick={toggleCreateMenu}>▾</button>
          {createMenu}
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
          <button className="context-menu-item" onClick={() => runAction(() => onSplitSession(actionMenu.session.id, 'right'))}>Split Right</button>
          <button className="context-menu-item" onClick={() => runAction(() => onSplitSession(actionMenu.session.id, 'down'))}>Split Down</button>
          {actionMenu.session.splitGroupId ? <button className="context-menu-item" onClick={() => runAction(() => onDetachSession(actionMenu.session.id))}>Detach from Split</button> : null}
          <button className="context-menu-item danger" onClick={() => runAction(() => onCloseSession(actionMenu.session.id))}>Close</button>
        </div>
      ) : null}
    </aside>
  );
}
