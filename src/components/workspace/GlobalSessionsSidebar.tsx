import type { Workspace, WorkspaceTerminalSession } from '../../shared/types';

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeSessionId: string | null;
  sessions: WorkspaceTerminalSession[];
  emptySessionsVisible: boolean;
  onSelectSession(id: string): void;
  onOpenWorkspace(id: string): void;
  onCloseSession(id: string): void;
}

export function GlobalSessionsSidebar({ workspaces, activeWorkspaceId, activeSessionId, sessions, emptySessionsVisible, onSelectSession, onOpenWorkspace, onCloseSession }: Props) {
  return (
    <aside className="global-sessions-sidebar">
      <div className="panel-title">Sessions</div>
      <div className="global-session-list">
        {workspaces.map((workspace) => {
          const group = sessions.filter((session) => session.workspaceId === workspace.id);
          if (!group.length && !emptySessionsVisible) return null;
          return (
            <div className={workspace.id === activeWorkspaceId ? 'global-workspace active' : 'global-workspace'} key={workspace.id}>
              <button className="global-workspace-title" onClick={() => onOpenWorkspace(workspace.id)}><span>{workspace.name}</span><small>{group.length}</small></button>
              {group.length ? group.map((session) => (
                <button key={session.id} className={session.id === activeSessionId ? 'global-session active' : 'global-session'} onClick={() => onSelectSession(session.id)}>
                  <span>{session.name}</span><span className="tab-close" onClick={(event) => { event.stopPropagation(); onCloseSession(session.id); }}>×</span>
                </button>
              )) : <div className="muted global-empty">No sessions</div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
