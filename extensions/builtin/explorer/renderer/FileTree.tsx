import { useEffect, useMemo, useRef, useState } from 'react';

const FILE_TREE_REFRESH_DEBOUNCE_MS = 500;
import type { DirectoryEntry, GitFileStatus } from '../../../../src/shared/types';
import { api } from '../../../../src/lib/api';
import { FileIcon } from '../../../../src/components/workspace/fileIcons';

interface Props {
  rootPath: string;
  gitFiles: GitFileStatus[];
  onOpenFile(path: string): void;
  onPreviewFile(path: string): void;
  onOpenTerminalHere(path: string): void;
  refreshToken: number;
}

interface GitDecoration { letter: string; cls: string }
type GitLookup = (entry: DirectoryEntry) => GitDecoration | null;

interface ContextTarget { entry: DirectoryEntry | null; x: number; y: number; }
interface NodeProps {
  entry: DirectoryEntry;
  depth: number;
  version: number;
  gitLookup: GitLookup;
  onOpenFile(path: string): void;
  onContextMenu(target: ContextTarget): void;
  loadChildren(path: string): Promise<DirectoryEntry[]>;
}

function joinPath(base: string, name: string) { return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`; }
function parentPath(path: string) { return path.replace(/[\\/][^\\/]+$/, ''); }
function normalizePath(p: string) { return p.replace(/\\/g, '/').replace(/\/+$/, ''); }
function isHtmlFile(path: string) { return /\.html?$/i.test(path); }

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

function FileNode({ entry, depth, version, gitLookup, onOpenFile, onContextMenu, loadChildren }: NodeProps) {
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

  return (
    <div>
      <button className={git ? `tree-row ${git.cls}` : 'tree-row'} style={{ paddingLeft: 6 + depth * 12 }} onClick={toggle} onContextMenu={handleContextMenu}>
        <span className="tree-twisty">{entry.isDirectory ? (expanded ? '▾' : '▸') : ''}</span>
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} expanded={expanded} />
        <span className="tree-label">{entry.name}</span>
        {git?.letter ? <span className={`git-badge ${git.cls}`}>{git.letter}</span> : null}
      </button>
      {entry.isDirectory && expanded && children ? (
        <div>
          {children.map((child) => <FileNode key={child.path} entry={child} depth={depth + 1} version={version} gitLookup={gitLookup} onOpenFile={onOpenFile} onContextMenu={onContextMenu} loadChildren={loadChildren} />)}
        </div>
      ) : null}
    </div>
  );
}

export function FileTree({ rootPath, gitFiles, onOpenFile, onPreviewFile, onOpenTerminalHere, refreshToken }: Props) {
  const gitLookup = useMemo(() => buildGitLookup(rootPath, gitFiles), [rootPath, gitFiles]);
  const [rootChildren, setRootChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const previousRootPathRef = useRef(rootPath);
  const loadChildren = useMemo(() => async (path: string) => api.fs.readDirectory(path), []);

  useEffect(() => {
    let active = true;
    const rootChanged = previousRootPathRef.current !== rootPath;
    previousRootPathRef.current = rootPath;
    const showLoading = rootChanged || rootChildren.length === 0;
    if (rootChanged) setRootChildren([]);
    if (showLoading) setLoading(true);
    api.fs.readDirectory(rootPath)
      .then((items) => { if (active) setRootChildren(items); })
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
    const name = window.prompt('File name');
    if (!name) return;
    const target = joinPath(folderPath, name);
    await api.fs.createFile(target);
    await afterAction(target);
  }
  async function createFolderIn(folderPath: string) {
    const name = window.prompt('Folder name');
    if (!name) return;
    await api.fs.createFolder(joinPath(folderPath, name));
    await afterAction();
  }
  async function rename(entry: DirectoryEntry) {
    const name = window.prompt('New name', entry.name);
    if (!name || name === entry.name) return;
    const target = joinPath(parentPath(entry.path), name);
    await api.fs.renamePath(entry.path, target);
    await afterAction(entry.isFile ? target : undefined);
  }
  async function remove(entry: DirectoryEntry) {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    await api.fs.deletePath(entry.path);
    await afterAction();
  }

  return (
    <aside className="panel file-tree" onContextMenu={(event) => { event.preventDefault(); setMenu({ entry: null, x: event.clientX, y: event.clientY }); }}>
      <div className="panel-title row">
        <span>Files</span>
        <button className="panel-icon-btn" title="New file" aria-label="New file" onClick={() => createFileIn(rootPath)}>＋</button>
      </div>
      {loading ? <div className="muted pad">Loading...</div> : null}
      <div className="tree-list">
        {rootChildren.map((entry) => <FileNode key={entry.path} entry={entry} depth={0} version={treeVersion} gitLookup={gitLookup} onOpenFile={onOpenFile} onContextMenu={setMenu} loadChildren={loadChildren} />)}
      </div>
      {menu ? (
        <div ref={menuRef} className="context-menu" style={{ top: menu.y, left: menu.x }} onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
          {menu.entry?.isDirectory ? <button className="context-menu-item" onClick={() => { onOpenTerminalHere(menu.entry!.path); setMenu(null); }}>Open terminal here</button> : null}
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
