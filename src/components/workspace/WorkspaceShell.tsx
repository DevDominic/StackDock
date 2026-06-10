import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { AutomationConfig, GitFileStatus, GitStatus, PaletteCommand, StackDockSettings, TerminalPersistedTab, TerminalProfile, Workspace, WorkspaceLayout, WorkspaceTerminalSession } from '../../shared/types';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../common/ToastProvider';
import { useSessionStore } from '../../state/sessionStore';
import type { EditorDiffMode, EditorDiffModel, MediaKind, OpenFileTab } from './EditorPanel';
import { WebTabPanel, type WebTab } from './WebTabPanel';
import { TerminalPanel } from './TerminalPanel';
import { CommandLauncher, type CommandAction } from './CommandLauncher';
import { SessionSwitcher } from './SessionSwitcher';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import { StatusBar } from './StatusBar';
import { applyTheme } from '../../lib/themeSupport';
import { useExtensions } from '../../extensions/ExtensionProvider';
import { getEnabledStatusBarContributions, getEnabledViewContributions, resolveEnabledExtensions } from '../../extensions/registry';
import type { WorkspaceExtensionContext } from '../../extensions/extensionTypes';
import { WindowControls } from '../TitleBar';
import { FolderIcon, FolderOpenIcon, GitBranchIcon, HomeIcon, PanelLeftIcon, SettingsIcon } from '../icons';
import { resolveTerminalStartupCommand } from '../../shared/terminalProfiles';

const EditorPanel = lazy(() => import('./EditorPanel.js').then((module) => ({ default: module.EditorPanel })));

// Which kind of content tab is showing in the shared main area for a session.
type MainTabKind = 'terminal' | 'editor' | 'web';

type SplitDirection = 'left' | 'right' | 'up' | 'down';
type EditorSplitOrientation = 'horizontal' | 'vertical';

interface EditorGroup {
  id: string;
  openFiles: OpenFileTab[];
  activeFile: string | null;
}

// All editor/web tab state for a single terminal session.
interface SessionEditors {
  editorGroups: EditorGroup[];
  activeEditorGroup: string;
  splitOrientation: EditorSplitOrientation;
  openLinks: WebTab[];
  activeKind: MainTabKind;
  activeWeb: string | null;
}

function createEditorGroup(openFiles: OpenFileTab[] = [], activeFile: string | null = openFiles[0]?.path ?? null): EditorGroup {
  return { id: crypto.randomUUID(), openFiles, activeFile };
}

const EMPTY_EDITORS: SessionEditors = { editorGroups: [createEditorGroup([], null)], activeEditorGroup: '', splitOrientation: 'horizontal', openLinks: [], activeKind: 'terminal', activeWeb: null };

function normalizeEditors(entry: SessionEditors | undefined): SessionEditors {
  if (!entry) {
    const group = createEditorGroup([], null);
    return { ...EMPTY_EDITORS, editorGroups: [group], activeEditorGroup: group.id };
  }
  const editorGroups = entry.editorGroups.length ? entry.editorGroups : [createEditorGroup([], null)];
  const activeEditorGroup = editorGroups.some((group) => group.id === entry.activeEditorGroup) ? entry.activeEditorGroup : editorGroups[0].id;
  return { ...entry, editorGroups, activeEditorGroup };
}

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

const mediaExtensions: Record<string, MediaKind> = {
  apng: 'image', avif: 'image', bmp: 'image', gif: 'image', ico: 'image', jpeg: 'image', jpg: 'image', png: 'image', svg: 'image', webp: 'image',
  aac: 'audio', flac: 'audio', m4a: 'audio', mp3: 'audio', oga: 'audio', ogg: 'audio', wav: 'audio',
  m4v: 'video', mov: 'video', mp4: 'video', ogv: 'video', webm: 'video',
};

