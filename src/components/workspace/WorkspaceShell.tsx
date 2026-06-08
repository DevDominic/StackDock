import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { AutomationConfig, GitFileStatus, GitStatus, PaletteCommand, StackDockSettings, TerminalProfile, Workspace, WorkspaceCommand, WorkspaceLayout, WorkspaceTerminalSession } from '../../shared/types';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../common/ToastProvider';
import { useSessionStore } from '../../state/sessionStore';
import { FileTree } from './FileTree';
import type { OpenFileTab } from './EditorPanel';
import { WebTabPanel, type WebTab } from './WebTabPanel';
import { GitPanel } from './GitPanel';
import { TerminalPanel } from './TerminalPanel';
import { WorkspaceCommandsModal } from './WorkspaceCommandsModal';
import { CommandLauncher, type CommandAction } from './CommandLauncher';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import { applyTheme } from '../../lib/themeSupport';
import { GlobalSessionsSidebar } from './GlobalSessionsSidebar';

const EditorPanel = lazy(() => import('./EditorPanel.js').then((module) => ({ default: module.EditorPanel })));

// Which kind of content tab is showing in the shared main area for a session.
type MainTabKind = 'terminal' | 'editor' | 'web';

// All editor/web tab state for a single terminal session.
interface SessionEditors {
  openFiles: OpenFileTab[];
  openLinks: WebTab[];
  activeKind: MainTabKind;
  activeFile: string | null;
  activeWeb: string | null;
}

const EMPTY_EDITORS: SessionEditors = { openFiles: [], openLinks: [], activeKind: 'terminal', activeFile: null, activeWeb: null };

