import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';

const FILE_TREE_REFRESH_DEBOUNCE_MS = 500;
import type { DirectoryEntry, GitFileStatus } from '../../../../src/shared/types';
import { api } from '../../../../src/lib/api';
import { FileIcon } from '../../../../src/components/workspace/fileIcons';
import { usePromptDialog } from '../../../../src/components/common/PromptProvider';

interface Props {
  rootPath: string;
  gitFiles: GitFileStatus[];
  canAddToContext?: boolean;
  onOpenFile(path: string): void;
  onPreviewFile(path: string): void;
  onOpenTerminalHere(path: string): void;
  onAddPathToContext(path: string): void | Promise<void>;
  onDeletedPath(path: string): void | Promise<void>;
  refreshToken: number;
}

interface GitDecoration { letter: string; cls: string }
type GitLookup = (entry: DirectoryEntry) => GitDecoration | null;
type IgnoredLookup = (entry: DirectoryEntry) => boolean;

const EXPLORER_PATH_MIME = 'application/x-stackdock-explorer-path';
const MAX_SEARCH_RESULTS = 200;

interface ContextTarget { entry: DirectoryEntry | null; entries?: DirectoryEntry[]; x: number; y: number; }
interface NodeProps {
  entry: DirectoryEntry;
  depth: number;
  version: number;
  gitLookup: GitLookup;
  ignoredLookup: IgnoredLookup;
  onOpenFile(path: string): void;
  selectedPaths: Set<string>;
  onSelectEntry(entry: DirectoryEntry, event: MouseEvent<HTMLButtonElement>, groupEntries: DirectoryEntry[]): boolean;
  getDragEntries(entry: DirectoryEntry): DirectoryEntry[];
  onMoveEntries(entries: DirectoryEntry[], targetFolder: string): Promise<void>;
  onContextMenu(target: ContextTarget): void;
  loadChildren(path: string): Promise<DirectoryEntry[]>;
}

