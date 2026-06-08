import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { GitFileStatus, GitStatus, StackDockSettings, TerminalProfile, Workspace, WorkspaceCommand, WorkspaceLayout, WorkspaceTerminalSession } from '../../shared/types';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../common/ToastProvider';
import { useSessionStore } from '../../state/sessionStore';
import { FileTree } from './FileTree';
import { EditorPanel, type OpenFileTab } from './EditorPanel';
import { GitPanel } from './GitPanel';
import { TerminalPanel } from './TerminalPanel';
import { WorkspaceCommandsModal } from './WorkspaceCommandsModal';
import { CommandLauncher, type CommandAction } from './CommandLauncher';
import { SettingsModal } from './SettingsModal';
import { GlobalSessionsSidebar } from './GlobalSessionsSidebar';
import { NewTerminalMenu } from './NewTerminalMenu';

function joinPath(base: string, file: string) {
  return `${base.replace(/[\\/]+$/, '')}/${file.replace(/^[\\/]+/, '')}`;
}

function baseName(targetPath: string) {
  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
}

interface Props {
  workspace: Workspace;
  onBack(): void;
  onUpdateWorkspace(workspace: Workspace): Promise<void>;
  workspaces: Workspace[];
  onOpenWorkspace(id: string): Promise<void>;
}

