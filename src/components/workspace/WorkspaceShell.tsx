import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitFileStatus, GitStatus, TerminalProfile, TerminalSession, Workspace, WorkspaceLayout } from '../../shared/types';
import { api } from '../../lib/api';
import { FileTree } from './FileTree';
import { type OpenFileTab } from './EditorPanel';
import { TerminalPanel } from './TerminalPanel';

function joinPath(base: string, file: string) {
  return `${base.replace(/[\\/]+$/, '')}/${file.replace(/^[\\/]+/, '')}`;
}

function baseName(targetPath: string) {
  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
}

interface Props {
  workspace: Workspace;
  onBack(): void;
}

export function WorkspaceShell({ workspace, onBack }: Props) {
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState('');
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [selectedGitFile, setSelectedGitFile] = useState<GitFileStatus | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const sessionsRef = useRef<TerminalSession[]>([]);

  const defaultProfile = useMemo(() => profiles[0], [profiles]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    return () => {
      for (const session of sessionsRef.current) {
        void api.terminal.kill(session.id);
      }
    };
  }, []);

  function updatePanels(next: Partial<WorkspaceLayout['panels']>) {
    setLayout((current) => {
      const base = current ?? getDefaultLayout(workspace.id);
      return { ...base, panels: { ...base.panels, ...next } };
    });
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedLayout, status, terminalProfiles] = await Promise.all([
        api.workspaces.loadLayout(workspace.id),
        api.git.status(workspace.path),
        api.terminal.profiles(),
      ]);
      if (!active) return;
      setLayout(loadedLayout);
      setGit(status);
      setProfiles(terminalProfiles);
      if (loadedLayout?.editors.openFiles.length) {
        const tabs: OpenFileTab[] = [];
        for (const filePath of loadedLayout.editors.openFiles) {
          try {
            const file = await api.fs.readFile(filePath);
            tabs.push({ path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: file.content, dirty: false });
          } catch {
            tabs.push({ path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: '', dirty: false });
          }
        }
        if (!active) return;
        setOpenFiles(tabs);
        setActiveFilePath(loadedLayout.editors.activeFile ?? tabs[0]?.path ?? null);
      }
      if (loadedLayout?.terminals.length) {
        const restored: TerminalSession[] = [];
        for (const session of loadedLayout.terminals) {
          restored.push(await api.terminal.create(session.profileId, session.cwd, session.name, session.startupCommand));
        }
        setSessions(restored);
        setActiveTerminalId(restored[0]?.id ?? null);
      } else if (terminalProfiles[0]) {
        await createTerminal(terminalProfiles[0].id, 'Terminal', '');
      }
    })();
    return () => {
      active = false;
    };
  }, [workspace.id]);

  useEffect(() => {
    const save = window.setTimeout(() => {
      const nextLayout: WorkspaceLayout = {
        workspaceId: workspace.id,
        panels: layout?.panels ?? {
          fileTreeWidth: 280,
          gitPanelWidth: 320,
          terminalHeight: 280,
          fileTreeVisible: true,
          gitPanelVisible: true,
          terminalVisible: true,
        },
        editors: {
          openFiles: openFiles.map((file) => file.path),
          activeFile: activeFilePath ?? undefined,
        },
        terminals: sessions,
      };
      api.workspaces.saveLayout(nextLayout).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(save);
  }, [workspace.id, layout, openFiles, activeFilePath, sessions]);

  async function refreshGit() {
    const status = await api.git.status(workspace.path);
    setGit(status);
    if (selectedGitFile) {
      const currentFile = status.files.find((file) => file.path === selectedGitFile.path) ?? selectedGitFile;
      setSelectedGitFile(currentFile);
      setDiff(await api.git.diff(workspace.path, currentFile.path, currentFile.staged));
    }
  }

  async function openFile(path: string) {
    const existing = openFiles.find((file) => file.path === path);
    if (existing) {
      setActiveFilePath(path);
      return;
    }
    const file = await api.fs.readFile(path);
    const tab: OpenFileTab = { path, name: path.split(/[\\/]/).pop() ?? path, content: file.content, dirty: false };
    setOpenFiles((current) => [...current, tab]);
    setActiveFilePath(path);
    const nextLayout = layout ?? getDefaultLayout(workspace.id);
    nextLayout.editors.openFiles = [...new Set([...nextLayout.editors.openFiles, path])];
    nextLayout.editors.activeFile = path;
    setLayout({ ...nextLayout });
  }

  function changeFile(path: string, content: string) {
    setOpenFiles((current) => current.map((file) => (file.path === path ? { ...file, content, dirty: true } : file)));
  }

  async function saveFile(path: string) {
    const file = openFiles.find((item) => item.path === path);
    if (!file) return;
    await api.fs.writeFile(path, file.content);
    setOpenFiles((current) => current.map((item) => (item.path === path ? { ...item, dirty: false } : item)));
    await refreshGit();
    setRefreshToken((token) => token + 1);
  }

  function closeFile(path: string) {
    setOpenFiles((current) => current.filter((file) => file.path !== path));
    setActiveFilePath((current) => (current === path ? null : current));
  }

  async function createTerminal(profileId = defaultProfile?.id ?? 'powershell', name = 'Terminal', startupCommand = '', cwd = workspace.path) {
    const terminal = await api.terminal.create(profileId, cwd, name, startupCommand);
    setSessions((current) => [...current, terminal]);
    setActiveTerminalId(terminal.id);
  }

  async function openTerminalHere(folderPath: string) {
    await createTerminal(defaultProfile?.id ?? 'powershell', baseName(folderPath) || 'Folder', '', folderPath);
  }

  async function renameTerminal(id: string, name: string) {
    setSessions((current) => current.map((session) => (session.id === id ? { ...session, name } : session)));
  }

  async function closeTerminal(id: string) {
    await api.terminal.kill(id);
    setSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      setActiveTerminalId((activeId) => (activeId === id ? next[0]?.id ?? null : activeId));
      return next;
    });
  }

  async function selectGitFile(file: GitFileStatus) {
    setSelectedGitFile(file);
    setDiff(await api.git.diff(workspace.path, file.path, file.staged));
    await openFile(joinPath(workspace.path, file.path));
  }

  async function stage(path: string) {
    await api.git.stage(workspace.path, path);
    await refreshGit();
  }

  async function unstage(path: string) {
    await api.git.unstage(workspace.path, path);
    await refreshGit();
  }

  async function discard(path: string) {
    await api.git.discard(workspace.path, path);
    await refreshGit();
  }

  async function commit(message: string) {
    await api.git.commit(workspace.path, message);
    await refreshGit();
  }

  const defaultLayout = getDefaultLayout(workspace.id);
  const mergedLayout = layout ?? defaultLayout;

  return (
    <div className="workspace-shell workspace-terminal-mode">
      <header className="topbar compact-topbar">
        <div className="topbar-left">
          <button className="ghost" onClick={onBack}>Back</button>
          <button className={mergedLayout.panels.fileTreeVisible ? 'ghost active-toggle' : 'ghost'} onClick={() => updatePanels({ fileTreeVisible: !mergedLayout.panels.fileTreeVisible })}>
            Explorer
          </button>
        </div>
        <div className="topbar-title">
          <h2>{workspace.name}</h2>
          <span className="muted">{workspace.path}</span>
        </div>
        <div className="topbar-actions">
          <span className="muted">{git?.branch ?? 'no branch'} · {git?.files.length ?? 0} dirty</span>
          <button className="primary" onClick={() => createTerminal(defaultProfile?.id ?? 'powershell', 'Terminal', '')}>+ Terminal</button>
          <button className="ghost" onClick={() => void api.fs.revealInExplorer(workspace.path)}>Open Folder</button>
        </div>
      </header>

      <div className={mergedLayout.panels.fileTreeVisible ? 'workspace-body explorer-open' : 'workspace-body'}>
        {mergedLayout.panels.fileTreeVisible ? (
          <aside className="workspace-explorer">
            <FileTree rootPath={workspace.path} onOpenFile={openFile} onOpenTerminalHere={openTerminalHere} refreshToken={refreshToken} />
          </aside>
        ) : null}
        <TerminalPanel
          sessions={sessions}
          activeId={activeTerminalId}
          profiles={profiles}
          onCreate={createTerminal}
          onActivate={setActiveTerminalId}
          onRename={renameTerminal}
          onClose={closeTerminal}
        />
      </div>
    </div>
  );
}

function getDefaultLayout(workspaceId: string): WorkspaceLayout {
  return {
    workspaceId,
    panels: {
      fileTreeWidth: 280,
      gitPanelWidth: 320,
      terminalHeight: 280,
      fileTreeVisible: true,
      gitPanelVisible: true,
      terminalVisible: true,
    },
    editors: { openFiles: [], activeFile: undefined },
    terminals: [],
  };
}
