import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace, WorkspaceTerminalSession } from '../../shared/types';

interface Props {
  open: boolean;
  sessions: WorkspaceTerminalSession[];
  workspaces: Workspace[];
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  onSelect(id: string): void;
  onOpenWorkspace(id: string): Promise<void>;
  onPickWorkspace(): Promise<boolean>;
  onClose(): void;
}

type SwitcherMode = 'sessions' | 'workspaces';
type SessionItem = { kind: 'session'; session: WorkspaceTerminalSession } | { kind: 'open-workspaces' };
type WorkspaceItem = { kind: 'workspace'; workspace: Workspace } | { kind: 'pick-workspace' };

// Quick session switcher (Ctrl+P): fuzzy-ish substring search across every
// active terminal session — filter by typing, move with the arrow keys, and
// Enter (or click) to switch to that session.
export function SessionSwitcher({ open, sessions, workspaces, activeSessionId, activeWorkspaceId, onSelect, onOpenWorkspace, onPickWorkspace, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<SwitcherMode>('sessions');
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      [session.name, session.workspaceName, session.cwd].some((field) => field?.toLowerCase().includes(needle)),
    );
  }, [sessions, query]);

  const filteredWorkspaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...workspaces].sort((a, b) => {
      if (a.id === activeWorkspaceId) return -1;
      if (b.id === activeWorkspaceId) return 1;
      return new Date(b.lastOpenedAt ?? b.createdAt).getTime() - new Date(a.lastOpenedAt ?? a.createdAt).getTime();
    });
    if (!needle) return sorted;
    return sorted.filter((workspace) => [workspace.name, workspace.path].some((field) => field.toLowerCase().includes(needle)));
  }, [activeWorkspaceId, query, workspaces]);

  const sessionItems = useMemo<SessionItem[]>(() => [...filteredSessions.map((session) => ({ kind: 'session' as const, session })), { kind: 'open-workspaces' }], [filteredSessions]);
  const workspaceItems = useMemo<WorkspaceItem[]>(() => [...filteredWorkspaces.map((workspace) => ({ kind: 'workspace' as const, workspace })), { kind: 'pick-workspace' }], [filteredWorkspaces]);
  const itemCount = mode === 'sessions' ? sessionItems.length : workspaceItems.length;

  // When the switcher opens, start the highlight on the current session so a
  // bare Enter is a no-op rather than a surprise jump.
  useEffect(() => {
    if (!open) return;
    setMode('sessions');
    setQuery('');
    const current = sessions.findIndex((session) => session.id === activeSessionId);
    setIndex(current >= 0 ? current : 0);
  }, [open]);

  useEffect(() => { setIndex((value) => Math.min(value, Math.max(0, itemCount - 1))); }, [itemCount]);

  function showWorkspaces() {
    setMode('workspaces');
    setQuery('');
    setIndex(0);
  }

  function backToSessions() {
    setMode('sessions');
    setQuery('');
    const current = sessions.findIndex((session) => session.id === activeSessionId);
    setIndex(current >= 0 ? current : 0);
  }

  async function pickWorkspace() {
    if (openingWorkspace) return;
    setOpeningWorkspace(true);
    try {
      if (await onPickWorkspace()) onClose();
    } finally {
      setOpeningWorkspace(false);
    }
  }

  async function selectWorkspace(id: string) {
    await onOpenWorkspace(id);
    onClose();
  }

  function activateCurrent() {
    if (mode === 'sessions') {
      const item = sessionItems[index];
      if (!item) return;
      if (item.kind === 'open-workspaces') { showWorkspaces(); return; }
      onSelect(item.session.id);
      onClose();
      return;
    }
    const item = workspaceItems[index];
    if (!item) return;
    if (item.kind === 'pick-workspace') { void pickWorkspace(); return; }
    void selectWorkspace(item.workspace.id);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mode === 'workspaces') backToSessions();
        else onClose();
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, itemCount - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
      if (event.key === 'Enter') { event.preventDefault(); activateCurrent(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSessionId, index, itemCount, mode, onClose, open, sessionItems, workspaceItems]);

  // Keep the highlighted row scrolled into view as the selection moves.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.launcher-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="launcher" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder={mode === 'sessions' ? 'Switch session' : 'Open workspace'} />
        <div className="launcher-list" ref={listRef}>
          {mode === 'sessions' ? sessionItems.map((item, itemIndex) => item.kind === 'session' ? (
            <button
              key={item.session.id}
              className={itemIndex === index ? 'launcher-item active' : 'launcher-item'}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => { onSelect(item.session.id); onClose(); }}
            >
              <span>
                {item.session.name}
                {item.session.id === activeSessionId ? <small className="session-switcher-current"> current</small> : null}
              </span>
              <small>{item.session.workspaceName} · {item.session.cwd}</small>
            </button>
          ) : (
            <button
              key="open-workspaces"
              className={itemIndex === index ? 'launcher-item active' : 'launcher-item'}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={showWorkspaces}
            >
              <span>Open Workspace…</span>
              <small>Show workspaces</small>
            </button>
          )) : workspaceItems.map((item, itemIndex) => item.kind === 'workspace' ? (
            <button
              key={item.workspace.id}
              className={itemIndex === index ? 'launcher-item active' : 'launcher-item'}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => void selectWorkspace(item.workspace.id)}
            >
              <span>
                {item.workspace.name}
                {item.workspace.id === activeWorkspaceId ? <small className="session-switcher-current"> current</small> : null}
              </span>
              <small>{item.workspace.path}</small>
            </button>
          ) : (
            <button
              key="pick-workspace"
              className={itemIndex === index ? 'launcher-item active' : 'launcher-item'}
              disabled={openingWorkspace}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => void pickWorkspace()}
            >
              <span>{openingWorkspace ? 'Opening…' : 'Choose Workspace Folder…'}</span>
              <small>Pick folder from disk</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