export function WorkspaceShell({ workspace, onBack, onUpdateWorkspace, workspaces, onOpenWorkspace }: Props) {
  const { showToast } = useToast();
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState('');
  const [settings, setSettings] = useState<StackDockSettings | null>(null);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const sessionStore = useSessionStore();
  const allSessions = sessionStore.sessions;
  const sessions = allSessions.filter((session) => session.workspaceId === workspace.id);
  const activeTerminalId = sessions.some((session) => session.id === sessionStore.activeSessionId) ? sessionStore.activeSessionId : sessions[0]?.id ?? null;
  const [openFiles, setOpenFiles] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  // Which panel occupies the shared main area. The terminal is always tab #1;
  // opening a file switches the view to the editor. Both stay mounted (toggled
  // via CSS) so terminal scrollback and editor models survive tab switches.
  const [mainView, setMainView] = useState<'terminal' | 'editor'>('terminal');
  const [selectedGitFile, setSelectedGitFile] = useState<GitFileStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'git'>('explorer');
  const autoStartedRef = useRef<string | null>(null);
  const sessionsRef = useRef<WorkspaceTerminalSession[]>([]);

  const defaultProfile = useMemo(() => profiles[0], [profiles]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);


  function updatePanels(next: Partial<WorkspaceLayout['panels']>) {
    setLayout((current) => {
      const base = current ?? getDefaultLayout(workspace.id);
      return { ...base, panels: { ...base.panels, ...next } };
    });
  }

  function updatePanelSizes(next: NonNullable<WorkspaceLayout['panels']['panelSizes']>) {
    updatePanels({ panelSizes: { ...(mergedLayout.panels.panelSizes ?? {}), ...next } });
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedLayout, status, loadedSettings, terminalProfiles] = await Promise.all([
        api.workspaces.loadLayout(workspace.id),
        api.git.status(workspace.path),
        api.settings.load(),
        api.terminal.profiles(),
      ]);
      if (!active) return;
      setLayout(loadedLayout);
      setGit(status);
      setSettings(loadedSettings);
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
      if (!sessionsRef.current.length && loadedLayout?.terminals.length) {
        for (const session of loadedLayout.terminals) {
          await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: session.profileId, cwd: session.cwd, name: session.name, startupCommand: session.startupCommand });
        }
      } else if (!sessionsRef.current.length && terminalProfiles[0]) {
        await createTerminal(terminalProfiles[0].id, 'Terminal', '');
      }
      if (workspace.commands?.length && autoStartedRef.current !== workspace.id) {
        autoStartedRef.current = workspace.id;
        for (const command of workspace.commands.filter((item) => item.autoStart)) {
          await runWorkspaceCommand(command);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [workspace.id]);

  useEffect(() => {
    sessionStore.setActiveWorkspace(workspace.id);
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

  // With no files open there is no editor tab to show, so the terminal is the
  // only possible view. (Matches "no active editor when nothing is open".)
  useEffect(() => {
    if (!openFiles.length && mainView !== 'terminal') setMainView('terminal');
  }, [openFiles.length, mainView]);

  useEffect(() => {
    if (settings?.autoSave === false) return;
    const dirty = openFiles.filter((file) => file.dirty);
    if (!dirty.length) return;
    const delay = Math.max(200, settings?.autoSaveDelayMs ?? 1000);
    const timer = window.setTimeout(() => {
      for (const file of dirty) void saveFile(file.path, { silent: true });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [openFiles, settings?.autoSave, settings?.autoSaveDelayMs]);

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
    try {
      const existing = openFiles.find((file) => file.path === path);
      if (existing) { setActiveFilePath(path); setMainView('editor'); return; }
      const file = await api.fs.readFile(path);
      const tab: OpenFileTab = { path, name: path.split(/[\\/]/).pop() ?? path, content: file.content, dirty: false };
      setOpenFiles((current) => [...current, tab]);
      setActiveFilePath(path);
      setMainView('editor');
      const nextLayout = layout ?? getDefaultLayout(workspace.id);
      nextLayout.editors.openFiles = [...new Set([...nextLayout.editors.openFiles, path])];
      nextLayout.editors.activeFile = path;
      setLayout({ ...nextLayout });
    } catch (error) { showToast(getErrorMessage(error, 'Could not open file'), 'error'); }
  }

  function changeFile(path: string, content: string) {
    setOpenFiles((current) => current.map((file) => (file.path === path ? { ...file, content, dirty: true } : file)));
  }

  async function saveFile(path: string, options?: { silent?: boolean }) {
    try {
      const file = openFiles.find((item) => item.path === path);
      if (!file || !file.dirty) return;
      await api.fs.writeFile(path, file.content);
      setOpenFiles((current) => current.map((item) => (item.path === path ? { ...item, dirty: false } : item)));
      await refreshGit();
      setRefreshToken((token) => token + 1);
      if (!options?.silent) showToast('File saved', 'success');
    } catch (error) { showToast(getErrorMessage(error, 'Could not save file'), 'error'); }
  }

  function closeFile(path: string) {
    setOpenFiles((current) => {
      const index = current.findIndex((file) => file.path === path);
      const next = current.filter((file) => file.path !== path);
      setActiveFilePath((activePath) => (activePath === path ? next[index]?.path ?? next[index - 1]?.path ?? null : activePath));
      return next;
    });
  }

  async function runWorkspaceCommand(command: WorkspaceCommand) {
    await createTerminal(defaultProfile?.id ?? 'powershell', command.terminalName || command.name || 'Command', command.command, command.cwd || workspace.path);
    showToast(`Started ${command.name}`, 'success');
  }

  async function createTerminal(profileId = defaultProfile?.id ?? 'powershell', name = 'Terminal', startupCommand = '', cwd = workspace.path) {
    try {
      setMainView('terminal');
      await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId, cwd, name, startupCommand });
    } catch (error) { showToast(getErrorMessage(error, 'Could not create terminal'), 'error'); }
  }

  async function openTerminalHere(folderPath: string) {
    await createTerminal(defaultProfile?.id ?? 'powershell', baseName(folderPath) || 'Folder', '', folderPath);
  }

  async function renameTerminal(id: string, name: string) {
    sessionStore.renameSession(id, name);
  }

  async function restartTerminal(id: string, cwd?: string) {
    const old = sessionsRef.current.find((session) => session.id === id);
    if (!old) return;
    await api.terminal.kill(old.id);
    const next = await api.terminal.create(old.profileId, cwd ?? old.cwd, old.name, old.startupCommand);
    const replacement: WorkspaceTerminalSession = { ...next, workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath, splitGroupId: old.splitGroupId, splitDirection: old.splitDirection };
    sessionStore.replaceSession(id, replacement);
  }

  async function duplicateTerminal(id: string) {
    const source = sessionsRef.current.find((session) => session.id === id);
    if (!source) return;
    await createTerminal(source.profileId, `${source.name} Copy`, source.startupCommand ?? '', source.cwd);
  }

  async function setTerminalCwd(id: string, cwd: string) {
    if (!cwd.trim()) return;
    if (!window.confirm('Restart terminal in new cwd?')) return;
    await restartTerminal(id, cwd.trim());
  }

  async function splitTerminal(id: string, direction: 'row' | 'column') {
    const source = sessionsRef.current.find((session) => session.id === id);
    if (!source) return;
    const groupId = source.splitGroupId ?? crypto.randomUUID();
    const updatedSource = { ...source, splitGroupId: groupId, splitDirection: direction };
    sessionStore.replaceSession(id, updatedSource);
    const created = await sessionStore.createSession({ workspaceId: source.workspaceId, workspaceName: source.workspaceName, workspacePath: source.workspacePath, profileId: source.profileId, cwd: source.cwd, name: `${source.name} Split`, startupCommand: source.startupCommand });
    sessionStore.replaceSession(created.id, { ...created, splitGroupId: groupId, splitDirection: direction });
  }

  async function closeTerminal(id: string) {
    await sessionStore.closeSession(id);
  }

  function showGitError(error: unknown) {
    setGitError(error instanceof Error ? error.message : String(error));
  }

  async function selectGitFile(file: GitFileStatus, staged = file.staged && !file.unstaged) {
    try {
      setGitError(null);
      setSelectedGitFile(file);
      setDiff(await api.git.diff(workspace.path, file.path, staged));
      await openFile(joinPath(workspace.path, file.path));
    } catch (error) { showGitError(error); }
  }

  async function stage(path: string) {
    try { setGitError(null); await api.git.stage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function stageAll() {
    try { setGitError(null); await api.git.addAll(workspace.path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function unstage(path: string) {
    try { setGitError(null); await api.git.unstage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function discard(path: string) {
    if (settings?.confirmBeforeDiscard !== false && !window.confirm(`Discard changes in ${path}? This cannot be undone.`)) return;
    try {
      setGitError(null);
      const file = selectedGitFile?.path === path ? selectedGitFile : git?.files.find((item) => item.path === path);
      if (file?.untracked) await api.fs.deletePath(joinPath(workspace.path, path));
      else await api.git.discard(workspace.path, path);
      await refreshGit();
      setRefreshToken((token) => token + 1);
    } catch (error) { showGitError(error); }
  }

  async function commit(message: string) {
    try { setGitError(null); await api.git.commit(workspace.path, message); await refreshGit(); showToast('Commit created', 'success'); } catch (error) { showGitError(error); showToast(getErrorMessage(error, 'Commit failed'), 'error'); }
  }

  // Explorer and Git share the one sidebar pane. Clicking the active tab hides
  // the sidebar; clicking the inactive tab switches to it (revealing it first).
  function selectSidebar(tab: 'explorer' | 'git') {
    if (mergedLayout.panels.fileTreeVisible && sidebarTab === tab) {
      updatePanels({ fileTreeVisible: false });
    } else {
      setSidebarTab(tab);
      updatePanels({ fileTreeVisible: true });
    }
  }

  const defaultLayout = getDefaultLayout(workspace.id);
  const mergedLayout = layout ?? defaultLayout;
  const panelSizes = mergedLayout.panels.panelSizes ?? { sessions: 14, explorer: 18, main: 68, editor: 72, git: 28, upper: 62, terminal: 38 };
  const launcherActions: CommandAction[] = [
    { id: 'new-terminal', label: 'New Terminal', run: () => createTerminal(defaultProfile?.id ?? 'powershell', 'Terminal', '') },
    { id: 'toggle-tree', label: 'Toggle Sidebar', run: () => updatePanels({ fileTreeVisible: !mergedLayout.panels.fileTreeVisible }) },
    { id: 'show-explorer', label: 'Show Explorer', run: () => selectSidebar('explorer') },
    { id: 'show-git', label: 'Show Source Control', run: () => selectSidebar('git') },
    { id: 'show-terminal', label: 'Show Terminal', run: () => setMainView('terminal') },
    { id: 'refresh-git', label: 'Refresh Git', run: refreshGit },
    { id: 'open-folder', label: 'Open Workspace Folder', run: () => api.fs.revealInExplorer(workspace.path) },
    ...(workspace.commands ?? []).map((command) => ({ id: `cmd:${command.id}`, label: `Run ${command.name}`, description: command.command, run: () => runWorkspaceCommand(command) })),
  ];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'p') { event.preventDefault(); setLauncherOpen(true); return; }
      if (inField) return;
      if ((event.ctrlKey || event.metaKey) && event.key === '`') { event.preventDefault(); setMainView((view) => (view === 'terminal' && openFiles.length ? 'editor' : 'terminal')); }
      if ((event.ctrlKey || event.metaKey) && key === 'b') { event.preventDefault(); updatePanels({ fileTreeVisible: !mergedLayout.panels.fileTreeVisible }); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'e') { event.preventDefault(); selectSidebar('explorer'); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'g') { event.preventDefault(); selectSidebar('git'); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 't') { event.preventDefault(); void createTerminal(defaultProfile?.id ?? 'powershell', 'Terminal', ''); }
      if ((event.ctrlKey || event.metaKey) && key === 'w' && activeFilePath) { event.preventDefault(); closeFile(activeFilePath); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFilePath, defaultProfile?.id, sidebarTab, mergedLayout.panels.fileTreeVisible, openFiles.length]);

  return (
    <div className="workspace-shell workspace-terminal-mode">
      <header className="topbar compact-topbar">
        <div className="topbar-left">
          <button className="ghost" onClick={onBack}>Back</button>
          <NewTerminalMenu workspaces={workspaces} profiles={profiles} defaultProfileId={settings?.defaultTerminalProfileId} onCreate={async ({ workspace: target, profileId }) => { await sessionStore.createSession({ workspaceId: target.id, workspaceName: target.name, workspacePath: target.path, profileId, cwd: target.path, name: 'Terminal' }); await onOpenWorkspace(target.id); }} />
          <button className={mergedLayout.panels.fileTreeVisible && sidebarTab === 'explorer' ? 'ghost active-toggle' : 'ghost'} onClick={() => selectSidebar('explorer')}>Explorer</button>
          <button className={mergedLayout.panels.fileTreeVisible && sidebarTab === 'git' ? 'ghost active-toggle' : 'ghost'} onClick={() => selectSidebar('git')}>Git</button>
          <button className={mainView === 'terminal' ? 'ghost active-toggle' : 'ghost'} onClick={() => setMainView('terminal')}>Terminal</button>
        </div>
        <div className="topbar-title">
          <h2>{workspace.name}</h2>
          <span className="muted">{workspace.path}</span>
        </div>
        <div className="topbar-actions">
          <span className="muted">{git?.branch ?? 'no branch'} · {git?.files.length ?? 0} dirty</span>
          {workspace.commands?.slice(0, 3).map((command) => <button key={command.id} className="ghost" onClick={() => runWorkspaceCommand(command)}>{command.name}</button>)}
          <button className="ghost" onClick={() => setCommandsOpen(true)}>Commands</button>
          <button className="ghost" onClick={() => setSettingsOpen(true)}>Settings</button>
          <button className="primary" onClick={() => createTerminal(settings?.defaultTerminalProfileId ?? defaultProfile?.id ?? 'powershell', 'Terminal', '')}>+ Terminal</button>
          <button className="ghost" onClick={() => void api.fs.revealInExplorer(workspace.path)}>Open Folder</button>
        </div>
      </header>

      <PanelGroup direction="horizontal" className="workspace-body with-global-sessions" onLayout={([sessionsSize, explorer, main]) => updatePanelSizes(mergedLayout.panels.fileTreeVisible ? { sessions: sessionsSize, explorer, main } : { sessions: sessionsSize, main: explorer })}>
        <Panel defaultSize={panelSizes.sessions ?? 14} minSize={10} className="global-sessions-panel">
          <GlobalSessionsSidebar workspaces={workspaces} activeWorkspaceId={workspace.id} activeSessionId={sessionStore.activeSessionId} sessions={allSessions} emptySessionsVisible={!!settings?.emptySessionsVisible} onSelectSession={(id) => { const target = allSessions.find((session) => session.id === id); sessionStore.setActiveSession(id); if (target && target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId); }} onOpenWorkspace={(id) => void onOpenWorkspace(id)} onCloseSession={(id) => void closeTerminal(id)} />
        </Panel>
        <PanelResizeHandle className="resize-handle vertical" />
        {mergedLayout.panels.fileTreeVisible ? (
          <>
            <Panel defaultSize={panelSizes.explorer ?? 18} minSize={12} className="workspace-explorer">
              {sidebarTab === 'git' ? (
                <GitPanel status={git} diff={diff} error={gitError} selectedFile={selectedGitFile} onSelectFile={selectGitFile} onStage={stage} onStageAll={stageAll} onUnstage={unstage} onDiscard={discard} onCommit={commit} onRefresh={refreshGit} />
              ) : (
                <FileTree rootPath={workspace.path} gitFiles={git?.files ?? []} onOpenFile={openFile} onOpenTerminalHere={openTerminalHere} refreshToken={refreshToken} />
              )}
            </Panel>
            <PanelResizeHandle className="resize-handle vertical" />
          </>
        ) : null}
        <Panel defaultSize={panelSizes.main ?? 82} minSize={30}>
          <div className="workspace-main-area main-tabbed">
            <div className="editor-tabbar main-tabbar">
              <div className="tab-strip">
                <div
                  className={`tab main-terminal-tab${mainView === 'terminal' ? ' active' : ''}`}
                  title="Terminal"
                  onClick={() => setMainView('terminal')}
                >
                  <span className="tab-name">Terminal</span>
                </div>
                {openFiles.map((file) => (
                  <div
                    key={file.path}
                    className={`tab${mainView === 'editor' && file.path === activeFilePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}`}
                    title={file.path}
                    onClick={() => { setActiveFilePath(file.path); setMainView('editor'); }}
                    onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeFile(file.path); } }}
                  >
                    <span className="tab-name">{file.name}</span>
                    <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeFile(file.path); }}>
                      <span className="dot">●</span><span className="x">×</span>
                    </span>
                  </div>
                ))}
              </div>
              {mainView === 'editor' && activeFilePath ? (
                <div className="editor-tab-actions">
                  <button className="ghost" onClick={() => saveFile(activeFilePath)}>Save</button>
                  <button className="ghost" onClick={() => api.fs.revealInExplorer(activeFilePath)}>Reveal</button>
                </div>
              ) : null}
            </div>
            <div className="main-tab-content">
              <div className="main-tab-pane" style={{ display: mainView === 'terminal' ? 'flex' : 'none' }}>
                <TerminalPanel sessions={sessions} activeId={activeTerminalId} profiles={profiles} onCreate={createTerminal} onActivate={sessionStore.setActiveSession} onRename={renameTerminal} onRestart={restartTerminal} onDuplicate={duplicateTerminal} onSetCwd={setTerminalCwd} onSplit={splitTerminal} onClose={closeTerminal} />
              </div>
              <div className="main-tab-pane" style={{ display: mainView === 'editor' ? 'flex' : 'none' }}>
                <EditorPanel openFiles={openFiles} activePath={activeFilePath} onOpenFile={setActiveFilePath} onChangeFile={changeFile} onSaveFile={saveFile} onCloseFile={closeFile} showTabs={false} />
              </div>
            </div>
          </div>
        </Panel>
      </PanelGroup>
      {commandsOpen ? <WorkspaceCommandsModal workspace={workspace} onSave={onUpdateWorkspace} onRun={runWorkspaceCommand} onClose={() => setCommandsOpen(false)} /> : null}
      <CommandLauncher open={launcherOpen} actions={launcherActions} onClose={() => setLauncherOpen(false)} />
      {settingsOpen && settings ? <SettingsModal settings={settings} onSave={async (next) => { const saved = await api.settings.save(next); setSettings(saved); setProfiles(await api.terminal.profiles()); }} onClose={() => setSettingsOpen(false)} /> : null}
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
      panelSizes: { sessions: 14, explorer: 18, main: 68, editor: 72, git: 28, upper: 62, terminal: 38 },
    },
    editors: { openFiles: [], activeFile: undefined },
    terminals: [],
  };
}
