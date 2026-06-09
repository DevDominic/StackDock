import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceTerminalSession } from '../../shared/types';

interface Props {
  open: boolean;
  sessions: WorkspaceTerminalSession[];
  activeSessionId: string | null;
  onSelect(id: string): void;
  onClose(): void;
}

// Quick session switcher (Ctrl+P): fuzzy-ish substring search across every
// active terminal session — filter by typing, move with the arrow keys, and
// Enter (or click) to switch to that session.
export function SessionSwitcher({ open, sessions, activeSessionId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      [session.name, session.workspaceName, session.cwd].some((field) => field?.toLowerCase().includes(needle)),
    );
  }, [sessions, query]);

  // When the switcher opens, start the highlight on the current session so a
  // bare Enter is a no-op rather than a surprise jump.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const current = sessions.findIndex((session) => session.id === activeSessionId);
    setIndex(current >= 0 ? current : 0);
  }, [open]);

  useEffect(() => { setIndex((value) => Math.min(value, Math.max(0, filtered.length - 1))); }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, filtered.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
      if (event.key === 'Enter') { event.preventDefault(); const session = filtered[index]; if (session) { onSelect(session.id); onClose(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, index, onSelect, onClose, open]);

  // Keep the highlighted row scrolled into view as the selection moves.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.launcher-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="launcher" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder="Switch session" />
        <div className="launcher-list" ref={listRef}>
          {filtered.length ? filtered.map((session, itemIndex) => (
            <button
              key={session.id}
              className={itemIndex === index ? 'launcher-item active' : 'launcher-item'}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => { onSelect(session.id); onClose(); }}
            >
              <span>
                {session.name}
                {session.id === activeSessionId ? <small className="session-switcher-current"> current</small> : null}
              </span>
              <small>{session.workspaceName} · {session.cwd}</small>
            </button>
          )) : (
            <div className="launcher-empty muted">No matching sessions</div>
          )}
        </div>
      </div>
    </div>
  );
}