function joinPath(base: string, name: string) { return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`; }
function parentPath(path: string) { return path.replace(/[\\/][^\\/]+$/, ''); }
function normalizePath(p: string) { return p.replace(/\\/g, '/').replace(/\/+$/, ''); }
function isHtmlFile(path: string) { return /\.html?$/i.test(path); }
function matchesSearch(entry: DirectoryEntry, query: string) { return `${entry.name} ${entry.path}`.toLowerCase().includes(query); }
function describeEntries(entries: DirectoryEntry[]) { return `${entries.length} selected ${entries.length === 1 ? 'item' : 'items'}`; }
function dragPayload(entries: DirectoryEntry[]) { return JSON.stringify({ entries: entries.map((entry) => ({ path: entry.path, name: entry.name, isDirectory: entry.isDirectory, isFile: entry.isFile, hidden: entry.hidden })) }); }
function entriesFromDrag(event: DragEvent) {
  const raw = event.dataTransfer.getData(EXPLORER_PATH_MIME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: DirectoryEntry[]; path?: string; isDirectory?: boolean };
    if (Array.isArray(parsed.entries)) return parsed.entries.filter((entry) => typeof entry.path === 'string' && typeof entry.name === 'string');
    if (typeof parsed.path === 'string') return [{ path: parsed.path, name: parsed.path.split(/[\\/]/).pop() ?? parsed.path, isDirectory: parsed.isDirectory === true, isFile: parsed.isDirectory !== true, hidden: false }];
  } catch {
    return [];
  }
  return [];
}

function decorateGit(file: GitFileStatus): GitDecoration {
  if (file.untracked) return { letter: 'U', cls: 'git-untracked' };
  const code = (file.worktreeStatus.trim() || file.indexStatus.trim() || 'M').toUpperCase();
  if (code === 'A') return { letter: 'A', cls: 'git-added' };
  if (code === 'D') return { letter: 'D', cls: 'git-deleted' };
  return { letter: code === 'R' ? 'R' : 'M', cls: 'git-modified' };
}

function buildGitLookup(rootPath: string, gitFiles: GitFileStatus[]): GitLookup {
  const root = normalizePath(rootPath).toLowerCase();
  const entries = gitFiles.map((file) => ({ rel: normalizePath(file.path).toLowerCase(), file }));
  return (entry) => {
    const abs = normalizePath(entry.path).toLowerCase();
    if (!abs.startsWith(`${root}/`)) return null;
    const rel = abs.slice(root.length + 1);
    if (entry.isDirectory) {
      return entries.some((item) => item.rel === rel || item.rel.startsWith(`${rel}/`)) ? { letter: '', cls: 'git-dir' } : null;
    }
    const match = entries.find((item) => item.rel === rel);
    return match ? decorateGit(match.file) : null;
  };
}

function FileNode({ entry, depth, version, gitLookup, ignoredLookup, onOpenFile, selectedPaths, onSelectEntry, getDragEntries, onMoveEntries, onContextMenu, loadChildren }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirectoryEntry[] | null>(null);

  useEffect(() => {
    if (!expanded) {
      setChildren(null);
      return;
    }
    let active = true;
    loadChildren(entry.path).then((items) => { if (active) setChildren(items); });
    return () => { active = false; };
  }, [version, expanded, entry.path, loadChildren]);

  const toggle = async (event: MouseEvent<HTMLButtonElement>) => {
    if (onSelectEntry(entry, event, children ?? [])) return;
    if (!entry.isDirectory) { onOpenFile(entry.path); return; }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) setChildren(await loadChildren(entry.path));
  };

  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu({ entry, x: event.clientX, y: event.clientY });
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    if (!entry.isDirectory || !event.dataTransfer.types.includes(EXPLORER_PATH_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    if (!entry.isDirectory) return;
    const entries = entriesFromDrag(event);
    if (!entries.length) return;
    event.preventDefault();
    event.stopPropagation();
    void onMoveEntries(entries, entry.path);
  };

  const git = gitLookup(entry);
  const ignored = ignoredLookup(entry);
  const rowClass = ['tree-row', selectedPaths.has(entry.path) ? 'selected' : '', git?.cls, ignored ? 'git-ignored' : ''].filter(Boolean).join(' ');

  return (
    <div>
      <button className={rowClass} style={{ paddingLeft: 6 + depth * 12 }} onClick={toggle} onContextMenu={handleContextMenu} onDragOver={handleDragOver} onDrop={handleDrop} draggable onDragStart={(event) => { event.dataTransfer.setData(EXPLORER_PATH_MIME, dragPayload(getDragEntries(entry))); event.dataTransfer.effectAllowed = 'move'; }}>
        <span className="tree-twisty">{entry.isDirectory ? (expanded ? '▾' : '▸') : ''}</span>
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} expanded={expanded} />
        <span className="tree-label">{entry.name}</span>
        {git?.letter ? <span className={`git-badge ${git.cls}`}>{git.letter}</span> : null}
      </button>
      {entry.isDirectory && expanded && children ? (
        <div>
          {children.map((child) => <FileNode key={child.path} entry={child} depth={depth + 1} version={version} gitLookup={gitLookup} ignoredLookup={ignoredLookup} onOpenFile={onOpenFile} selectedPaths={selectedPaths} onSelectEntry={(target, event) => onSelectEntry(target, event, children)} getDragEntries={getDragEntries} onMoveEntries={onMoveEntries} onContextMenu={onContextMenu} loadChildren={loadChildren} />)}
        </div>
      ) : null}
    </div>
  );
}

export function FileTree({ rootPath, gitFiles, canAddToContext, onOpenFile, onPreviewFile, onOpenTerminalHere, onAddPathToContext, onDeletedPath, refreshToken }: Props) {
  const gitLookup = useMemo(() => buildGitLookup(rootPath, gitFiles), [rootPath, gitFiles]);
  const [rootChildren, setRootChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [ignoredPaths, setIgnoredPaths] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState<DirectoryEntry[]>([]);
  const [searchIndexing, setSearchIndexing] = useState(false);
  const [selectedEntries, setSelectedEntries] = useState<DirectoryEntry[]>([]);
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const previousRootPathRef = useRef(rootPath);
  const ignoredLookup = useMemo<IgnoredLookup>(() => (entry) => ignoredPaths.has(normalizePath(entry.path).toLowerCase()), [ignoredPaths]);
  const selectedPaths = useMemo(() => new Set(selectedEntries.map((entry) => entry.path)), [selectedEntries]);
  const searchResults = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return searchIndex.filter((entry) => matchesSearch(entry, needle)).slice(0, MAX_SEARCH_RESULTS);
  }, [search, searchIndex]);
  const promptDialog = usePromptDialog();
  const rememberIgnored = async (entries: DirectoryEntry[]) => {
    if (!entries.length) return;
    const ignored = await api.git.ignored(rootPath, entries.map((entry) => entry.path));
    if (!ignored.length) return;
    setIgnoredPaths((current) => {
      const next = new Set(current);
      for (const item of ignored) next.add(normalizePath(joinPath(rootPath, item)).toLowerCase());
      return next;
    });
  };
  const loadChildren = useMemo(() => async (path: string) => {
    const entries = await api.fs.readDirectory(path);
    void rememberIgnored(entries);
    return entries;
  }, [rootPath]);

  useEffect(() => {
    if (searchOpen) window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    let cancelled = false;
    const entriesByPath = new Map<string, DirectoryEntry>();
    let lastPublish = 0;
    const publish = (force = false) => {
      const now = Date.now();
      if (!force && now - lastPublish < 120) return;
      lastPublish = now;
      if (!cancelled) setSearchIndex([...entriesByPath.values()]);
    };
    const addEntries = (entries: DirectoryEntry[]) => {
      for (const entry of entries) entriesByPath.set(normalizePath(entry.path).toLowerCase(), entry);
      publish();
    };
    const build = async () => {
      setSearchIndexing(true);
      setSearchIndex([]);
      const visit = async (folder: string, depth = 0) => {
        if (cancelled || depth > 25) return;
        let entries: DirectoryEntry[] = [];
        try { entries = await api.fs.readDirectory(folder); } catch { return; }
        addEntries(entries);
        void rememberIgnored(entries);
        for (const entry of entries) {
          if (cancelled) break;
          if (entry.isDirectory) await visit(entry.path, depth + 1);
        }
      };
      await visit(rootPath);
      if (!cancelled) {
        publish(true);
        setSearchIndexing(false);
      }
    };
    void build();
    return () => { cancelled = true; };
  }, [rootPath, treeVersion, refreshToken]);

  useEffect(() => {
    let active = true;
    const rootChanged = previousRootPathRef.current !== rootPath;
    previousRootPathRef.current = rootPath;
    const showLoading = rootChanged || rootChildren.length === 0;
    if (rootChanged) { setRootChildren([]); setIgnoredPaths(new Set()); }
    if (showLoading) setLoading(true);
    api.fs.readDirectory(rootPath)
      .then((items) => { if (active) { setRootChildren(items); void rememberIgnored(items); } })
      .finally(() => { if (active && showLoading) setLoading(false); });
    return () => { active = false; };
  }, [rootPath, refreshToken, treeVersion]);

  useEffect(() => {
    void api.fs.watchWorkspace(rootPath);
    return api.onFileSystemChanged((payload) => {
      if (normalizePath(payload.rootPath).toLowerCase() !== normalizePath(rootPath).toLowerCase()) return;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        setTreeVersion((version) => version + 1);
      }, FILE_TREE_REFRESH_DEBOUNCE_MS);
    });
  }, [rootPath]);

  useEffect(() => () => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('resize', close); window.removeEventListener('keydown', onKey); };
  }, [menu]);

  async function afterAction(openPath?: string) {
    setMenu(null);
    setTreeVersion((version) => version + 1);
    if (openPath) onOpenFile(openPath);
  }

  async function createFileIn(folderPath: string) {
    const name = await promptDialog.input({ title: 'File name', placeholder: 'index.ts', confirmLabel: 'Create' });
    if (!name?.trim()) return;
    const target = joinPath(folderPath, name.trim());
    await api.fs.createFile(target);
    await afterAction(target);
  }
  async function createFolderIn(folderPath: string) {
    const name = await promptDialog.input({ title: 'Folder name', placeholder: 'src', confirmLabel: 'Create' });
    if (!name?.trim()) return;
    await api.fs.createFolder(joinPath(folderPath, name.trim()));
    await afterAction();
  }
  async function rename(entry: DirectoryEntry) {
    const name = await promptDialog.input({ title: 'New name', defaultValue: entry.name, confirmLabel: 'Rename' });
    if (!name?.trim() || name.trim() === entry.name) return;
    const target = joinPath(parentPath(entry.path), name.trim());
    await api.fs.renamePath(entry.path, target);
    await afterAction(entry.isFile ? target : undefined);
  }
  async function remove(entry: DirectoryEntry) {
    if (!(await promptDialog.confirm({ title: `Delete ${entry.name}?`, message: 'This removes item from disk.', confirmLabel: 'Delete', danger: true }))) return;
    await api.fs.deletePath(entry.path);
    await onDeletedPath(entry.path);
    await afterAction();
  }

  const searchActive = search.trim().length > 0;

  function openSearch() {
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearch('');
    setSearchOpen(false);
  }

  function selectEntry(entry: DirectoryEntry, event: MouseEvent<HTMLButtonElement>, groupEntries: DirectoryEntry[]) {
    const multiKey = event.ctrlKey || event.metaKey;
    if (!multiKey && !event.shiftKey) {
      setSelectedEntries([entry]);
      setLastSelectedPath(entry.path);
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && lastSelectedPath) {
      const start = groupEntries.findIndex((item) => item.path === lastSelectedPath);
      const end = groupEntries.findIndex((item) => item.path === entry.path);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        const range = groupEntries.slice(from, to + 1);
        setSelectedEntries((current) => {
          const next = new Map(current.map((item) => [item.path, item]));
          for (const item of range) next.set(item.path, item);
          return [...next.values()];
        });
      } else {
        setSelectedEntries([entry]);
      }
    } else if (multiKey) {
      setSelectedEntries((current) => current.some((item) => item.path === entry.path) ? current.filter((item) => item.path !== entry.path) : [...current, entry]);
      setLastSelectedPath(entry.path);
    }
    return true;
  }

  function openContextMenu(target: ContextTarget) {
    if (!target.entry) {
      setSelectedEntries([]);
      setMenu(target);
      return;
    }
    const entries = selectedPaths.has(target.entry.path) ? selectedEntries : [target.entry];
    if (!selectedPaths.has(target.entry.path)) {
      setSelectedEntries([target.entry]);
      setLastSelectedPath(target.entry.path);
    }
    setMenu({ ...target, entries });
  }

  const menuEntries = menu?.entries ?? (menu?.entry ? [menu.entry] : []);
  const hasMultiSelection = menuEntries.length > 1;

  async function addEntriesToContext(entries: DirectoryEntry[]) {
    for (const entry of entries) await onAddPathToContext(entry.isDirectory ? entry.path : parentPath(entry.path));
    setMenu(null);
  }

  async function removeEntries(entries: DirectoryEntry[]) {
    if (!entries.length) return;
    const title = entries.length === 1 ? `Delete ${entries[0].name}?` : `Delete ${entries.length} selected items?`;
    if (!(await promptDialog.confirm({ title, message: 'This removes item(s) from disk.', confirmLabel: 'Delete', danger: true }))) return;
    for (const entry of entries) {
      await api.fs.deletePath(entry.path);
      await onDeletedPath(entry.path);
    }
    setSelectedEntries((current) => current.filter((entry) => !entries.some((item) => item.path === entry.path)));
    await afterAction();
  }

  function dragEntriesFor(entry: DirectoryEntry) {
    return selectedPaths.has(entry.path) ? selectedEntries : [entry];
  }

  async function moveEntries(entries: DirectoryEntry[], targetFolder: string) {
    const targetRoot = normalizePath(targetFolder).toLowerCase();
    const uniqueEntries = [...new Map(entries.map((entry) => [normalizePath(entry.path).toLowerCase(), entry])).values()]
      .filter((entry) => !entries.some((candidate) => candidate.isDirectory && normalizePath(entry.path).toLowerCase().startsWith(`${normalizePath(candidate.path).toLowerCase()}/`)));
    const movable = uniqueEntries.filter((entry) => {
      const source = normalizePath(entry.path).toLowerCase();
      if (normalizePath(parentPath(entry.path)).toLowerCase() === targetRoot) return false;
      if (entry.isDirectory && (targetRoot === source || targetRoot.startsWith(`${source}/`))) return false;
      return true;
    });
    if (!movable.length) return;

    for (const entry of movable) {
      const target = joinPath(targetFolder, entry.name);
      if (await api.fs.pathExists(target)) {
        const overwrite = await promptDialog.confirm({ title: `${entry.name} already exists`, message: 'Replace the existing item at the destination?', confirmLabel: 'Replace', danger: true });
        if (!overwrite) continue;
        await api.fs.deletePath(target);
      }
      await api.fs.renamePath(entry.path, target);
      await onDeletedPath(entry.path);
    }
    setSelectedEntries([]);
    setLastSelectedPath(null);
    await afterAction();
  }

  return (
    <aside className="panel file-tree" onContextMenu={(event) => { event.preventDefault(); openContextMenu({ entry: null, x: event.clientX, y: event.clientY }); }}>
      <div className="panel-title row">
        <span>Files</span>
        <span className="panel-title-actions">
          <button className={searchOpen ? 'panel-icon-btn active-toggle' : 'panel-icon-btn'} title="Search files" aria-label="Search files" onClick={openSearch}>⌕</button>
          <button className="panel-icon-btn" title="New file" aria-label="New file" onClick={() => createFileIn(rootPath)}>＋</button>
        </span>
      </div>
      {searchOpen ? (
        <div className="tree-search-wrap">
          <input ref={searchInputRef} className="tree-search-input" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { if (search) setSearch(''); else setSearchOpen(false); } if (event.key === 'Enter' && searchResults[0]) { event.preventDefault(); searchResults[0].isDirectory ? onOpenTerminalHere(searchResults[0].path) : onOpenFile(searchResults[0].path); } }} placeholder="Search files" />
          <button className="tree-search-clear" title={search ? 'Clear search' : 'Close search'} onClick={search ? () => setSearch('') : closeSearch}>×</button>
        </div>
      ) : null}
      {loading ? <div className="muted pad">Loading...</div> : null}
      <div className="tree-list" onDragOver={(event) => { if (!event.dataTransfer.types.includes(EXPLORER_PATH_MIME)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { const entries = entriesFromDrag(event); if (!entries.length) return; event.preventDefault(); void moveEntries(entries, rootPath); }}>
        {searchActive ? (
          <>
            {searchIndexing ? <div className="muted pad">Indexing files…</div> : null}
            {!searchIndexing && !searchResults.length ? <div className="muted pad">No matches.</div> : null}
            {searchResults.map((entry) => (
              <button key={entry.path} className={`tree-row search-result${selectedPaths.has(entry.path) ? ' selected' : ''}`} title={entry.path} onClick={(event) => { if (selectEntry(entry, event, searchResults)) return; entry.isDirectory ? onOpenTerminalHere(entry.path) : onOpenFile(entry.path); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openContextMenu({ entry, x: event.clientX, y: event.clientY }); }} onDragOver={(event) => { if (!entry.isDirectory || !event.dataTransfer.types.includes(EXPLORER_PATH_MIME)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { if (!entry.isDirectory) return; const entries = entriesFromDrag(event); if (!entries.length) return; event.preventDefault(); event.stopPropagation(); void moveEntries(entries, entry.path); }} draggable onDragStart={(event) => { event.dataTransfer.setData(EXPLORER_PATH_MIME, dragPayload(dragEntriesFor(entry))); event.dataTransfer.effectAllowed = 'move'; }}>
                <FileIcon name={entry.name} isDirectory={entry.isDirectory} expanded={false} />
                <span className="tree-label">{entry.name}</span>
                <small className="tree-search-path">{entry.path.slice(rootPath.length).replace(/^[\\/]/, '')}</small>
              </button>
            ))}
          </>
        ) : rootChildren.map((entry) => <FileNode key={entry.path} entry={entry} depth={0} version={treeVersion} gitLookup={gitLookup} ignoredLookup={ignoredLookup} onOpenFile={onOpenFile} selectedPaths={selectedPaths} onSelectEntry={(target, event) => selectEntry(target, event, rootChildren)} getDragEntries={dragEntriesFor} onMoveEntries={moveEntries} onContextMenu={openContextMenu} loadChildren={loadChildren} />)}
      </div>
      {menu ? (
        <div ref={menuRef} className="context-menu" style={{ top: menu.y, left: menu.x }} onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
          {hasMultiSelection ? <div className="context-menu-label">{describeEntries(menuEntries)}</div> : null}
          {!hasMultiSelection && menu.entry?.isDirectory ? <button className="context-menu-item" onClick={() => { onOpenTerminalHere(menu.entry!.path); setMenu(null); }}>Open terminal here</button> : null}
          {menu.entry ? <button className="context-menu-item" disabled={!canAddToContext} onClick={() => { void addEntriesToContext(menuEntries); }}>{hasMultiSelection ? 'Add selected to context' : 'Add to context'}</button> : null}
          {!hasMultiSelection && (menu.entry?.isDirectory || !menu.entry) ? <button className="context-menu-item" onClick={() => createFileIn(menu.entry?.path ?? rootPath)}>New file</button> : null}
          {!hasMultiSelection && (menu.entry?.isDirectory || !menu.entry) ? <button className="context-menu-item" onClick={() => createFolderIn(menu.entry?.path ?? rootPath)}>New folder</button> : null}
          {!hasMultiSelection && menu.entry ? <button className="context-menu-item" onClick={() => rename(menu.entry!)}>Rename</button> : null}
          {menu.entry ? <button className="context-menu-item" onClick={() => { void api.fs.revealInExplorer(menuEntries[0].path); setMenu(null); }}>{hasMultiSelection ? 'Reveal first in Explorer' : 'Reveal in Explorer'}</button> : null}
          {!hasMultiSelection && menu.entry && menu.entry.isFile && isHtmlFile(menu.entry.path) ? <button className="context-menu-item" onClick={() => { onPreviewFile(menu.entry!.path); setMenu(null); }}>Preview</button> : null}
          {!hasMultiSelection && menu.entry && !menu.entry.isDirectory ? <button className="context-menu-item" onClick={() => { void api.shell.openPath(menu.entry!.path); setMenu(null); }}>Open External</button> : null}
          {menu.entry ? <button className="context-menu-item danger" onClick={() => removeEntries(menuEntries)}>{hasMultiSelection ? 'Delete selected' : 'Delete'}</button> : null}
        </div>
      ) : null}
    </aside>
  );
}
