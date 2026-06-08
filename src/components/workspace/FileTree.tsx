import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryEntry } from '../../shared/types';
import { api } from '../../lib/api';
import { FileIcon } from './fileIcons';

interface Props {
  rootPath: string;
  onOpenFile(path: string): void;
  onOpenTerminalHere(path: string): void;
  refreshToken: number;
}

interface ContextTarget {
  entry: DirectoryEntry;
  x: number;
  y: number;
}

interface NodeProps {
  entry: DirectoryEntry;
  depth: number;
  onOpenFile(path: string): void;
  onContextMenu(target: ContextTarget): void;
  loadChildren(path: string): Promise<DirectoryEntry[]>;
}

function FileNode({ entry, depth, onOpenFile, onContextMenu, loadChildren }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirectoryEntry[] | null>(null);

  const toggle = async () => {
    if (!entry.isDirectory) {
      onOpenFile(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setChildren(await loadChildren(entry.path));
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!entry.isDirectory) return;
    event.preventDefault();
    onContextMenu({ entry, x: event.clientX, y: event.clientY });
  };

  return (
    <div>
      <button className="tree-row" style={{ paddingLeft: 6 + depth * 12 }} onClick={toggle} onContextMenu={handleContextMenu}>
        <span className="tree-twisty">{entry.isDirectory ? (expanded ? '▾' : '▸') : ''}</span>
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} expanded={expanded} />
        <span className="tree-label">{entry.name}</span>
      </button>
      {entry.isDirectory && expanded && children ? (
        <div>
          {children.map((child) => (
            <FileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              loadChildren={loadChildren}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FileTree({ rootPath, onOpenFile, onOpenTerminalHere, refreshToken }: Props) {
  const [rootChildren, setRootChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadChildren = useMemo(
    () => async (path: string) => api.fs.readDirectory(path),
    [],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.fs
      .readDirectory(rootPath)
      .then((items) => {
        if (active) setRootChildren(items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rootPath, refreshToken]);

  // Dismiss the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <aside className="panel file-tree">
      <div className="panel-title">Files</div>
      {loading ? <div className="muted pad">Loading...</div> : null}
      <div className="tree-list">
        {rootChildren.map((entry) => (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            onOpenFile={onOpenFile}
            onContextMenu={setMenu}
            loadChildren={loadChildren}
          />
        ))}
      </div>
      {menu ? (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onOpenTerminalHere(menu.entry.path);
              setMenu(null);
            }}
          >
            Open terminal here
          </button>
        </div>
      ) : null}
    </aside>
  );
}