function mediaKindForPath(targetPath: string): MediaKind | null {
  const ext = baseName(targetPath).split('.').pop()?.toLowerCase() ?? '';
  return mediaExtensions[ext] ?? null;
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function isPiSnapshotOutput(output?: string) {
  if (!output) return false;
  const text = stripAnsi(output);
  return /\bpi\s+v\d+\.\d+\.\d+/i.test(text) && /(Model scope:|caveman level:|OpenAI cache|\bMCP:\s*\d+\/\d+)/i.test(text);
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
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [editorDiff, setEditorDiff] = useState<EditorDiffModel | null>(null);
  const [diffMode, setDiffMode] = useState<EditorDiffMode>('side-by-side');
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
  const activeEditors = normalizeEditors(activeTerminalId ? editorsBySession[activeTerminalId] : undefined);
  const activeEditorGroup = activeEditors.editorGroups.find((group) => group.id === activeEditors.activeEditorGroup) ?? activeEditors.editorGroups[0];
  const openFiles = activeEditors.editorGroups.flatMap((group) => group.openFiles);
  const openLinks = activeEditors.openLinks;
  const activeFilePath = activeEditorGroup.activeFile;
  const activeWebId = activeEditors.activeWeb;
  const contentTabCount = openFiles.length + openLinks.length;
  let mainView: MainTabKind = activeEditors.activeKind;
  if (mainView === 'editor' && !openFiles.length) mainView = 'terminal';
  if (mainView === 'web' && !openLinks.length) mainView = 'terminal';
  const [selectedGitFile, setSelectedGitFile] = useState<GitFileStatus | null>(null);
  const [selectedGitStaged, setSelectedGitStaged] = useState(false);
  const [selectedStagedGitPaths, setSelectedStagedGitPaths] = useState<string[]>([]);
  const [selectedChangeGitPaths, setSelectedChangeGitPaths] = useState<string[]>([]);
  const [lastSelectedGitPath, setLastSelectedGitPath] = useState<{ group: 'staged' | 'changes'; path: string } | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general');
  const [tabMenu, setTabMenu] = useState<{ file: OpenFileTab; groupId: string; x: number; y: number } | null>(null);
  const [terminalTabMenu, setTerminalTabMenu] = useState<{ x: number; y: number } | null>(null);
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const autoStartedRef = useRef<string | null>(null);
  const sessionsRef = useRef<WorkspaceTerminalSession[]>([]);
  const savedLayoutRef = useRef<WorkspaceLayout | null>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);

  const defaultProfile = useMemo(() => profiles[0], [profiles]);
  const extensionRegistry = useExtensions();

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
    setLayoutHydrated(false);
    (async () => {
      const [loadedLayout, status, loadedSettings, terminalProfiles, loadedAutomation, persistedTerminals] = await Promise.all([
        api.workspaces.loadLayout(workspace.id),
        api.git.status(workspace.path),
        api.settings.load(),
        api.terminal.profiles(),
        api.automation.load(),
        api.terminal.restoreState(),
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
        const persistedWorkspaceTerminals = (persistedTerminals?.tabs ?? []).filter((session): session is TerminalPersistedTab => session.workspaceId === workspace.id || session.workspacePath === workspace.path);
        const restoreById = new Map<string, WorkspaceLayout['terminals'][number] | TerminalPersistedTab>();
        for (const session of loadedLayout?.terminals ?? []) restoreById.set(session.restoreId ?? session.id, session);
        for (const session of persistedWorkspaceTerminals) restoreById.set(session.restoreId ?? session.id, session);
        const terminalsToRestore = [...restoreById.values()];
        const persistedActiveRestoreId = persistedWorkspaceTerminals[persistedWorkspaceTerminals.length - 1]?.restoreId;
        if (!sessionsRef.current.length && terminalsToRestore.length) {
          let restoredActiveRuntimeId: string | null = null;
          for (const session of terminalsToRestore) {
            const snapshot = session.restoreId ? await api.terminal.snapshot(session.restoreId).catch(() => null) : null;
            const piResumeCommand = session.piResumeCommand ?? snapshot?.piResumeCommand;
            const startupCommand = 'resumeStartupCommand' in session && session.resumeStartupCommand ? session.resumeStartupCommand : piResumeCommand || session.startupCommand || (isPiSnapshotOutput(snapshot?.output) ? 'pi -r' : undefined);
            const created = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: session.profileId, cwd: session.cwd, name: session.name, startupCommand, restoreId: session.restoreId });
            const restoredSession = { ...created, originalStartupCommand: session.originalStartupCommand ?? session.startupCommand, piSessionId: session.piSessionId ?? snapshot?.piSessionId, piResumeCommand, restoredFromSnapshot: true, splitGroupId: session.splitGroupId, splitDirection: session.splitDirection };
            sessionStore.replaceSession(created.id, restoredSession);
            if (session.restoreId && (session.restoreId === loadedLayout?.activeTerminalRestoreId || session.restoreId === persistedActiveRestoreId)) restoredActiveRuntimeId = restoredSession.id;
            if (session.id === loadedLayout?.activeTerminalRuntimeId) restoredActiveRuntimeId = restoredSession.id;
            firstSessionId ??= restoredSession.id;
            createdSessions = true;
          }
          if (restoredActiveRuntimeId) firstSessionId = restoredActiveRuntimeId;
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
        const paths = [...new Set(loadedLayout.editors.openFiles)];
        const tabByPath = new Map<string, OpenFileTab>();
        for (const filePath of paths) {
          try {
            const mediaKind = mediaKindForPath(filePath);
            if (mediaKind) {
              const media = await api.fs.readFileDataUrl(filePath);
              tabByPath.set(filePath, { path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: '', dirty: false, mediaKind, mimeType: media.mimeType, dataUrl: media.dataUrl });
            } else {
              const file = await api.fs.readFile(filePath);
              tabByPath.set(filePath, { path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: file.content, dirty: false });
            }
          } catch {
            tabByPath.set(filePath, { path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: '', dirty: false });
          }
        }
        if (!active) return;
        const groupsFromLayout = loadedLayout.editors.groups?.length
          ? loadedLayout.editors.groups.map((savedGroup) => {
              const tabs = savedGroup.openFiles.map((filePath) => tabByPath.get(filePath)).filter(Boolean) as OpenFileTab[];
              return createEditorGroup(tabs, savedGroup.activeFile ?? tabs[0]?.path ?? null);
            }).filter((group) => group.openFiles.length)
          : [];
        const fallbackTabs = paths.map((filePath) => tabByPath.get(filePath)).filter(Boolean) as OpenFileTab[];
        const editorGroups = groupsFromLayout.length ? groupsFromLayout : [createEditorGroup(fallbackTabs, loadedLayout.editors.activeFile ?? fallbackTabs[0]?.path ?? null)];
        const activeGroup = editorGroups[Math.min(loadedLayout.editors.activeGroupIndex ?? 0, editorGroups.length - 1)] ?? editorGroups[0];
        // Open on the terminal with the tabs available, rather than jumping
        // straight into the editor when the workspace loads.
        setEditorsBySession((map) => ({ ...map, [firstSessionId!]: { editorGroups, activeEditorGroup: activeGroup.id, splitOrientation: loadedLayout.editors.splitOrientation ?? 'horizontal', openLinks: [], activeKind: 'terminal', activeWeb: null } }));
      }
      // Run any per-workspace commands flagged to auto-start when the workspace opens.
      if (setup?.commands?.length && autoStartedRef.current !== workspace.id) {
        autoStartedRef.current = workspace.id;
        for (const command of setup.commands.filter((item) => item.autoStart)) {
          await runPaletteCommand(command);
        }
      }
      if (active) setLayoutHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, [workspace.id]);

  useEffect(() => {
    sessionStore.setActiveWorkspace(workspace.id);
  }, [workspace.id]);

  useEffect(() => {
    if (!layoutHydrated) return;
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
        // none are lost on reload; split groups restore from the active session.
        openFiles: [...new Set(sessions.flatMap((session) => normalizeEditors(editorsBySession[session.id]).editorGroups.flatMap((group) => group.openFiles.map((file) => file.path))))],
        activeFile: activeFilePath ?? undefined,
        groups: activeEditors.editorGroups.map((group) => ({ openFiles: group.openFiles.map((file) => file.path), activeFile: group.activeFile ?? undefined })),
        activeGroupIndex: Math.max(0, activeEditors.editorGroups.findIndex((group) => group.id === activeEditors.activeEditorGroup)),
        splitOrientation: activeEditors.splitOrientation,
      },
      activeTerminalRestoreId: activeTerminalId ? sessions.find((session) => session.id === activeTerminalId)?.restoreId : undefined,
      activeTerminalRuntimeId: activeTerminalId ?? undefined,
      terminals: sessions,
    };
    savedLayoutRef.current = nextLayout;
    const save = window.setTimeout(() => {
      api.workspaces.saveLayout(nextLayout).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(save);
  }, [workspace.id, layout, editorsBySession, activeFilePath, sessions, layoutHydrated]);

  useEffect(() => () => {
    const latest = savedLayoutRef.current;
    if (latest) void api.workspaces.saveLayout(latest).catch(() => undefined);
  }, []);

  // Drop per-session tab state once a session is closed so it doesn't leak.
  useEffect(() => {
    setEditorsBySession((map) => {
      const ids = new Set(allSessions.map((session) => session.id));
      const entries = Object.entries(map).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(map).length ? map : Object.fromEntries(entries);
    });
  }, [allSessions]);

  useEffect(() => {
    if (!tabMenu && !terminalTabMenu) return;
    const close = () => { setTabMenu(null); setTerminalTabMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('resize', close); window.removeEventListener('keydown', onKey); };
  }, [tabMenu, terminalTabMenu]);

  // Track whether the tab strip overflows so the scroll chevrons (which also
  // signal hidden tabs) only show when there's something off-screen.
  function updateTabOverflow() {
    const el = tabStripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setTabOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }

  useEffect(() => {
    updateTabOverflow();
    const el = tabStripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateTabOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentTabCount, activeEditorGroup.id, openLinks.length, activeEditors.editorGroups.length]);

  function scrollTabs(direction: -1 | 1) {
    const el = tabStripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' });
  }

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

  // If the repo goes away (or never existed), hide Source Control and clear its selection.
  useEffect(() => {
    if (git && !git.isRepo) {
      updatePanels({ gitPanelVisible: false });
      setSelectedStagedGitPaths([]);
      setSelectedChangeGitPaths([]);
      setLastSelectedGitPath(null);
    }
  }, [git?.isRepo]);

  async function loadEditorDiff(file: GitFileStatus, staged = file.staged && !file.unstaged) {
    const contents = await api.git.fileContents(workspace.path, file.path, staged);
    setEditorDiff({ path: joinPath(workspace.path, file.path), original: contents.original, staged, untracked: file.untracked });
  }

  async function refreshGit() {
    const status = await api.git.status(workspace.path);
    setGit(status);
    const stagedPaths = new Set(status.files.filter((file) => file.staged && !file.untracked).map((file) => file.path));
    const changePaths = new Set(status.files.filter((file) => file.unstaged || file.untracked).map((file) => file.path));
    setSelectedStagedGitPaths((paths) => paths.filter((path) => stagedPaths.has(path)));
    setSelectedChangeGitPaths((paths) => paths.filter((path) => changePaths.has(path)));
    setLastSelectedGitPath((last) => last && ((last.group === 'staged' && stagedPaths.has(last.path)) || (last.group === 'changes' && changePaths.has(last.path))) ? last : null);
    if (selectedGitFile) {
      const currentFile = status.files.find((file) => file.path === selectedGitFile.path);
      if (currentFile) {
        const staged = selectedGitStaged && currentFile.staged ? true : !currentFile.unstaged && currentFile.staged;
        setSelectedGitFile(currentFile);
        setSelectedGitStaged(staged);
        await loadEditorDiff(currentFile, staged);
      } else {
        setSelectedGitFile(null);
        setEditorDiff(null);
      }
    }
  }

  // ---- Per-session tab state mutation ----
  function patchSession(sessionId: string | null, patch: (prev: SessionEditors) => SessionEditors) {
    if (!sessionId) return;
    setEditorsBySession((map) => ({ ...map, [sessionId]: normalizeEditors(patch(normalizeEditors(map[sessionId]))) }));
  }
  function patchActive(patch: (prev: SessionEditors) => SessionEditors) {
    patchSession(activeTerminalId, patch);
  }

  const showTerminal = () => patchActive((prev) => ({ ...prev, activeKind: 'terminal' }));
  const selectFile = (path: string, groupId?: string) => patchActive((prev) => {
    const targetGroup = (groupId ? prev.editorGroups.find((group) => group.id === groupId) : prev.editorGroups.find((group) => group.openFiles.some((file) => file.path === path))) ?? prev.editorGroups[0];
    return {
      ...prev,
      activeKind: 'editor',
      activeEditorGroup: targetGroup.id,
      editorGroups: prev.editorGroups.map((group) => (group.id === targetGroup.id ? { ...group, activeFile: path } : group)),
    };
  });
  const selectWeb = (id: string) => patchActive((prev) => ({ ...prev, activeKind: 'web', activeWeb: id }));

  function toggleMainView() {
    patchActive((prev) => {
      if (prev.activeKind !== 'terminal') return { ...prev, activeKind: 'terminal' };
      const next: MainTabKind = prev.editorGroups.some((group) => group.openFiles.length) ? 'editor' : prev.openLinks.length ? 'web' : 'terminal';
      return { ...prev, activeKind: next };
    });
  }

  async function openFile(path: string, groupId?: string) {
    const sessionId = activeTerminalId;
    if (!sessionId) return;
    try {
      const current = normalizeEditors(editorsBySession[sessionId]);
      const existingGroup = current.editorGroups.find((group) => group.openFiles.some((file) => file.path === path));
      const targetGroupId = groupId ?? existingGroup?.id ?? current.activeEditorGroup;
      if (existingGroup && !groupId) {
        patchSession(sessionId, (prev) => ({
          ...prev,
          activeKind: 'editor',
          activeEditorGroup: existingGroup.id,
          editorGroups: prev.editorGroups.map((group) => (group.id === existingGroup.id ? { ...group, activeFile: path } : group)),
        }));
        return;
      }
      const mediaKind = mediaKindForPath(path);
      const tab: OpenFileTab = mediaKind
        ? (() => {
            return { path, name: path.split(/[\\/]/).pop() ?? path, content: '', dirty: false, mediaKind };
          })()
        : { path, name: path.split(/[\\/]/).pop() ?? path, content: (await api.fs.readFile(path)).content, dirty: false };
      if (mediaKind) {
        const media = await api.fs.readFileDataUrl(path);
        tab.dataUrl = media.dataUrl;
        tab.mimeType = media.mimeType;
      }
      patchSession(sessionId, (prev) => ({
        ...prev,
        activeKind: 'editor',
        activeEditorGroup: targetGroupId,
        editorGroups: prev.editorGroups.map((group) => (
          group.id === targetGroupId
            ? { ...group, openFiles: group.openFiles.some((item) => item.path === path) ? group.openFiles : [...group.openFiles, tab], activeFile: path }
            : group
        )),
      }));
    } catch (error) { showToast(getErrorMessage(error, 'Could not open file'), 'error'); }
  }

  function changeFile(path: string, content: string) {
    patchActive((prev) => ({
      ...prev,
      editorGroups: prev.editorGroups.map((group) => ({ ...group, openFiles: group.openFiles.map((file) => (file.path === path ? { ...file, content, dirty: true } : file)) })),
    }));
  }

  async function saveFile(path: string, options?: { silent?: boolean }) {
    const sessionId = activeTerminalId;
    if (!sessionId) return;
    try {
      const file = normalizeEditors(editorsBySession[sessionId]).editorGroups.flatMap((group) => group.openFiles).find((item) => item.path === path);
      if (!file || !file.dirty) return;
      await api.fs.writeFile(path, file.content);
      patchSession(sessionId, (prev) => ({ ...prev, editorGroups: prev.editorGroups.map((group) => ({ ...group, openFiles: group.openFiles.map((item) => (item.path === path ? { ...item, dirty: false } : item)) })) }));
      await refreshGit();
      setRefreshToken((token) => token + 1);
      if (!options?.silent) showToast('File saved', 'success');
    } catch (error) { showToast(getErrorMessage(error, 'Could not save file'), 'error'); }
  }

  function closeFile(path: string, groupId?: string) {
    patchActive((prev) => {
      let anyOpenFiles = 0;
      const editorGroups = prev.editorGroups.map((group) => {
        if (groupId && group.id !== groupId) {
          anyOpenFiles += group.openFiles.length;
          return group;
        }
        const index = group.openFiles.findIndex((file) => file.path === path);
        if (index < 0) {
          anyOpenFiles += group.openFiles.length;
          return group;
        }
        const openFiles = group.openFiles.filter((file) => file.path !== path);
        let activeFile = group.activeFile;
        if (group.activeFile === path) activeFile = openFiles[index]?.path ?? openFiles[index - 1]?.path ?? null;
        anyOpenFiles += openFiles.length;
        return { ...group, openFiles, activeFile };
      }).filter((group, _index, groups) => group.openFiles.length || groups.length === 1);
      return { ...prev, editorGroups, activeKind: anyOpenFiles ? prev.activeKind : prev.openLinks.length ? 'web' : 'terminal' };
    });
  }

  // "Close Others" from the permanent Terminal tab: drop every file and web tab
  // for the active session and fall back to the terminal view.
  function closeAllContentTabs() {
    patchActive((prev) => {
      const group = createEditorGroup([], null);
      return { ...prev, editorGroups: [group], activeEditorGroup: group.id, openLinks: [], activeKind: 'terminal', activeWeb: null };
    });
  }

  function closeOthers(path: string, groupId: string) {
    patchActive((prev) => ({
      ...prev,
      editorGroups: prev.editorGroups.map((group) => group.id === groupId ? { ...group, openFiles: group.openFiles.filter((file) => file.path === path), activeFile: path } : group),
      activeEditorGroup: groupId,
    }));
  }

  function closeToSide(path: string, groupId: string, side: 'left' | 'right') {
    patchActive((prev) => ({
      ...prev,
      editorGroups: prev.editorGroups.map((group) => {
        if (group.id !== groupId) return group;
        const index = group.openFiles.findIndex((file) => file.path === path);
        if (index < 0) return group;
        const openFiles = group.openFiles.filter((_file, fileIndex) => side === 'left' ? fileIndex >= index : fileIndex <= index);
        const activeFile = openFiles.some((file) => file.path === group.activeFile) ? group.activeFile : path;
        return { ...group, openFiles, activeFile };
      }),
    }));
  }

  function splitFile(path: string, groupId: string, direction: SplitDirection) {
    patchActive((prev) => {
      const sourceIndex = prev.editorGroups.findIndex((group) => group.id === groupId);
      if (sourceIndex < 0) return prev;
      const source = prev.editorGroups[sourceIndex];
      const file = source.openFiles.find((item) => item.path === path);
      if (!file) return prev;
      const nextGroup = createEditorGroup([{ ...file }], path);
      const insertIndex = direction === 'left' || direction === 'up' ? sourceIndex : sourceIndex + 1;
      const editorGroups = prev.editorGroups.slice();
      editorGroups.splice(insertIndex, 0, nextGroup);
      return {
        ...prev,
        editorGroups,
        activeKind: 'editor',
        activeEditorGroup: nextGroup.id,
        splitOrientation: direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical',
      };
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
        if (!activeWeb) activeKind = prev.editorGroups.some((group) => group.openFiles.length) ? 'editor' : 'terminal';
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

  // Commands from automation.json (global or workspace-scoped). The optional
  // terminalName names the spawned terminal; cwd falls back to the workspace.
  async function runPaletteCommand(command: PaletteCommand) {
    await createTerminal(undefined, command.terminalName || command.label || 'Command', command.command, command.cwd?.trim() ? command.cwd : workspace.path);
    showToast(`Started ${command.label}`, 'success');
  }

  // profileId omitted => fall back to this workspace's configured default
  // profile, then the global default. An empty startupCommand picks up the
  // workspace's "run on new session" command from automation.json.
  async function createTerminal(profileId?: string, name = 'Terminal', startupCommand = '', cwd = workspace.path) {
    try {
      const requested = profileId ?? workspaceSetup?.defaultTerminalProfile ?? defaultProfile?.id ?? 'powershell';
      const effectiveProfile = profiles.some((profile) => profile.id === requested) ? requested : defaultProfile?.id ?? 'powershell';
      const selectedProfile = profiles.find((profile) => profile.id === effectiveProfile);
      const effectiveStartup = resolveTerminalStartupCommand({ explicitStartupCommand: startupCommand, profileStartupCommand: selectedProfile?.startupCommand, workspaceStartupCommand: workspaceSetup?.newSessionCommand });
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
    const next = await api.terminal.create(old.profileId, cwd ?? old.cwd, old.name, old.piResumeCommand || old.startupCommand, old.restoreId, { workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath });
    const replacement: WorkspaceTerminalSession = { ...next, workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath, originalStartupCommand: old.originalStartupCommand ?? old.startupCommand, piSessionId: old.piSessionId, piResumeCommand: old.piResumeCommand, splitGroupId: old.splitGroupId, splitDirection: old.splitDirection };
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

  async function openGitDiff(file: GitFileStatus, staged = file.staged && !file.unstaged) {
    const absolutePath = joinPath(workspace.path, file.path);
    const contents = await api.git.fileContents(workspace.path, file.path, staged);
    setSelectedGitFile(file);
    setSelectedGitStaged(staged);
    setEditorDiff({ path: absolutePath, original: contents.original, staged, untracked: file.untracked });
    patchActive((prev) => {
      const targetGroupId = prev.activeEditorGroup;
      const tab: OpenFileTab = { path: absolutePath, name: absolutePath.split(/[\\/]/).pop() ?? absolutePath, content: contents.modified, dirty: false };
      return {
        ...prev,
        activeKind: 'editor',
        activeEditorGroup: targetGroupId,
        editorGroups: prev.editorGroups.map((group) => {
          if (group.id !== targetGroupId) return group;
          const exists = group.openFiles.some((item) => item.path === absolutePath);
          const openFiles = exists
            ? group.openFiles.map((item) => (item.path === absolutePath && !item.dirty ? { ...item, content: contents.modified } : item))
            : [...group.openFiles, tab];
          return { ...group, openFiles, activeFile: absolutePath };
        }),
      };
    });
  }

  async function selectGitFile(file: GitFileStatus, staged = file.staged && !file.unstaged, event?: MouseEvent<HTMLButtonElement>, groupFiles: GitFileStatus[] = []) {
    try {
      setGitError(null);
      const group: 'staged' | 'changes' = staged ? 'staged' : 'changes';
      const currentPaths = group === 'staged' ? selectedStagedGitPaths : selectedChangeGitPaths;
      let nextPaths = [file.path];
      if (event?.shiftKey && lastSelectedGitPath?.group === group) {
        const start = groupFiles.findIndex((item) => item.path === lastSelectedGitPath.path);
        const end = groupFiles.findIndex((item) => item.path === file.path);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          nextPaths = groupFiles.slice(from, to + 1).map((item) => item.path);
        }
      } else if (event?.ctrlKey || event?.metaKey) {
        nextPaths = currentPaths.includes(file.path) ? currentPaths.filter((path) => path !== file.path) : [...currentPaths, file.path];
        if (!nextPaths.length) nextPaths = [file.path];
      }
      if (group === 'staged') { setSelectedStagedGitPaths(nextPaths); setSelectedChangeGitPaths([]); }
      else { setSelectedChangeGitPaths(nextPaths); setSelectedStagedGitPaths([]); }
      setLastSelectedGitPath({ group, path: file.path });
      await openGitDiff(file, staged);
    } catch (error) { showGitError(error); }
  }

  async function stage(path: string) {
    try { setGitError(null); await api.git.stage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function stagePaths(paths: string[]) {
    try { setGitError(null); for (const path of paths) await api.git.stage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function stageAll() {
    try { setGitError(null); await api.git.addAll(workspace.path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function unstage(path: string) {
    try { setGitError(null); await api.git.unstage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function unstagePaths(paths: string[]) {
    try { setGitError(null); for (const path of paths) await api.git.unstage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function discardPath(path: string) {
    const file = selectedGitFile?.path === path ? selectedGitFile : git?.files.find((item) => item.path === path);
    if (file?.untracked) await api.fs.deletePath(joinPath(workspace.path, path));
    else await api.git.discard(workspace.path, path);
  }

  async function discard(path: string) {
    if (settings?.confirmBeforeDiscard !== false && !window.confirm(`Discard changes in ${path}? This cannot be undone.`)) return;
    try {
      setGitError(null);
      await discardPath(path);
      await refreshGit();
      setRefreshToken((token) => token + 1);
    } catch (error) { showGitError(error); }
  }

  async function discardPaths(paths: string[]) {
    if (!paths.length) return;
    if (settings?.confirmBeforeDiscard !== false && !window.confirm(`Discard changes in ${paths.length} selected ${paths.length === 1 ? 'file' : 'files'}? This cannot be undone.`)) return;
    try {
      setGitError(null);
      for (const path of paths) await discardPath(path);
      await refreshGit();
      setRefreshToken((token) => token + 1);
    } catch (error) { showGitError(error); }
  }

  async function commit(message: string) {
    try { setGitError(null); await api.git.commit(workspace.path, message); await refreshGit(); showToast('Commit created', 'success'); } catch (error) { showGitError(error); showToast(getErrorMessage(error, 'Commit failed'), 'error'); }
  }

  function selectSidebar(tab: 'explorer' | 'git') {
    if (tab === 'git' && !isRepo) return;
    if (tab === 'explorer') updatePanels({ fileTreeVisible: !mergedLayout.panels.fileTreeVisible });
    else updatePanels({ gitPanelVisible: !mergedLayout.panels.gitPanelVisible });
  }

  const defaultLayout = getDefaultLayout(workspace.id);
  const mergedLayout = layout ?? defaultLayout;
  const extensionCtx: WorkspaceExtensionContext = {
    workspace,
    settings,
    git,
    sessions,
    allSessions,
    activeSessionId: activeTerminalId,
    isRepo,
    refreshToken,
    actions: {
      openFile,
      openTerminalHere,
      openGit: () => selectSidebar('git'),
      refreshGit,
      revealFolder: (targetPath = workspace.path) => void api.fs.revealInExplorer(targetPath),
      selectSession: (id) => { const target = allSessions.find((session) => session.id === id); sessionStore.setActiveSession(id); if (target && target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId); },
      createSession: () => createTerminal(undefined, 'Terminal', ''),
    },
    workspaces,
    profiles,
    defaultProfileId: workspaceSetup?.defaultTerminalProfile ?? settings?.defaultTerminalProfileId,
    emptySessionsVisible: !!settings?.emptySessionsVisible,
    showSessionCwdForAll: !!settings?.showSessionCwdForAll,
    gitActions: {
      error: gitError,
      selectedFile: selectedGitFile,
      selectedStagedPaths: selectedStagedGitPaths,
      selectedChangePaths: selectedChangeGitPaths,
      selectFile: selectGitFile,
      stage,
      stageSelected: stagePaths,
      stageAll,
      unstage,
      unstageSelected: unstagePaths,
      discard,
      discardSelected: discardPaths,
      commit,
    },
    sessionActions: {
      create: async (target, profileId) => { const setup = automation?.workspaces[target.id]; const profile = profiles.find((item) => item.id === profileId); const startupCommand = resolveTerminalStartupCommand({ profileStartupCommand: profile?.startupCommand, workspaceStartupCommand: setup?.newSessionCommand }); await sessionStore.createSession({ workspaceId: target.id, workspaceName: target.name, workspacePath: target.path, profileId, cwd: target.path, name: 'Terminal', startupCommand }); if (target.id !== workspace.id) await onOpenWorkspace(target.id); },
      openWorkspace: (id) => void onOpenWorkspace(id),
      close: (id) => void closeTerminal(id),
      rename: renameTerminal,
      restart: (id) => void restartTerminal(id),
      duplicate: (id) => void duplicateTerminal(id),
      setCwd: (id, cwd) => void setTerminalCwd(id, cwd),
      split: (id, direction) => void splitTerminal(id, direction),
    },
  };
  const enabledExtensions = resolveEnabledExtensions(extensionRegistry.extensions, settings, mergedLayout.extensions);
  const statusBarContributions = getEnabledStatusBarContributions(enabledExtensions, extensionCtx);
  const sessionContributions = getEnabledViewContributions(enabledExtensions, 'sessions', extensionCtx);
  const activityContributions = getEnabledViewContributions(enabledExtensions, 'activity', extensionCtx);
  const sessionContribution = sessionContributions.find((item) => item.extensionId === 'stackdock.sessions');
  const explorerContribution = activityContributions.find((item) => item.extensionId === 'stackdock.explorer');
  const gitContribution = activityContributions.find((item) => item.extensionId === 'stackdock.git');
  const renderExtensionView = (contribution: typeof activityContributions[number]) => extensionRegistry.nativeExtensions.get(contribution.extensionId)?.renderView?.(contribution, extensionCtx) ?? null;
  const sessionsExtensionEnabled = !!sessionContribution;
  const explorerExtensionEnabled = !!explorerContribution;
  const gitExtensionEnabled = !!gitContribution;
  const explorerVisible = explorerExtensionEnabled && !!mergedLayout.panels.fileTreeVisible;
  const gitVisible = gitExtensionEnabled && !!mergedLayout.panels.gitPanelVisible && isRepo;
  const sidebarVisible = explorerVisible || gitVisible;
  const sessionsVisible = sessionsExtensionEnabled && mergedLayout.panels.sessionsVisible !== false;
  const panelSizes = mergedLayout.panels.panelSizes ?? { sessions: 14, explorer: 18, main: 68, editor: 72, git: 28, upper: 62, terminal: 38 };
  const safePanelSizes = getSafePanelSizes(panelSizes, sidebarVisible, sessionsVisible);
  const launcherActions: CommandAction[] = [
    // User-defined commands first so they're front-and-center in the palette.
    ...(workspaceSetup?.commands ?? []).map((command) => ({ id: `ws:${command.id}`, label: command.label, description: command.command, run: () => runPaletteCommand(command) })),
    ...(automation?.commands ?? []).map((command) => ({ id: `global:${command.id}`, label: command.label, description: command.command, run: () => runPaletteCommand(command) })),
    { id: 'new-terminal', label: 'New Terminal', run: () => createTerminal(undefined, 'Terminal', '') },
    { id: 'toggle-tree', label: 'Toggle Sidebar', run: () => updatePanels({ fileTreeVisible: !explorerVisible, gitPanelVisible: false }) },
    { id: 'show-explorer', label: 'Show Explorer', run: () => selectSidebar('explorer') },
    ...(isRepo ? [{ id: 'show-git', label: 'Show Source Control', run: () => selectSidebar('git') }] : []),
    { id: 'show-terminal', label: 'Show Terminal', run: showTerminal },
    { id: 'refresh-git', label: 'Refresh Git', run: refreshGit },
    { id: 'edit-config', label: 'Edit Workspace Config (JSON)', run: () => { setSettingsInitialTab('workspace'); setSettingsOpen(true); } },
    { id: 'open-folder', label: 'Open Workspace Folder', run: () => api.fs.revealInExplorer(workspace.path) },
  ];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'p') { event.preventDefault(); setLauncherOpen(true); return; }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'p') { event.preventDefault(); setSessionSwitcherOpen(true); return; }
      if (inField) return;
      if ((event.ctrlKey || event.metaKey) && event.key === '`') { event.preventDefault(); toggleMainView(); }
      if ((event.ctrlKey || event.metaKey) && key === 'b') { event.preventDefault(); updatePanels({ fileTreeVisible: !explorerVisible, gitPanelVisible: false }); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'e') { event.preventDefault(); selectSidebar('explorer'); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'g') { event.preventDefault(); selectSidebar('git'); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 't') { event.preventDefault(); void createTerminal(undefined, 'Terminal', ''); }
      if ((event.ctrlKey || event.metaKey) && key === 'w') {
        if (mainView === 'web' && activeWebId) { event.preventDefault(); closeLink(activeWebId); }
        else if (activeFilePath) { event.preventDefault(); closeFile(activeFilePath, activeEditors.activeEditorGroup); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFilePath, activeWebId, mainView, activeTerminalId, defaultProfile?.id, explorerVisible, gitVisible, openFiles.length, openLinks.length, workspaceSetup, profiles]);

  return (
    <div className="workspace-shell workspace-terminal-mode">
      <header className="topbar compact-topbar workspace-titlebar">
        <div className="topbar-left">
          <button className="topbar-icon-btn" onClick={onBack} title="Back to workspaces" aria-label="Back to workspaces"><HomeIcon /></button>
          <span className="topbar-divider" aria-hidden />
          <div className="topbar-nav">
            {sessionsExtensionEnabled ? <button className={sessionsVisible ? 'topbar-icon-btn active-toggle' : 'topbar-icon-btn'} onClick={() => updatePanels({ sessionsVisible: !sessionsVisible })} title="Toggle Sessions" aria-label="Toggle Sessions"><PanelLeftIcon /></button> : null}
            {explorerExtensionEnabled ? <button className={explorerVisible ? 'topbar-icon-btn active-toggle' : 'topbar-icon-btn'} onClick={() => selectSidebar('explorer')} title="Explorer" aria-label="Explorer"><FolderIcon /></button> : null}
            {isRepo && gitExtensionEnabled ? <button className={gitVisible ? 'topbar-icon-btn active-toggle' : 'topbar-icon-btn'} onClick={() => selectSidebar('git')} title="Source Control" aria-label="Source Control"><GitBranchIcon /></button> : null}
          </div>
        </div>
        <div className="topbar-title">
          <h2>{workspace.name}</h2>
          <span className="muted">{workspace.path}</span>
        </div>
        <div className="topbar-right">
          <div className="topbar-actions">
            {editorDiff && !editorDiff.untracked ? (
              <div className="diff-mode-control" role="group" aria-label="Editor diff display mode">
                <button className={diffMode === 'inline' ? 'active-toggle' : ''} onClick={() => setDiffMode('inline')}>Inline</button>
                <button className={diffMode === 'side-by-side' ? 'active-toggle' : ''} onClick={() => setDiffMode('side-by-side')}>Side by side</button>
                <button className={diffMode === 'compare-only' ? 'active-toggle' : ''} onClick={() => setDiffMode('compare-only')}>Compare only</button>
              </div>
            ) : null}
            <button className="topbar-icon-btn" onClick={() => { setSettingsInitialTab('general'); setSettingsOpen(true); }} title="Settings" aria-label="Settings"><SettingsIcon /></button>
            <button className="topbar-icon-btn" onClick={() => void api.fs.revealInExplorer(workspace.path)} title="Open Folder" aria-label="Open Folder"><FolderOpenIcon /></button>
          </div>
          <span className="topbar-divider" aria-hidden />
          <WindowControls />
        </div>
      </header>

      <PanelGroup key={`${sessionsVisible ? 'sessions' : 'no-sessions'}-${sidebarVisible ? 'with-sidebar' : 'without-sidebar'}`} direction="horizontal" className="workspace-body with-global-sessions" onLayout={(sizes) => { let i = 0; const next: NonNullable<WorkspaceLayout['panels']['panelSizes']> = {}; if (sessionsVisible) next.sessions = sizes[i++]; if (sidebarVisible) next.explorer = sizes[i++]; next.main = sizes[i++]; updatePanelSizes(next); }}>
        {sessionsVisible ? (
          <>
            <Panel id="sessions" order={1} defaultSize={safePanelSizes.sessions} minSize={10} className="global-sessions-panel">
              {sessionContribution ? renderExtensionView(sessionContribution) : null}
            </Panel>
            <PanelResizeHandle id="sessions-resize" className="resize-handle vertical" />
          </>
        ) : null}
        {sidebarVisible ? (
          <>
            <Panel id="explorer" order={2} defaultSize={safePanelSizes.explorer} minSize={12} className="workspace-explorer">
              {explorerVisible && gitVisible ? (
                <PanelGroup direction="vertical" className="sidebar-stack" onLayout={([upper, gitSize]) => updatePanelSizes({ upper, git: gitSize })}>
                  <Panel id="sidebar-files" defaultSize={panelSizes.upper ?? 58} minSize={20}>
                    {explorerContribution ? renderExtensionView(explorerContribution) : null}
                  </Panel>
                  <PanelResizeHandle id="sidebar-stack-resize" className="resize-handle horizontal" />
                  <Panel id="sidebar-git" defaultSize={panelSizes.git ?? 42} minSize={20}>
                    {gitContribution ? renderExtensionView(gitContribution) : null}
                  </Panel>
                </PanelGroup>
              ) : gitVisible ? (
                gitContribution ? renderExtensionView(gitContribution) : null
              ) : (
                explorerContribution ? renderExtensionView(explorerContribution) : null
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
                {tabOverflow.left ? (
                  <button className="tab-scroll-btn left" onClick={() => scrollTabs(-1)} title="Scroll tabs left" aria-label="Scroll tabs left">‹</button>
                ) : null}
                <div className="tab-strip" ref={tabStripRef} onScroll={updateTabOverflow} onWheel={(event) => { if (event.deltaY !== 0 && tabStripRef.current) tabStripRef.current.scrollLeft += event.deltaY; }}>
                  <div
                    className={`tab main-terminal-tab${mainView === 'terminal' ? ' active' : ''}`}
                    title="Terminal"
                    onClick={showTerminal}
                    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTerminalTabMenu({ x: event.clientX, y: event.clientY }); }}
                  >
                    <span className="tab-name">Terminal</span>
                  </div>
                  {activeEditorGroup.openFiles.map((file) => (
                    <div
                      key={`${activeEditorGroup.id}:${file.path}`}
                      className={`tab${mainView === 'editor' && file.path === activeFilePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}`}
                      title={file.path}
                      onClick={() => selectFile(file.path, activeEditorGroup.id)}
                      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTabMenu({ file, groupId: activeEditorGroup.id, x: event.clientX, y: event.clientY }); }}
                      onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeFile(file.path, activeEditorGroup.id); } }}
                    >
                      <span className="tab-name">{file.name}</span>
                      <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeFile(file.path, activeEditorGroup.id); }}>
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
                {tabOverflow.right ? (
                  <button className="tab-scroll-btn right" onClick={() => scrollTabs(1)} title="Scroll tabs right" aria-label="Scroll tabs right">›</button>
                ) : null}
                {mainView === 'editor' && activeFilePath ? (
                  <div className="editor-tab-actions">
                    <button className="ghost" onClick={() => saveFile(activeFilePath)}>Save</button>
                    <button className="ghost" onClick={() => api.fs.revealInExplorer(activeFilePath)}>Reveal</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {terminalTabMenu ? (
              <div className="context-menu tab-context-menu" style={{ top: terminalTabMenu.y, left: terminalTabMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
                <button className="context-menu-item" disabled={contentTabCount === 0} onClick={() => { closeAllContentTabs(); setTerminalTabMenu(null); }}>Close Others</button>
              </div>
            ) : null}
            <div className="main-tab-content">
              <div className="main-tab-pane" style={{ display: mainView === 'terminal' ? 'flex' : 'none' }}>
                <TerminalPanel sessions={sessions} activeId={activeTerminalId} onOpenLink={openLink} settings={settings} isVisible={mainView === 'terminal'} onAttachmentError={(message) => showToast(message, 'error')} />
              </div>
              <div className="main-tab-pane" style={{ display: mainView === 'editor' ? 'flex' : 'none' }}>
                {openFiles.length ? (
                  <Suspense fallback={<div className="empty-pad muted">Loading editor…</div>}>
                    <PanelGroup direction={activeEditors.splitOrientation === 'horizontal' ? 'horizontal' : 'vertical'} className="editor-split-group">
                      {activeEditors.editorGroups.flatMap((group, index) => [
                        <Panel key={group.id} id={`editor-${group.id}`} minSize={20} className={group.id === activeEditors.activeEditorGroup ? 'editor-group-pane active' : 'editor-group-pane'}>
                          <div className="editor-group-shell" onMouseDown={() => patchActive((prev) => ({ ...prev, activeEditorGroup: group.id }))}>
                            <EditorPanel openFiles={group.openFiles} activePath={group.activeFile} onOpenFile={(path) => selectFile(path, group.id)} onChangeFile={changeFile} onSaveFile={saveFile} onCloseFile={(path) => closeFile(path, group.id)} settings={settings ?? undefined} diff={editorDiff} diffMode={diffMode} showTabs={false} visible={mainView === 'editor'} />
                          </div>
                        </Panel>,
                        index < activeEditors.editorGroups.length - 1 ? <PanelResizeHandle key={`${group.id}:resize`} className={activeEditors.splitOrientation === 'horizontal' ? 'resize-handle vertical' : 'resize-handle horizontal'} /> : null,
                      ])}
                    </PanelGroup>
                  </Suspense>
                ) : (
                  <div className="empty-pad muted">Open file to edit.</div>
                )}
                {tabMenu ? (
                  <div className="context-menu tab-context-menu" style={{ top: tabMenu.y, left: tabMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
                    <button className="context-menu-item" onClick={() => { splitFile(tabMenu.file.path, tabMenu.groupId, 'left'); setTabMenu(null); }}>Split Left</button>
                    <button className="context-menu-item" onClick={() => { splitFile(tabMenu.file.path, tabMenu.groupId, 'right'); setTabMenu(null); }}>Split Right</button>
                    <button className="context-menu-item" onClick={() => { splitFile(tabMenu.file.path, tabMenu.groupId, 'up'); setTabMenu(null); }}>Split Up</button>
                    <button className="context-menu-item" onClick={() => { splitFile(tabMenu.file.path, tabMenu.groupId, 'down'); setTabMenu(null); }}>Split Down</button>
                    <button className="context-menu-item" onClick={() => { closeFile(tabMenu.file.path, tabMenu.groupId); setTabMenu(null); }}>Close</button>
                    <button className="context-menu-item" onClick={() => { closeOthers(tabMenu.file.path, tabMenu.groupId); setTabMenu(null); }}>Close Others</button>
                    <button className="context-menu-item" onClick={() => { closeToSide(tabMenu.file.path, tabMenu.groupId, 'right'); setTabMenu(null); }}>Close to Right</button>
                    <button className="context-menu-item" onClick={() => { closeToSide(tabMenu.file.path, tabMenu.groupId, 'left'); setTabMenu(null); }}>Close to Left</button>
                  </div>
                ) : null}
              </div>
              <div className="main-tab-pane" style={{ display: mainView === 'web' ? 'flex' : 'none' }}>
                <WebTabPanel tabs={openLinks} activeId={activeWebId} onTitle={setWebTitle} />
              </div>
            </div>
          </div>
        </Panel>
      </PanelGroup>
      <StatusBar contributions={statusBarContributions} ctx={extensionCtx} nativeExtensions={extensionRegistry.nativeExtensions} />
      <CommandLauncher open={launcherOpen} actions={launcherActions} onClose={() => setLauncherOpen(false)} />
      <SessionSwitcher
        open={sessionSwitcherOpen}
        sessions={allSessions}
        activeSessionId={sessionStore.activeSessionId}
        onSelect={(id) => { const target = allSessions.find((session) => session.id === id); sessionStore.setActiveSession(id); if (target && target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId); }}
        onClose={() => setSessionSwitcherOpen(false)}
      />
      {settingsOpen && settings ? <SettingsModal settings={settings} currentWorkspaceId={workspace.id} initialTab={settingsInitialTab} onSave={async (next) => { const saved = await api.settings.save(next); setSettings(saved); applyTheme(saved.themeId, saved.importedThemes); onSettingsApplied?.(saved); setProfiles(await api.terminal.profiles()); }} onAutomationSaved={(config) => setAutomation(config)} onRunCommand={(command) => void runPaletteCommand(command)} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSafePanelSizes(panelSizes: NonNullable<WorkspaceLayout['panels']['panelSizes']>, explorerVisible: boolean, sessionsVisible = true) {
  const sessions = sessionsVisible ? clamp(panelSizes.sessions ?? 14, 10, 24) : 0;
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
