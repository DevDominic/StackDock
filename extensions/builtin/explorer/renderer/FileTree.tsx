import { useEffect, useMemo, useRef, useState } from 'react';

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

interface ContextTarget { entry: DirectoryEntry | null; x: number; y: number; }
interface NodeProps {
  entry: DirectoryEntry;
  depth: number;
  version: number;
  gitLookup: GitLookup;
  ignoredLookup: IgnoredLookup;
  onOpenFile(path: string): void;
  onContextMenu(target: ContextTarget): void;
  loadChildren(path: string): Promise<DirectoryEntry[]>;
}

function joinPath(base: string, name: string) { return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`; }
function parentPath(path: string) { return path.replace(/[\\/][^\\/]+$/, ''); }
function normalizePath(p: string) { return p.replace(/\\/g, '/').replace(/\/+$/, ''); }
function isHtmlFile(path: string) { return /\.html?$/i.test(path); }
function matchesSearch(entry: DirectoryEntry, query: string) { return `${entry.name} ${entry.path}`.toLowerCase().includes(query); }

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

function FileNode({ entry, depth, version, gitLookup, ignoredLookup, onOpenFile, onContextMenu, loadChildren }: NodeProps) {
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

  const toggle = async () => {
    if (!entry.isDirectory) { onOpenFile(entry.path); return; }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) setChildren(await loadChildren(entry.path));
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu({ entry, x: event.clientX, y: event.clientY });
  };

  const git = gitLookup(entry);
  const ignored = ignoredLookup(entry);
  const rowClass = ['tree-row', git?.cls, ignored ? 'git-ignored' : ''].filter(Boolean).join(' ');

  return (
    <div>
      <button className={rowClass} style={{ paddingLeft: 6 + depth * 12 }} onClick={toggle} onContextMenu={handleContextMenu} draggable onDragStart={(event) => { event.dataTransfer.setData(EXPLORER_PATH_MIME, JSON.stringify({ path: entry.path, isDirectory: entry.isDirectory })); event.dataTransfer.effectAllowed = 'copy'; }}>
        <span className="tree-twisty">{entry.isDirectory ? (expanded ? '▾' : '▸') : ''}</span>
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} expanded={expanded} />
        <span className="tree-label">{entry.name}</span>
        {git?.letter ? <span className={`git-badge ${git.cls}`}>{git.letter}</span> : null}
      </button>
      {entry.isDirectory && expanded && children ? (
        <div>
          {children.map((child) => <FileNode key={child.path} entry={child} depth={depth + 1} version={version} gitLookup={gitLookup} ignoredLookup={ignoredLookup} onOpenFile={onOpenFile} onContextMenu={onContextMenu} loadChildren={loadChildren} />)}
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
  const [searchResults, setSearchResults] = useState<DirectoryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const previousRootPathRef = useRef(rootPath);
  const ignoredLookup = useMemo<IgnoredLookup>(() => (entry) => ignoredPaths.has(normalizePath(entry.path).toLowerCase()), [ignoredPaths]);
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
    const needle = search.trim().toLowerCase();
    if (!needle) { setSearchResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const results: DirectoryEntry[] = [];
      const visit = async (folder: string, depth = 0) => {
        if (cancelled || results.length >= MAX_SEARCH_RESULTS || depth > 10) return;
        let entries: DirectoryEntry[] = [];
        try { entries = await api.fs.readDirectory(folder); } catch { return; }
        void rememberIgnored(entries);
        for (const entry of entries) {
          if (matchesSearch(entry, needle)) results.push(entry);
          if (entry.isDirectory) await visit(entry.path, depth + 1);
          if (cancelled || results.length >= MAX_SEARCH_RESULTS) break;
        }
      };
      await visit(rootPath);
      if (!cancelled) { setSearchResults(results); setSearching(false); }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [rootPath, search, treeVersion, refreshToken]);

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

  return (
    <aside className="panel file-tree" onContextMenu={(event) => { event.preventDefault(); setMenu({ entry: null, x: event.clientX, y: event.clientY }); }}>
      <div className="panel-title row">
        <span>Files</span>
        <span className="panel-title-actions">
          <button className={searchOpen ? 'panel-icon-btn active-toggle' : 'panel-icon-btn'} title="Search files" aria-label="Search files" onClick={openSearch}>⌕</button>
          <button className="panel-icon-btn" title="New file" aria-label="New file" onClick={() => createFileIn(rootPath)}>＋</button>
        </span>
      </div>
      {searchOpen ? (
        <div className="tree-search-wrap">
          <input ref={searchInputRef} className="tree-search-input" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { if (search) setSearch(''); else setSearchOpen(false); } }} placeholder="Search files" />
          <button className="tree-search-clear" title={search ? 'Clear search' : 'Close search'} onClick={search ? () => setSearch('') : closeSearch}>×</button>
        </div>
      ) : null}
      {loading ? <div className="muted pad">Loading...</div> : null}
      <div className="tree-list">
        {searchActive ? (
          <>
            {searching ? <div className="muted pad">Searching...</div> : null}
            {!searching && !searchResults.length ? <div className="muted pad">No matches.</div> : null}
            {searchResults.map((entry) => (
              <button key={entry.path} className="tree-row search-result" title={entry.path} onClick={() => entry.isDirectory ? onOpenTerminalHere(entry.path) : onOpenFile(entry.path)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ entry, x: event.clientX, y: event.clientY }); }} draggable onDragStart={(event) => { event.dataTransfer.setData(EXPLORER_PATH_MIME, JSON.stringify({ path: entry.path, isDirectory: entry.isDirectory })); event.dataTransfer.effectAllowed = 'copy'; }}>
                <FileIcon name={entry.name} isDirectory={entry.isDirectory} expanded={false} />
                <span className="tree-label">{entry.name}</span>
                <small className="tree-search-path">{entry.path.slice(rootPath.length).replace(/^[\\/]/, '')}</small>
              </button>
            ))}
          </>
        ) : rootChildren.map((entry) => <FileNode key={entry.path} entry={entry} depth={0} version={treeVersion} gitLookup={gitLookup} ignoredLookup={ignoredLookup} onOpenFile={onOpenFile} onContextMenu={setMenu} loadChildren={loadChildren} />)}
      </div>
      {menu ? (
        <div ref={menuRef} className="context-menu" style={{ top: menu.y, left: menu.x }} onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
          {menu.entry?.isDirectory ? <button className="context-menu-item" onClick={() => { onOpenTerminalHere(menu.entry!.path); setMenu(null); }}>Open terminal here</button> : null}
          {menu.entry ? <button className="context-menu-item" disabled={!canAddToContext} onClick={() => { void onAddPathToContext(menu.entry!.isDirectory ? menu.entry!.path : parentPath(menu.entry!.path)); setMenu(null); }}>Add to context</button> : null}
          {menu.entry?.isDirectory || !menu.entry ? <button className="context-menu-item" onClick={() => createFileIn(menu.entry?.path ?? rootPath)}>New file</button> : null}
          {menu.entry?.isDirectory || !menu.entry ? <button className="context-menu-item" onClick={() => createFolderIn(menu.entry?.path ?? rootPath)}>New folder</button> : null}
          {menu.entry ? <button className="context-menu-item" onClick={() => rename(menu.entry!)}>Rename</button> : null}
          {menu.entry ? <button className="context-menu-item" onClick={() => { void api.fs.revealInExplorer(menu.entry!.path); setMenu(null); }}>Reveal in Explorer</button> : null}
          {menu.entry && menu.entry.isFile && isHtmlFile(menu.entry.path) ? <button className="context-menu-item" onClick={() => { onPreviewFile(menu.entry!.path); setMenu(null); }}>Preview</button> : null}
          {menu.entry && !menu.entry.isDirectory ? <button className="context-menu-item" onClick={() => { void api.shell.openPath(menu.entry!.path); setMenu(null); }}>Open External</button> : null}
          {menu.entry ? <button className="context-menu-item danger" onClick={() => remove(menu.entry!)}>Delete</button> : null}
        </div>
      ) : null}
    </aside>
  );
}