function linkLabel(url: string) {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${parsed.host}${tail}` || url;
  } catch {
    return url;
  }
}

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
  settings?: StackDockSettings | null;
  onSettingsApplied?(settings: StackDockSettings): void;
}

export function WorkspaceShell({ workspace, onBack, onUpdateWorkspace, workspaces, onOpenWorkspace, settings: appSettings, onSettingsApplied }: Props) {
  const { showToast } = useToast();
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState('');
  const [settings, setSettings] = useState<StackDockSettings | null>(appSettings ?? null);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [automation, setAutomation] = useState<AutomationConfig | null>(null);
  const sessionStore = useSessionStore();
  const allSessions = sessionStore.sessions;
  const sessions = allSessions.filter((session) => session.workspaceId === workspace.id);
  const activeTerminalId = sessions.some((session) => session.id === sessionStore.activeSessionId) ? sessionStore.activeSessionId : sessions[0]?.id ?? null;
  // Open editor/web tabs are tracked per terminal session: each session keeps
  // its own tab set, so switching sessions swaps the visible tabs and a brand
  // new session starts as just the terminal. The terminal is always tab #1; all
  // panes stay mounted (toggled via CSS) so scrollback and editor models survive
  // tab switches.
  const [editorsBySession, setEditorsBySession] = useState<Record<string, SessionEditors>>({});
  const activeEditors = (activeTerminalId ? editorsBySession[activeTerminalId] : undefined) ?? EMPTY_EDITORS;
  const openFiles = activeEditors.openFiles;
  const openLinks = activeEditors.openLinks;
  const activeFilePath = activeEditors.activeFile;
  const activeWebId = activeEditors.activeWeb;
  const contentTabCount = openFiles.length + openLinks.length;
  let mainView: MainTabKind = activeEditors.activeKind;
  if (mainView === 'editor' && !openFiles.length) mainView = 'terminal';
  if (mainView === 'web' && !openLinks.length) mainView = 'terminal';
  const [selectedGitFile, setSelectedGitFile] = useState<GitFileStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general');
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'git'>('explorer');
  const autoStartedRef = useRef<string | null>(null);
  const sessionsRef = useRef<WorkspaceTerminalSession[]>([]);

  const defaultProfile = useMemo(() => profiles[0], [profiles]);

  useEffect(() => {
    if (!appSettings) return;
    setSettings(appSettings);
    applyTheme(appSettings.themeId, appSettings.importedThemes);
  }, [appSettings]);
  const workspaceSetup = automation?.workspaces[workspace.id];
  const isRepo = !!git?.isRepo;

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
      const [loadedLayout, status, loadedSettings, terminalProfiles, loadedAutomation] = await Promise.all([
        api.workspaces.loadLayout(workspace.id),
        api.git.status(workspace.path),
        api.settings.load(),
        api.terminal.profiles(),
        api.automation.load(),
      ]);
      if (!active) return;
      setLayout(loadedLayout);
      setGit(status);
      setSettings(loadedSettings);
      applyTheme(loadedSettings.themeId, loadedSettings.importedThemes);
      onSettingsApplied?.(loadedSettings);
      setProfiles(terminalProfiles);
      setAutomation(loadedAutomation);
      const setup = loadedAutomation.workspaces[workspace.id];
      const setupProfile = setup?.defaultTerminalProfile && terminalProfiles.some((profile) => profile.id === setup?.defaultTerminalProfile) ? setup.defaultTerminalProfile : null;
      // Recreate the workspace's terminals (or open one default terminal) and
      // remember the first so previously-open files can be restored onto it.
      let firstSessionId: string | null = sessionsRef.current[0]?.id ?? null;
      let createdSessions = false;
      try {
        if (!sessionsRef.current.length && loadedLayout?.terminals.length) {
          for (const session of loadedLayout.terminals) {
            const created = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: session.profileId, cwd: session.cwd, name: session.name, startupCommand: session.startupCommand });
            firstSessionId ??= created.id;
            createdSessions = true;
          }
        } else if (!sessionsRef.current.length && terminalProfiles[0]) {
          const created = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: setupProfile ?? terminalProfiles[0].id, cwd: workspace.path, name: 'Terminal', startupCommand: setup?.newSessionCommand });
          firstSessionId ??= created.id;
          createdSessions = true;
        }
      } catch (error) {
        showToast(getErrorMessage(error, 'Could not create terminal'), 'error');
      }
      if (!active) return;
      // When we just cold-started this workspace's terminals, focus the first one
      // (each createSession activates the one it made, so the last would win).
      // Skip this when sessions already existed so an explicit session pick made
      // from the sidebar isn't clobbered as the workspace switches in.
      if (createdSessions && firstSessionId) sessionStore.setActiveSession(firstSessionId);
      if (firstSessionId && loadedLayout?.editors.openFiles.length) {
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
        const activeFile = loadedLayout.editors.activeFile ?? tabs[0]?.path ?? null;
        // Open on the terminal with the tabs available, rather than jumping
        // straight into the editor when the workspace loads.
        setEditorsBySession((map) => ({ ...map, [firstSessionId!]: { openFiles: tabs, openLinks: [], activeKind: 'terminal', activeFile, activeWeb: null } }));
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
          // Persist the union of files open across this workspace's sessions so
          // none are lost on reload; they restore onto the first terminal.
          openFiles: [...new Set(sessions.flatMap((session) => editorsBySession[session.id]?.openFiles.map((file) => file.path) ?? []))],
          activeFile: activeFilePath ?? undefined,
        },
        terminals: sessions,
      };
      api.workspaces.saveLayout(nextLayout).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(save);
  }, [workspace.id, layout, editorsBySession, activeFilePath, sessions]);

  // Drop per-session tab state once a session is closed so it doesn't leak.
  useEffect(() => {
    setEditorsBySession((map) => {
      const ids = new Set(allSessions.map((session) => session.id));
      const entries = Object.entries(map).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(map).length ? map : Object.fromEntries(entries);
    });
  }, [allSessions]);

  useEffect(() => {
    if (settings?.autoSave === false) return;
    const dirty = openFiles.filter((file) => file.dirty);
    if (!dirty.length) return;
    const delay = Math.max(200, settings?.autoSaveDelayMs ?? 1000);
    const timer = window.setTimeout(() => {
      for (const file of dirty) void saveFile(file.path, { silent: true });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [openFiles, activeTerminalId, settings?.autoSave, settings?.autoSaveDelayMs]);

  // Poll git so the branch/dirty count stays fresh and, crucially, so the Git
  // button appears moments after the user runs `git init` in the terminal.
  useEffect(() => {
    const configured = settings?.gitRefreshIntervalSeconds ?? 0;
    const everyMs = Math.max(2, configured > 0 ? configured : 5) * 1000;
    const tick = () => { if (document.visibilityState === 'visible') void refreshGit(); };
    const interval = window.setInterval(tick, everyMs);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', tick); };
  }, [workspace.path, settings?.gitRefreshIntervalSeconds, selectedGitFile?.path]);

  // If the repo goes away (or never existed), don't sit on a hidden Git tab.
  useEffect(() => {
    if (git && !git.isRepo && sidebarTab === 'git') setSidebarTab('explorer');
  }, [git?.isRepo, sidebarTab]);

  async function refreshGit() {
    const status = await api.git.status(workspace.path);
    setGit(status);
    if (selectedGitFile) {
      const currentFile = status.files.find((file) => file.path === selectedGitFile.path) ?? selectedGitFile;
      setSelectedGitFile(currentFile);
      setDiff(await api.git.diff(workspace.path, currentFile.path, currentFile.staged));
    }
  }

  // ---- Per-session tab state mutation ----
  function patchSession(sessionId: string | null, patch: (prev: SessionEditors) => SessionEditors) {
    if (!sessionId) return;
    setEditorsBySession((map) => ({ ...map, [sessionId]: patch(map[sessionId] ?? EMPTY_EDITORS) }));
  }
  function patchActive(patch: (prev: SessionEditors) => SessionEditors) {
    patchSession(activeTerminalId, patch);
  }

  const showTerminal = () => patchActive((prev) => ({ ...prev, activeKind: 'terminal' }));
  const selectFile = (path: string) => patchActive((prev) => ({ ...prev, activeKind: 'editor', activeFile: path }));
  const selectWeb = (id: string) => patchActive((prev) => ({ ...prev, activeKind: 'web', activeWeb: id }));

  function toggleMainView() {
    patchActive((prev) => {
      if (prev.activeKind !== 'terminal') return { ...prev, activeKind: 'terminal' };
      const next: MainTabKind = prev.openFiles.length ? 'editor' : prev.openLinks.length ? 'web' : 'terminal';
      return { ...prev, activeKind: next };
    });
  }

  async function openFile(path: string) {
    const sessionId = activeTerminalId;
    if (!sessionId) return;
    try {
      if ((editorsBySession[sessionId]?.openFiles ?? []).some((file) => file.path === path)) {
        patchSession(sessionId, (prev) => ({ ...prev, activeKind: 'editor', activeFile: path }));
        return;
      }
      const file = await api.fs.readFile(path);
      const tab: OpenFileTab = { path, name: path.split(/[\\/]/).pop() ?? path, content: file.content, dirty: false };
      patchSession(sessionId, (prev) => ({ ...prev, openFiles: [...prev.openFiles, tab], activeKind: 'editor', activeFile: path }));
    } catch (error) { showToast(getErrorMessage(error, 'Could not open file'), 'error'); }
  }

  function changeFile(path: string, content: string) {
    patchActive((prev) => ({ ...prev, openFiles: prev.openFiles.map((file) => (file.path === path ? { ...file, content, dirty: true } : file)) }));
  }

  async function saveFile(path: string, options?: { silent?: boolean }) {
    const sessionId = activeTerminalId;
    if (!sessionId) return;
    try {
      const file = (editorsBySession[sessionId]?.openFiles ?? []).find((item) => item.path === path);
      if (!file || !file.dirty) return;
      await api.fs.writeFile(path, file.content);
      patchSession(sessionId, (prev) => ({ ...prev, openFiles: prev.openFiles.map((item) => (item.path === path ? { ...item, dirty: false } : item)) }));
      await refreshGit();
      setRefreshToken((token) => token + 1);
      if (!options?.silent) showToast('File saved', 'success');
    } catch (error) { showToast(getErrorMessage(error, 'Could not save file'), 'error'); }
  }

  function closeFile(path: string) {
    patchActive((prev) => {
      const index = prev.openFiles.findIndex((file) => file.path === path);
      if (index < 0) return prev;
      const openFiles = prev.openFiles.filter((file) => file.path !== path);
      let activeFile = prev.activeFile;
      let activeKind = prev.activeKind;
      if (prev.activeFile === path) {
        activeFile = openFiles[index]?.path ?? openFiles[index - 1]?.path ?? null;
        if (!activeFile) activeKind = prev.openLinks.length ? 'web' : 'terminal';
      }
      return { ...prev, openFiles, activeFile, activeKind };
    });
  }

  // ---- Web (terminal link) tabs ----
  function openLink(url: string) {
    // Respect the user's preference to hand links off to the system browser.
    if (settings?.openLinksExternally) {
      void api.shell.openExternal(url).catch((error) => showToast(getErrorMessage(error, 'Could not open link'), 'error'));
      return;
    }
    if (!activeTerminalId) return;
    patchActive((prev) => {
      const existing = prev.openLinks.find((link) => link.url === url);
      if (existing) return { ...prev, activeKind: 'web', activeWeb: existing.id };
      const tab: WebTab = { id: crypto.randomUUID(), url, name: linkLabel(url) };
      return { ...prev, openLinks: [...prev.openLinks, tab], activeKind: 'web', activeWeb: tab.id };
    });
  }

  function closeLink(id: string) {
    patchActive((prev) => {
      const index = prev.openLinks.findIndex((link) => link.id === id);
      if (index < 0) return prev;
      const openLinks = prev.openLinks.filter((link) => link.id !== id);
      let activeWeb = prev.activeWeb;
      let activeKind = prev.activeKind;
      if (prev.activeWeb === id) {
        activeWeb = openLinks[index]?.id ?? openLinks[index - 1]?.id ?? null;
        if (!activeWeb) activeKind = prev.openFiles.length ? 'editor' : 'terminal';
      }
      return { ...prev, openLinks, activeWeb, activeKind };
    });
  }

  function setWebTitle(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setEditorsBySession((map) => {
      let changed = false;
      const next: Record<string, SessionEditors> = {};
      for (const [sessionId, entry] of Object.entries(map)) {
        const index = entry.openLinks.findIndex((link) => link.id === id);
        if (index >= 0 && entry.openLinks[index].name !== trimmed) {
          const openLinks = entry.openLinks.slice();
          openLinks[index] = { ...openLinks[index], name: trimmed };
          next[sessionId] = { ...entry, openLinks };
          changed = true;
        } else {
          next[sessionId] = entry;
        }
      }
      return changed ? next : map;
    });
  }

  async function runWorkspaceCommand(command: WorkspaceCommand) {
    await createTerminal(undefined, command.terminalName || command.name || 'Command', command.command, command.cwd || workspace.path);
    showToast(`Started ${command.name}`, 'success');
  }

  // Command-palette entries from automation.json (global or workspace-scoped).
  async function runPaletteCommand(command: PaletteCommand) {
    await createTerminal(undefined, command.label || 'Command', command.command, command.cwd?.trim() ? command.cwd : workspace.path);
    showToast(`Started ${command.label}`, 'success');
  }

  // profileId omitted => fall back to this workspace's configured default
  // profile, then the global default. An empty startupCommand picks up the
  // workspace's "run on new session" command from automation.json.
  async function createTerminal(profileId?: string, name = 'Terminal', startupCommand = '', cwd = workspace.path) {
    try {
      const requested = profileId ?? workspaceSetup?.defaultTerminalProfile ?? defaultProfile?.id ?? 'powershell';
      const effectiveProfile = profiles.some((profile) => profile.id === requested) ? requested : defaultProfile?.id ?? 'powershell';
      const effectiveStartup = startupCommand || (workspaceSetup?.newSessionCommand ?? '');
      // A new session starts with just the terminal (no tabs) by default.
      await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: effectiveProfile, cwd, name, startupCommand: effectiveStartup });
    } catch (error) { showToast(getErrorMessage(error, 'Could not create terminal'), 'error'); }
  }

  async function openTerminalHere(folderPath: string) {
    await createTerminal(undefined, baseName(folderPath) || 'Folder', '', folderPath);
  }

  async function renameTerminal(id: string, name: string) {
    sessionStore.renameSession(id, name);
  }

  async function restartTerminal(id: string, cwd?: string) {
    const old = allSessions.find((session) => session.id === id);
    if (!old) return;
    await api.terminal.kill(old.id);
    const next = await api.terminal.create(old.profileId, cwd ?? old.cwd, old.name, old.startupCommand);
    const replacement: WorkspaceTerminalSession = { ...next, workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath, splitGroupId: old.splitGroupId, splitDirection: old.splitDirection };
    sessionStore.replaceSession(id, replacement);
  }

  async function duplicateTerminal(id: string) {
    const source = allSessions.find((session) => session.id === id);
    if (!source) return;
    await sessionStore.createSession({ workspaceId: source.workspaceId, workspaceName: source.workspaceName, workspacePath: source.workspacePath, profileId: source.profileId, cwd: source.cwd, name: `${source.name} Copy`, startupCommand: source.startupCommand ?? '' });
  }

  async function setTerminalCwd(id: string, cwd: string) {
    if (!cwd.trim()) return;
    if (!window.confirm('Restart terminal in new cwd?')) return;
    await restartTerminal(id, cwd.trim());
  }

  async function splitTerminal(id: string, direction: 'row' | 'column') {
    const source = allSessions.find((session) => session.id === id);
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
    // Source control is only meaningful inside a repo.
    const target = tab === 'git' && !isRepo ? 'explorer' : tab;
    if (mergedLayout.panels.fileTreeVisible && sidebarTab === target) {
      updatePanels({ fileTreeVisible: false });
    } else {
      setSidebarTab(target);
      updatePanels({ fileTreeVisible: true });
    }
  }

  const defaultLayout = getDefaultLayout(workspace.id);
  const mergedLayout = layout ?? defaultLayout;
  const panelSizes = mergedLayout.panels.panelSizes ?? { sessions: 14, explorer: 18, main: 68, editor: 72, git: 28, upper: 62, terminal: 38 };
  const safePanelSizes = getSafePanelSizes(panelSizes, mergedLayout.panels.fileTreeVisible);
  const launcherActions: CommandAction[] = [
    // User-defined commands first so they're front-and-center in the palette.
    ...(workspaceSetup?.commands ?? []).map((command) => ({ id: `ws:${command.id}`, label: command.label, description: command.command, run: () => runPaletteCommand(command) })),
    ...(automation?.commands ?? []).map((command) => ({ id: `global:${command.id}`, label: command.label, description: command.command, run: () => runPaletteCommand(command) })),
    { id: 'new-terminal', label: 'New Terminal', run: () => createTerminal(undefined, 'Terminal', '') },
    { id: 'toggle-tree', label: 'Toggle Sidebar', run: () => updatePanels({ fileTreeVisible: !mergedLayout.panels.fileTreeVisible }) },
    { id: 'show-explorer', label: 'Show Explorer', run: () => selectSidebar('explorer') },
    ...(isRepo ? [{ id: 'show-git', label: 'Show Source Control', run: () => selectSidebar('git') }] : []),
    { id: 'show-terminal', label: 'Show Terminal', run: showTerminal },
    { id: 'refresh-git', label: 'Refresh Git', run: refreshGit },
    { id: 'edit-config', label: 'Edit Workspace Config (JSON)', run: () => { setSettingsInitialTab('workspace'); setSettingsOpen(true); } },
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
      if ((event.ctrlKey || event.metaKey) && event.key === '`') { event.preventDefault(); toggleMainView(); }
      if ((event.ctrlKey || event.metaKey) && key === 'b') { event.preventDefault(); updatePanels({ fileTreeVisible: !mergedLayout.panels.fileTreeVisible }); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'e') { event.preventDefault(); selectSidebar('explorer'); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'g') { event.preventDefault(); selectSidebar('git'); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 't') { event.preventDefault(); void createTerminal(undefined, 'Terminal', ''); }
      if ((event.ctrlKey || event.metaKey) && key === 'w') {
        if (mainView === 'web' && activeWebId) { event.preventDefault(); closeLink(activeWebId); }
        else if (activeFilePath) { event.preventDefault(); closeFile(activeFilePath); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFilePath, activeWebId, mainView, activeTerminalId, defaultProfile?.id, sidebarTab, mergedLayout.panels.fileTreeVisible, openFiles.length, openLinks.length, workspaceSetup, profiles]);

  return (
    <div className="workspace-shell workspace-terminal-mode">
      <header className="topbar compact-topbar">
        <div className="topbar-left">
          <button className="ghost topbar-back" onClick={onBack} title="Back to workspaces">‹ Back</button>
          <div className="topbar-nav">
            <button className={mergedLayout.panels.fileTreeVisible && sidebarTab === 'explorer' ? 'active-toggle' : ''} onClick={() => selectSidebar('explorer')}>Explorer</button>
            {isRepo ? <button className={mergedLayout.panels.fileTreeVisible && sidebarTab === 'git' ? 'active-toggle' : ''} onClick={() => selectSidebar('git')}>Git</button> : null}
          </div>
        </div>
        <div className="topbar-title">
          <h2>{workspace.name}</h2>
          <span className="muted">{workspace.path}</span>
        </div>
        <div className="topbar-actions">
          <span className="topbar-status" title={`${git?.files.length ?? 0} changed file(s)`}>
            <span className="status-branch">{git?.branch ?? 'no branch'}</span>
            <span className="status-dirty">{git?.files.length ?? 0}</span>
          </span>
          {workspace.commands?.slice(0, 3).map((command) => <button key={command.id} className="ghost" onClick={() => runWorkspaceCommand(command)}>{command.name}</button>)}
          <button className="ghost" onClick={() => setCommandsOpen(true)}>Commands</button>
          <button className="ghost" onClick={() => { setSettingsInitialTab('general'); setSettingsOpen(true); }}>Settings</button>
          <button className="ghost" onClick={() => void api.fs.revealInExplorer(workspace.path)}>Open Folder</button>
        </div>
      </header>

      <PanelGroup key={mergedLayout.panels.fileTreeVisible ? 'with-explorer' : 'without-explorer'} direction="horizontal" className="workspace-body with-global-sessions" onLayout={([sessionsSize, explorer, main]) => updatePanelSizes(mergedLayout.panels.fileTreeVisible ? { sessions: sessionsSize, explorer, main } : { sessions: sessionsSize, main: explorer })}>
        <Panel id="sessions" order={1} defaultSize={safePanelSizes.sessions} minSize={10} className="global-sessions-panel">
          <GlobalSessionsSidebar
            workspaces={workspaces}
            activeWorkspaceId={workspace.id}
            activeSessionId={sessionStore.activeSessionId}
            sessions={allSessions}
            profiles={profiles}
            defaultProfileId={workspaceSetup?.defaultTerminalProfile ?? settings?.defaultTerminalProfileId}
            emptySessionsVisible={!!settings?.emptySessionsVisible}
            showSessionCwdForAll={!!settings?.showSessionCwdForAll}
            onCreateSession={async (target, profileId) => { const setup = automation?.workspaces[target.id]; await sessionStore.createSession({ workspaceId: target.id, workspaceName: target.name, workspacePath: target.path, profileId, cwd: target.path, name: 'Terminal', startupCommand: setup?.newSessionCommand }); if (target.id !== workspace.id) await onOpenWorkspace(target.id); }}
            onSelectSession={(id) => { const target = allSessions.find((session) => session.id === id); sessionStore.setActiveSession(id); if (target && target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId); }}
            onOpenWorkspace={(id) => void onOpenWorkspace(id)}
            onCloseSession={(id) => void closeTerminal(id)}
            onRenameSession={renameTerminal}
            onRestartSession={(id) => void restartTerminal(id)}
            onDuplicateSession={(id) => void duplicateTerminal(id)}
            onSetCwd={(id, cwd) => void setTerminalCwd(id, cwd)}
            onSplitSession={(id, direction) => void splitTerminal(id, direction)}
          />
        </Panel>
        <PanelResizeHandle id="sessions-resize" className="resize-handle vertical" />
        {mergedLayout.panels.fileTreeVisible ? (
          <>
            <Panel id="explorer" order={2} defaultSize={safePanelSizes.explorer} minSize={12} className="workspace-explorer">
              {sidebarTab === 'git' && isRepo ? (
                <GitPanel status={git} diff={diff} error={gitError} selectedFile={selectedGitFile} onSelectFile={selectGitFile} onStage={stage} onStageAll={stageAll} onUnstage={unstage} onDiscard={discard} onCommit={commit} onRefresh={refreshGit} />
              ) : (
                <FileTree rootPath={workspace.path} gitFiles={git?.files ?? []} onOpenFile={openFile} onOpenTerminalHere={openTerminalHere} refreshToken={refreshToken} />
              )}
            </Panel>
            <PanelResizeHandle id="explorer-resize" className="resize-handle vertical" />
          </>
        ) : null}
        <Panel id="main" order={3} defaultSize={safePanelSizes.main} minSize={30}>
          <div className="workspace-main-area main-tabbed">
            {/* Tabs only appear once something beyond the terminal is open; with
                just the terminal there is nothing to switch between. */}
            {contentTabCount > 0 ? (
              <div className="editor-tabbar main-tabbar">
                <div className="tab-strip">
                  <div
                    className={`tab main-terminal-tab${mainView === 'terminal' ? ' active' : ''}`}
                    title="Terminal"
                    onClick={showTerminal}
                  >
                    <span className="tab-name">Terminal</span>
                  </div>
                  {openFiles.map((file) => (
                    <div
                      key={file.path}
                      className={`tab${mainView === 'editor' && file.path === activeFilePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}`}
                      title={file.path}
                      onClick={() => selectFile(file.path)}
                      onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeFile(file.path); } }}
                    >
                      <span className="tab-name">{file.name}</span>
                      <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeFile(file.path); }}>
                        <span className="dot">●</span><span className="x">×</span>
                      </span>
                    </div>
                  ))}
                  {openLinks.map((link) => (
                    <div
                      key={link.id}
                      className={`tab web-tab-chip${mainView === 'web' && link.id === activeWebId ? ' active' : ''}`}
                      title={link.url}
                      onClick={() => selectWeb(link.id)}
                      onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeLink(link.id); } }}
                    >
                      <span className="tab-icon" aria-hidden>🌐</span>
                      <span className="tab-name">{link.name}</span>
                      <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeLink(link.id); }}>
                        <span className="x">×</span>
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
            ) : null}
            <div className="main-tab-content">
              <div className="main-tab-pane" style={{ display: mainView === 'terminal' ? 'flex' : 'none' }}>
                <TerminalPanel sessions={sessions} activeId={activeTerminalId} onOpenLink={openLink} settings={settings} />
              </div>
              <div className="main-tab-pane" style={{ display: mainView === 'editor' ? 'flex' : 'none' }}>
                {openFiles.length ? (
                  <Suspense fallback={<div className="empty-pad muted">Loading editor…</div>}>
                    <EditorPanel openFiles={openFiles} activePath={activeFilePath} onOpenFile={selectFile} onChangeFile={changeFile} onSaveFile={saveFile} onCloseFile={closeFile} settings={settings ?? undefined} showTabs={false} />
                  </Suspense>
                ) : (
                  <div className="empty-pad muted">Open file to edit.</div>
                )}
              </div>
              <div className="main-tab-pane" style={{ display: mainView === 'web' ? 'flex' : 'none' }}>
                <WebTabPanel tabs={openLinks} activeId={activeWebId} onTitle={setWebTitle} />
              </div>
            </div>
          </div>
        </Panel>
      </PanelGroup>
      {commandsOpen ? <WorkspaceCommandsModal workspace={workspace} onSave={onUpdateWorkspace} onRun={runWorkspaceCommand} onClose={() => setCommandsOpen(false)} /> : null}
      <CommandLauncher open={launcherOpen} actions={launcherActions} onClose={() => setLauncherOpen(false)} />
      {settingsOpen && settings ? <SettingsModal settings={settings} currentWorkspaceId={workspace.id} initialTab={settingsInitialTab} onSave={async (next) => { const saved = await api.settings.save(next); setSettings(saved); applyTheme(saved.themeId, saved.importedThemes); onSettingsApplied?.(saved); setProfiles(await api.terminal.profiles()); }} onAutomationSaved={(config) => setAutomation(config)} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSafePanelSizes(panelSizes: NonNullable<WorkspaceLayout['panels']['panelSizes']>, explorerVisible: boolean) {
  const sessions = clamp(panelSizes.sessions ?? 14, 10, 24);
  if (!explorerVisible) return { sessions, explorer: panelSizes.explorer ?? 18, main: 100 - sessions };

  const maxExplorer = Math.max(12, 100 - sessions - 30);
  const explorer = clamp(panelSizes.explorer ?? 18, 12, maxExplorer);
  const main = Math.max(30, 100 - sessions - explorer);
  return { sessions, explorer, main };
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
