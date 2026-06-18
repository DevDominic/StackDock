import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryEntry, WorkspaceTerminalSession } from '../../shared/types';
import { api } from '../../lib/api';

interface Props {
  open: boolean;
  sessions: WorkspaceTerminalSession[];
  activeSessionId: string | null;
  onSelect(id: string): void;
  onOpenFile(path: string): void;
  onClose(): void;
}

type SessionItem = { kind: 'session'; session: WorkspaceTerminalSession };
type FileItem = { kind: 'file'; entry: DirectoryEntry };
type SwitcherItem = SessionItem | FileItem;

const MAX_FILE_RESULTS = 200;

function matchesFile(entry: DirectoryEntry, query: string) {
  return `${entry.name} ${entry.path}`.toLowerCase().includes(query);
}

function relativePath(rootPath: string, path: string) {
  return path.slice(rootPath.length).replace(/^[\\/]/, '');
}

// Quick open (Ctrl+P): blank input switches terminal sessions; typing searches
// files under the active session's current folder/workspace and opens Enter hit.
export function SessionSwitcher({ open, sessions, activeSessionId, onSelect, onOpenFile, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [fileResults, setFileResults] = useState<DirectoryEntry[]>([]);
  const [searchingFiles, setSearchingFiles] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null, [activeSessionId, sessions]);
  const fileRoot = activeSession?.cwd || activeSession?.workspacePath || '';
  const normalizedQuery = query.trim().toLowerCase();

  const filteredSessions = useMemo(() => {
    if (normalizedQuery) return [];
    return sessions;
  }, [normalizedQuery, sessions]);

  const items = useMemo<SwitcherItem[]>(() => (
    normalizedQuery
      ? fileResults.map((entry) => ({ kind: 'file' as const, entry }))
      : filteredSessions.map((session) => ({ kind: 'session' as const, session }))
  ), [fileResults, filteredSessions, normalizedQuery]);

  // When switcher opens, highlight current session so bare Enter is no-op-ish.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFileResults([]);
    setSearchingFiles(false);
    const current = sessions.findIndex((session) => session.id === activeSessionId);
    setIndex(current >= 0 ? current : 0);
  }, [activeSessionId, open, sessions]);

  useEffect(() => { setIndex((value) => Math.min(value, Math.max(0, items.length - 1))); }, [items.length]);

  useEffect(() => {
    if (!open || !normalizedQuery || !fileRoot) {
      setFileResults([]);
      setSearchingFiles(false);
      return;
    }
    let cancelled = false;
    setSearchingFiles(true);
    const timer = window.setTimeout(async () => {
      const results: DirectoryEntry[] = [];
      const visit = async (folder: string, depth = 0) => {
        if (cancelled || results.length >= MAX_FILE_RESULTS || depth > 10) return;
        let entries: DirectoryEntry[] = [];
        try { entries = await api.fs.readDirectory(folder); } catch { return; }
        for (const entry of entries) {
          if (entry.isFile && matchesFile(entry, normalizedQuery)) results.push(entry);
          if (entry.isDirectory) await visit(entry.path, depth + 1);
          if (cancelled || results.length >= MAX_FILE_RESULTS) break;
        }
      };
      await visit(fileRoot);
      if (!cancelled) { setFileResults(results); setSearchingFiles(false); }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [fileRoot, normalizedQuery, open]);

  function activateCurrent() {
    const item = items[index];
    if (!item) return;
    if (item.kind === 'session') onSelect(item.session.id);
    else onOpenFile(item.entry.path);
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, items.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
      if (event.key === 'Enter') { event.preventDefault(); activateCurrent(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onClose, open]);

  // Keep highlighted row visible as selection moves.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.launcher-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="launcher" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder="Switch session or type file name" />
        <div className="launcher-list" ref={listRef}>
          {normalizedQuery ? (
            <>
              {searchingFiles ? <div className="muted pad">Searching files...</div> : null}
              {!searchingFiles && !items.length ? <div className="muted pad">No matching files in active session.</div> : null}
              {items.map((item, itemIndex) => item.kind === 'file' ? (
                <button
                  key={item.entry.path}
                  className={itemIndex === index ? 'launcher-item active' : 'launcher-item'}
                  onMouseEnter={() => setIndex(itemIndex)}
                  onClick={() => { onOpenFile(item.entry.path); onClose(); }}
                >
                  <span>{item.entry.name}</span>
                  <small>{relativePath(fileRoot, item.entry.path)}</small>
                </button>
              ) : null)}
            </>
          ) : items.map((item, itemIndex) => item.kind === 'session' ? (
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
          ) : null)}
        </div>
      </div>
    </div>
  );
}
