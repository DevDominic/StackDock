import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { AutomationConfig, GitFileStatus, GitStatus, PaletteCommand, StackDockSettings, TerminalPersistedTab, TerminalProfile, TerminalSplitSide, Workspace, WorkspaceLayout, WorkspaceTerminalSession } from '../../shared/types';
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
import { getExtensionConfig } from '../../extensions/configuration';
import type { WorkspaceExtensionContext } from '../../extensions/extensionTypes';
import { WindowControls } from '../TitleBar';
import { FolderIcon, FolderOpenIcon, GitBranchIcon, HomeIcon, PanelLeftIcon, SettingsIcon } from '../icons';
import { resolveTerminalStartupCommand } from '../../shared/terminalProfiles';
import { keybindMatchesEvent, isEditableTarget } from '../../shared/keybinds';

const EditorPanel = lazy(() => import('./EditorPanel.js').then((module) => ({ default: module.EditorPanel })));

// Which kind of content tab is showing in the shared main area for a session.
type MainTabKind = 'terminal' | 'editor' | 'web';

type SplitDirection = 'left' | 'right' | 'up' | 'down';
type EditorSplitOrientation = 'horizontal' | 'vertical';

const SESSION_DRAG_MIME = 'application/x-stackdock-session-id';
function sideToDirection(side: TerminalSplitSide): 'row' | 'column' { return side === 'left' || side === 'right' ? 'row' : 'column'; }
function isBeforeSide(side: TerminalSplitSide) { return side === 'left' || side === 'up'; }
function getDropSide(event: DragEvent, element: HTMLElement): TerminalSplitSide {
  const rect = element.getBoundingClientRect();
  const x = (event.clientX - rect.left) / Math.max(1, rect.width);
  const y = (event.clientY - rect.top) / Math.max(1, rect.height);
  if (x < 0.3) return 'left';
  if (x > 0.7) return 'right';
  return y < 0.5 ? 'up' : 'down';
}

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
  webSplit: 'right' | 'left' | 'up' | 'down' | null;
}

function createEditorGroup(openFiles: OpenFileTab[] = [], activeFile: string | null = openFiles[0]?.path ?? null): EditorGroup {
  return { id: crypto.randomUUID(), openFiles, activeFile };
}

const EMPTY_EDITORS: SessionEditors = { editorGroups: [createEditorGroup([], null)], activeEditorGroup: '', splitOrientation: 'horizontal', openLinks: [], activeKind: 'terminal', activeWeb: null, webSplit: null };

function normalizeEditors(entry: SessionEditors | undefined): SessionEditors {
  if (!entry) {
    const group = createEditorGroup([], null);
    return { ...EMPTY_EDITORS, editorGroups: [group], activeEditorGroup: group.id };
  }
  const editorGroups = entry.editorGroups.length ? entry.editorGroups : [createEditorGroup([], null)];
  const activeEditorGroup = editorGroups.some((group) => group.id === entry.activeEditorGroup) ? entry.activeEditorGroup : editorGroups[0].id;
  return { ...entry, editorGroups, activeEditorGroup, webSplit: entry.webSplit ?? null };
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

function fileUrlFromPath(targetPath: string) {
  const normalized = targetPath.replace(/\\/g, '/');
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = withRoot.split('/').map((part, index) => (index === 1 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))).join('/');
  return `file://${encoded}`;
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

function isHtmlFile(targetPath: string) {
  return /\.html?$/i.test(targetPath);
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
  const headlessRuns = sessionStore.headlessRuns;
  const [inspectHeadlessRunId, setInspectHeadlessRunId] = useState<string | null>(null);
  const sessions = allSessions.filter((session) => session.workspaceId === workspace.id);
  const activeTerminalId = sessions.some((session) => session.id === sessionStore.activeSessionId) ? sessionStore.activeSessionId : sessions[0]?.id ?? null;
  const [htmlPreviewBySession, setHtmlPreviewBySession] = useState<Record<string, string | null>>({});
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
  const webSplit = activeEditors.webSplit && openLinks.length ? activeEditors.webSplit : null;
  const primaryView = webSplit && mainView === 'web' ? 'terminal' : mainView;
  const activeHtmlPreviewPath = activeTerminalId ? htmlPreviewBySession[activeTerminalId] ?? null : null;
  const activeHtmlPreview = !!activeFilePath && activeHtmlPreviewPath === activeFilePath;
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
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<{ file: OpenFileTab; groupId: string; x: number; y: number } | null>(null);
  const [terminalTabMenu, setTerminalTabMenu] = useState<{ x: number; y: number } | null>(null);
  const [sessionDropSide, setSessionDropSide] = useState<TerminalSplitSide | null>(null);
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
  const gitExtensionId = extensionRegistry.extensions.find((manifest) => manifest.capabilities?.includes('git'))?.id;
  const gitConfig = getExtensionConfig(settings, gitExtensionId ?? '', { confirmBeforeDiscard: true, refreshIntervalSeconds: 1 });

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
            const resumeCommand = 'resumeStartupCommand' in session ? session.resumeStartupCommand : session.resumeState?.resumeCommand ?? snapshot?.resumeState?.resumeCommand;
            const startupCommand = resumeCommand || session.startupCommand;
            const created = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: session.profileId, cwd: session.cwd, name: session.name, startupCommand, restoreId: session.restoreId });
            const restoredSession = { ...created, originalStartupCommand: session.originalStartupCommand ?? session.startupCommand, resumeState: session.resumeState ?? snapshot?.resumeState, restoredFromSnapshot: true, ...('resumeStartupCommand' in session ? { resumeStartupCommand: session.resumeStartupCommand ?? '' } : {}), splitGroupId: session.splitGroupId, splitDirection: session.splitDirection };
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
        setEditorsBySession((map) => ({ ...map, [firstSessionId!]: { editorGroups, activeEditorGroup: activeGroup.id, splitOrientation: loadedLayout.editors.splitOrientation ?? 'horizontal', openLinks: [], activeKind: 'terminal', activeWeb: null, webSplit: null } }));
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
    const disposeData = api.onTerminalHeadlessData((payload) => {
      sessionStore.appendHeadlessOutput(payload.id, payload.data);
    });
    const disposeResult = api.onTerminalHeadlessResult((payload) => {
      const liveRunOutput = useSessionStore.getState().headlessRuns.find((run) => run.id === payload.id)?.output.trim();
      sessionStore.removeSessionLocal(payload.id);
      sessionStore.completeHeadlessRun(payload.id, payload);
      const output = liveRunOutput || payload.output.trim();
      const displayOutput = output || (payload.timedOut ? 'Timed out' : 'Completed');
      showToast(
        <span className="headless-toast-body">
          <strong>{payload.label ?? 'Command'}</strong>
          <pre>{displayOutput}</pre>
        </span>,
        payload.exitCode === 0 && !payload.timedOut ? 'success' : 'error',
        { onClick: () => { setInspectHeadlessRunId(payload.id); openView('stackdock.headless.view'); } },
      );
    });
    return () => { disposeData(); disposeResult(); };
  }, [showToast]);

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

  // Drop per-session tab/preview state once a session is closed so it doesn't leak.
  useEffect(() => {
    const ids = new Set(allSessions.map((session) => session.id));
    setEditorsBySession((map) => {
      const entries = Object.entries(map).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(map).length ? map : Object.fromEntries(entries);
    });
    setHtmlPreviewBySession((map) => {
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

  const openCapturedLinkRef = useRef(openCapturedLink);
  openCapturedLinkRef.current = openCapturedLink;
  useEffect(() => api.onOpenUrlRequest(({ url, sessionId }) => openCapturedLinkRef.current(url, sessionId)), []);

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
    const configured = Number(gitConfig.refreshIntervalSeconds) || 1;
    const everyMs = Math.max(1, configured) * 1000;
    const tick = () => { if (document.visibilityState === 'visible') void refreshGit(); };
    const interval = window.setInterval(tick, everyMs);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', tick); };
  }, [workspace.path, gitConfig.refreshIntervalSeconds, selectedGitFile?.path]);

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
  const selectWeb = (id: string) => patchActive((prev) => prev.webSplit ? { ...prev, activeWeb: id } : { ...prev, activeKind: 'web', activeWeb: id });

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
        const existingFile = existingGroup.openFiles.find((file) => file.path === path);
        const refreshedFile = existingFile && !existingFile.dirty
          ? existingFile.mediaKind
            ? await api.fs.readFileDataUrl(path).then((media) => ({ ...existingFile, dataUrl: media.dataUrl, mimeType: media.mimeType }))
            : await api.fs.readFile(path).then((file) => ({ ...existingFile, content: file.content }))
          : null;
        patchSession(sessionId, (prev) => ({
          ...prev,
          activeKind: 'editor',
          activeEditorGroup: existingGroup.id,
          editorGroups: prev.editorGroups.map((group) => (group.id === existingGroup.id ? {
            ...group,
            activeFile: path,
            openFiles: group.openFiles.map((file) => (file.path === path && refreshedFile && !file.dirty ? refreshedFile : file)),
          } : group)),
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

  async function promptSaveBeforeClose(files: OpenFileTab[]) {
    for (const file of files.filter((item) => item.dirty)) {
      const shouldSave = window.confirm(`Save changes to ${file.name} before closing?`);
      if (!shouldSave) return false;
      await saveFile(file.path, { silent: true });
    }
    return true;
  }

  async function closeFile(path: string, groupId?: string) {
    const file = activeEditors.editorGroups.flatMap((group) => group.openFiles).find((item) => item.path === path);
    if (file && !(await promptSaveBeforeClose([file]))) return;
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
  async function closeAllContentTabs() {
    if (!(await promptSaveBeforeClose(activeEditors.editorGroups.flatMap((group) => group.openFiles)))) return;
    patchActive((prev) => {
      const group = createEditorGroup([], null);
      return { ...prev, editorGroups: [group], activeEditorGroup: group.id, openLinks: [], activeKind: 'terminal', activeWeb: null, webSplit: null };
    });
  }

  async function closeOthers(path: string, groupId: string) {
    const closing = activeEditors.editorGroups.find((group) => group.id === groupId)?.openFiles.filter((file) => file.path !== path) ?? [];
    if (!(await promptSaveBeforeClose(closing))) return;
    patchActive((prev) => ({
      ...prev,
      editorGroups: prev.editorGroups.map((group) => group.id === groupId ? { ...group, openFiles: group.openFiles.filter((file) => file.path === path), activeFile: path } : group),
      activeEditorGroup: groupId,
    }));
  }

  async function closeToSide(path: string, groupId: string, side: 'left' | 'right') {
    const group = activeEditors.editorGroups.find((item) => item.id === groupId);
    const index = group?.openFiles.findIndex((file) => file.path === path) ?? -1;
    const closing = group && index >= 0 ? group.openFiles.filter((_file, fileIndex) => side === 'left' ? fileIndex < index : fileIndex > index) : [];
    if (!(await promptSaveBeforeClose(closing))) return;
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

  // ---- Web (terminal link / HTML preview) tabs ----
  async function previewFile(path: string) {
    const sessionId = activeTerminalId;
    if (!sessionId) return;
    await openFile(path);
    await saveFile(path, { silent: true });
    setHtmlPreviewBySession((map) => ({ ...map, [sessionId]: path }));
  }

  async function toggleHtmlPreview(path: string) {
    if (!activeTerminalId) return;
    if (activeHtmlPreview) {
      setHtmlPreviewBySession((map) => ({ ...map, [activeTerminalId]: null }));
      return;
    }
    await saveFile(path, { silent: true });
    setHtmlPreviewBySession((map) => ({ ...map, [activeTerminalId]: path }));
  }

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

  // Browser opens captured from terminal tools (via the loopback bridge). Unlike
  // openLink this deliberately ignores openLinksExternally: injecting the env vars
  // was the explicit opt-in, and the capture setting is the escape hatch.
  function openCapturedLink(url: string, sessionId?: string) {
    const target = sessionId && allSessions.some((session) => session.id === sessionId)
      ? allSessions.find((session) => session.id === sessionId)!
      : null;
    const targetSessionId = target?.id ?? activeTerminalId;
    if (!targetSessionId) return;
    const mode = settings?.capturedLinkOpenMode ?? 'tab';
    const split = mode === 'tab' ? null : (mode.replace('split-', '') as 'right' | 'left' | 'up' | 'down');
    patchSession(targetSessionId, (prev) => {
      const existing = prev.openLinks.find((link) => link.url === url);
      const base = split
        ? { ...prev, webSplit: split }
        : { ...prev, activeKind: 'web' as const };
      if (existing) return { ...base, activeWeb: existing.id };
      const tab: WebTab = { id: crypto.randomUUID(), url, name: linkLabel(url) };
      return { ...base, openLinks: [...prev.openLinks, tab], activeWeb: tab.id };
    });
    if (target) {
      sessionStore.setActiveSession(target.id);
      if (target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId);
    }
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
      return { ...prev, openLinks, activeWeb, activeKind, webSplit: openLinks.length ? prev.webSplit : null };
    });
  }

  function showTerminalFor(sessionId: string) { patchSession(sessionId, (prev) => ({ ...prev, activeKind: 'terminal' })); }
  function selectFileFor(sessionId: string, path: string, groupId?: string) { patchSession(sessionId, (prev) => {
    const targetGroup = (groupId ? prev.editorGroups.find((group) => group.id === groupId) : prev.editorGroups.find((group) => group.openFiles.some((file) => file.path === path))) ?? prev.editorGroups[0];
    return { ...prev, activeKind: 'editor', activeEditorGroup: targetGroup.id, editorGroups: prev.editorGroups.map((group) => group.id === targetGroup.id ? { ...group, activeFile: path } : group) };
  }); }
  function selectWebFor(sessionId: string, id: string) { patchSession(sessionId, (prev) => prev.webSplit ? { ...prev, activeWeb: id } : { ...prev, activeKind: 'web', activeWeb: id }); }
  function changeFileFor(sessionId: string, path: string, content: string) { patchSession(sessionId, (prev) => ({ ...prev, editorGroups: prev.editorGroups.map((group) => ({ ...group, openFiles: group.openFiles.map((file) => file.path === path ? { ...file, content, dirty: true } : file) })) })); }
  async function saveFileFor(sessionId: string, path: string, options?: { silent?: boolean }) {
    try {
      const file = normalizeEditors(editorsBySession[sessionId]).editorGroups.flatMap((group) => group.openFiles).find((item) => item.path === path);
      if (!file || !file.dirty) return;
      await api.fs.writeFile(path, file.content);
      patchSession(sessionId, (prev) => ({ ...prev, editorGroups: prev.editorGroups.map((group) => ({ ...group, openFiles: group.openFiles.map((item) => item.path === path ? { ...item, dirty: false } : item) })) }));
      await refreshGit();
      setRefreshToken((token) => token + 1);
      if (!options?.silent) showToast('File saved', 'success');
    } catch (error) { showToast(getErrorMessage(error, 'Could not save file'), 'error'); }
  }
  async function closeFileFor(sessionId: string, path: string, groupId?: string) {
    const editors = normalizeEditors(editorsBySession[sessionId]);
    const file = editors.editorGroups.flatMap((group) => group.openFiles).find((item) => item.path === path);
    if (file && !(await promptSaveBeforeClose([file]))) return;
    patchSession(sessionId, (prev) => {
      let anyOpenFiles = 0;
      const editorGroups = prev.editorGroups.map((group) => {
        if (groupId && group.id !== groupId) { anyOpenFiles += group.openFiles.length; return group; }
        const index = group.openFiles.findIndex((file) => file.path === path);
        if (index < 0) { anyOpenFiles += group.openFiles.length; return group; }
        const openFiles = group.openFiles.filter((file) => file.path !== path);
        let activeFile = group.activeFile;
        if (group.activeFile === path) activeFile = openFiles[index]?.path ?? openFiles[index - 1]?.path ?? null;
        anyOpenFiles += openFiles.length;
        return { ...group, openFiles, activeFile };
      }).filter((group, _index, groups) => group.openFiles.length || groups.length === 1);
      return { ...prev, editorGroups, activeKind: anyOpenFiles ? prev.activeKind : prev.openLinks.length ? 'web' : 'terminal' };
    });
  }
  async function closeAllContentTabsFor(sessionId: string) {
    const editors = normalizeEditors(editorsBySession[sessionId]);
    if (!(await promptSaveBeforeClose(editors.editorGroups.flatMap((group) => group.openFiles)))) return;
    patchSession(sessionId, (prev) => { const group = createEditorGroup([], null); return { ...prev, editorGroups: [group], activeEditorGroup: group.id, openLinks: [], activeKind: 'terminal', activeWeb: null, webSplit: null }; });
  }
  async function closeOthersFor(sessionId: string, path: string, groupId: string) {
    const editors = normalizeEditors(editorsBySession[sessionId]);
    const closing = editors.editorGroups.find((group) => group.id === groupId)?.openFiles.filter((file) => file.path !== path) ?? [];
    if (!(await promptSaveBeforeClose(closing))) return;
    patchSession(sessionId, (prev) => ({ ...prev, editorGroups: prev.editorGroups.map((group) => group.id === groupId ? { ...group, openFiles: group.openFiles.filter((file) => file.path === path), activeFile: path } : group), activeEditorGroup: groupId }));
  }
  async function closeToSideFor(sessionId: string, path: string, groupId: string, side: 'left' | 'right') {
    const editors = normalizeEditors(editorsBySession[sessionId]);
    const group = editors.editorGroups.find((item) => item.id === groupId);
    const index = group?.openFiles.findIndex((file) => file.path === path) ?? -1;
    const closing = group && index >= 0 ? group.openFiles.filter((_file, fileIndex) => side === 'left' ? fileIndex < index : fileIndex > index) : [];
    if (!(await promptSaveBeforeClose(closing))) return;
    patchSession(sessionId, (prev) => ({ ...prev, editorGroups: prev.editorGroups.map((group) => {
      if (group.id !== groupId) return group;
      const index = group.openFiles.findIndex((file) => file.path === path);
      if (index < 0) return group;
      const openFiles = group.openFiles.filter((_file, fileIndex) => side === 'left' ? fileIndex >= index : fileIndex <= index);
      const activeFile = openFiles.some((file) => file.path === group.activeFile) ? group.activeFile : path;
      return { ...group, openFiles, activeFile };
    }) }));
  }
  function splitFileFor(sessionId: string, path: string, groupId: string, direction: SplitDirection) {
    patchSession(sessionId, (prev) => {
      const sourceIndex = prev.editorGroups.findIndex((group) => group.id === groupId);
      if (sourceIndex < 0) return prev;
      const source = prev.editorGroups[sourceIndex];
      const file = source.openFiles.find((item) => item.path === path);
      if (!file) return prev;
      const nextGroup = createEditorGroup([{ ...file }], path);
      const insertIndex = direction === 'left' || direction === 'up' ? sourceIndex : sourceIndex + 1;
      const editorGroups = prev.editorGroups.slice();
      editorGroups.splice(insertIndex, 0, nextGroup);
      return { ...prev, editorGroups, activeKind: 'editor', activeEditorGroup: nextGroup.id, splitOrientation: direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical' };
    });
  }
  function openLinkFor(sessionId: string, url: string) {
    if (settings?.openLinksExternally) { void api.shell.openExternal(url).catch((error) => showToast(getErrorMessage(error, 'Could not open link'), 'error')); return; }
    patchSession(sessionId, (prev) => {
      const existing = prev.openLinks.find((link) => link.url === url);
      if (existing) return { ...prev, activeKind: 'web', activeWeb: existing.id };
      const tab: WebTab = { id: crypto.randomUUID(), url, name: linkLabel(url) };
      return { ...prev, openLinks: [...prev.openLinks, tab], activeKind: 'web', activeWeb: tab.id };
    });
  }
  function closeLinkFor(sessionId: string, id: string) {
    patchSession(sessionId, (prev) => {
      const index = prev.openLinks.findIndex((link) => link.id === id);
      if (index < 0) return prev;
      const openLinks = prev.openLinks.filter((link) => link.id !== id);
      let activeWeb = prev.activeWeb;
      let activeKind = prev.activeKind;
      if (prev.activeWeb === id) {
        activeWeb = openLinks[index]?.id ?? openLinks[index - 1]?.id ?? null;
        if (!activeWeb) activeKind = prev.editorGroups.some((group) => group.openFiles.length) ? 'editor' : 'terminal';
      }
      return { ...prev, openLinks, activeWeb, activeKind, webSplit: openLinks.length ? prev.webSplit : null };
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
    await createTerminal(undefined, command.terminalName || command.label || 'Command', command.command, command.cwd?.trim() ? command.cwd : workspace.path, { headless: command.headless === true, commandLabel: command.label });
    if (command.headless) showToast(`Running ${command.label} headlessly`, 'info');
    else showToast(`Started ${command.label}`, 'success');
  }

  // profileId omitted => fall back to this workspace's configured default
  // profile, then the global default. An empty startupCommand picks up the
  // workspace's "run on new session" command from automation.json.
  async function createTerminal(profileId?: string, name = 'Terminal', startupCommand = '', cwd = workspace.path, options?: { headless?: boolean; commandLabel?: string }) {
    try {
      const requested = profileId ?? workspaceSetup?.defaultTerminalProfile ?? defaultProfile?.id ?? 'powershell';
      const effectiveProfile = profiles.some((profile) => profile.id === requested) ? requested : defaultProfile?.id ?? 'powershell';
      const selectedProfile = profiles.find((profile) => profile.id === effectiveProfile);
      const effectiveStartup = resolveTerminalStartupCommand({ explicitStartupCommand: startupCommand, profileStartupCommand: selectedProfile?.startupCommand, workspaceStartupCommand: workspaceSetup?.newSessionCommand });
      // A new session starts with just the terminal (no tabs) by default.
      await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: effectiveProfile, cwd, name, startupCommand: effectiveStartup, headless: options?.headless, commandLabel: options?.commandLabel });
    } catch (error) { showToast(getErrorMessage(error, 'Could not create terminal'), 'error'); }
  }

  async function openTerminalHere(folderPath: string) {
    await createTerminal(undefined, baseName(folderPath) || 'Folder', '', folderPath);
  }

  async function renameTerminal(id: string, name: string) {
    try { await sessionStore.renameSession(id, name); }
    catch (error) { showToast(getErrorMessage(error, 'Could not rename session'), 'error'); }
  }

  async function restartTerminal(id: string, cwd?: string) {
    const old = allSessions.find((session) => session.id === id);
    if (!old) return;
    await api.terminal.kill(old.id);
    const next = await api.terminal.create(old.profileId, cwd ?? old.cwd, old.name, old.resumeState?.resumeCommand || old.startupCommand, old.restoreId, { workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath });
    const replacement: WorkspaceTerminalSession = { ...next, workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath, originalStartupCommand: old.originalStartupCommand ?? old.startupCommand, resumeState: next.resumeState ?? old.resumeState, splitGroupId: old.splitGroupId, splitDirection: old.splitDirection };
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

  async function splitTerminal(id: string, side: TerminalSplitSide) {
    const target = allSessions.find((session) => session.id === id);
    if (!target) return;
    if (target.workspaceId !== workspace.id) { showToast('Open that workspace before splitting its session.', 'info'); return; }
    const anchor = activeTerminalId ? sessions.find((session) => session.id === activeTerminalId) : null;
    const direction = sideToDirection(side);
    try {
      if (anchor && anchor.id !== target.id) {
        const groupId = crypto.randomUUID();
        const targetFirst = isBeforeSide(side);
        const oldGroups = new Set([anchor.splitGroupId, target.splitGroupId].filter(Boolean));
        await Promise.all(sessions.filter((session) => session.splitGroupId && oldGroups.has(session.splitGroupId) && session.id !== anchor.id && session.id !== target.id).map((session) => sessionStore.updateSessionMetadata(session.id, { splitGroupId: null, splitDirection: null, splitGroupOrder: null })));
        await sessionStore.updateSessionMetadata(anchor.id, { splitGroupId: groupId, splitDirection: direction, splitGroupOrder: targetFirst ? 1 : 0 });
        await sessionStore.updateSessionMetadata(target.id, { splitGroupId: groupId, splitDirection: direction, splitGroupOrder: targetFirst ? 0 : 1 });
        sessionStore.setActiveSession(targetFirst ? target.id : anchor.id);
        return;
      }
      if (!target) return;
      const groupId = target.splitGroupId ?? crypto.randomUUID();
      await sessionStore.updateSessionMetadata(target.id, { splitGroupId: groupId, splitDirection: direction, splitGroupOrder: 0 });
      const created = await sessionStore.createSession({ workspaceId: target.workspaceId, workspaceName: target.workspaceName, workspacePath: target.workspacePath, profileId: target.profileId, cwd: target.cwd, name: `${target.name} Split`, startupCommand: target.startupCommand });
      await sessionStore.updateSessionMetadata(created.id, { splitGroupId: groupId, splitDirection: direction, splitGroupOrder: 1 });
    } catch (error) { showToast(getErrorMessage(error, 'Could not split session'), 'error'); }
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
    if (gitConfig.confirmBeforeDiscard !== false && !window.confirm(`Discard changes in ${path}? This cannot be undone.`)) return;
    try {
      setGitError(null);
      await discardPath(path);
      await refreshGit();
      setRefreshToken((token) => token + 1);
    } catch (error) { showGitError(error); }
  }

  async function discardPaths(paths: string[]) {
    if (!paths.length) return;
    if (gitConfig.confirmBeforeDiscard !== false && !window.confirm(`Discard changes in ${paths.length} selected ${paths.length === 1 ? 'file' : 'files'}? This cannot be undone.`)) return;
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

  async function commitStaged(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    await commit(trimmed);
  }

  async function stageAllAndCommit(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    try {
      setGitError(null);
      await api.git.addAll(workspace.path);
      await api.git.commit(workspace.path, trimmed);
      await refreshGit();
      showToast('Commit created', 'success');
    } catch (error) {
      showGitError(error);
      showToast(getErrorMessage(error, 'Commit failed'), 'error');
    }
  }

  async function performGitBranchSwitch(branch: string) {
    try {
      setGitError(null);
      await api.git.switchBranch(workspace.path, branch);
      setSelectedGitFile(null);
      setSelectedStagedGitPaths([]);
      setSelectedChangeGitPaths([]);
      setLastSelectedGitPath(null);
      setEditorDiff(null);
      await refreshGit();
      setRefreshToken((token) => token + 1);
      showToast(`Switched to ${branch}`, 'success');
    } catch (error) {
      showGitError(error);
      showToast(getErrorMessage(error, 'Could not switch branch'), 'error');
    }
  }

  async function switchGitBranch(branch: string) {
    if (!branch || branch === git?.branch) return;
    if (git?.files.length) {
      setPendingBranchSwitch(branch);
      return;
    }
    await performGitBranchSwitch(branch);
  }

  function confirmPendingBranchSwitch() {
    const branch = pendingBranchSwitch;
    setPendingBranchSwitch(null);
    if (branch) void performGitBranchSwitch(branch);
  }

  async function runGitRemoteAction(kind: 'fetch' | 'pull' | 'push') {
    try {
      setGitError(null);
      await api.git[kind](workspace.path);
      await refreshGit();
      if (kind === 'pull') setRefreshToken((token) => token + 1);
      showToast(`${kind[0].toUpperCase()}${kind.slice(1)} complete`, 'success');
    } catch (error) {
      showGitError(error);
      showToast(getErrorMessage(error, `Git ${kind} failed`), 'error');
    }
  }

  const defaultLayout = getDefaultLayout(workspace.id);
  const mergedLayout = layout ?? defaultLayout;

  function updateExtensionState(next: NonNullable<WorkspaceLayout['extensions']>) {
    setLayout((current) => {
      const base = current ?? getDefaultLayout(workspace.id);
      return { ...base, extensions: { ...(base.extensions ?? {}), ...next } };
    });
  }

  function setViewVisible(viewId: string, visible: boolean) {
    const current = mergedLayout.extensions?.visibleViewIds ?? [];
    const next = visible ? [...new Set([...current, viewId])] : current.filter((id) => id !== viewId);
    updateExtensionState({ visibleViewIds: next });
  }

  function openView(viewId: string) {
    const sessionView = sessionContributions.some((view) => view.id === viewId);
    if (sessionView) { updatePanels({ sessionsVisible: true }); return; }
    if (!activityContributions.some((view) => view.id === viewId)) return;
    setViewVisible(viewId, true);
  }

  function toggleView(viewId: string) {
    const sessionView = sessionContributions.some((view) => view.id === viewId);
    if (sessionView) { updatePanels({ sessionsVisible: !sessionsVisible }); return; }
    if (!activityContributions.some((view) => view.id === viewId)) return;
    setViewVisible(viewId, !visibleActivityViewIds.includes(viewId));
  }

  function toggleActivitySidebar() {
    if (visibleActivityViewIds.length) updateExtensionState({ visibleViewIds: [] });
    else if (activityContributions[0]) setViewVisible(activityContributions[0].id, true);
  }

  function renderContributionIcon(icon?: string) {
    if (icon === 'git') return <GitBranchIcon />;
    if (icon === 'sessions') return <PanelLeftIcon />;
    return <FolderIcon />;
  }
  const extensionCtx: WorkspaceExtensionContext = {
    workspace,
    settings,
    git,
    sessions,
    allSessions,
    activeSessionId: activeTerminalId,
    headlessRuns,
    isRepo,
    refreshToken,
    actions: {
      openFile,
      previewFile,
      openTerminalHere,
      openView,
      toggleView,
      openGit: () => { const gitView = activityContributions.find((view) => view.icon === 'git'); if (gitView) openView(gitView.id); },
      refreshGit,
      revealFolder: (targetPath = workspace.path) => void api.fs.revealInExplorer(targetPath),
      selectSession: (id) => { const target = allSessions.find((session) => session.id === id); sessionStore.setActiveSession(id); if (target && target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId); },
      createSession: () => createTerminal(undefined, 'Terminal', ''),
    },
    workspaces,
    profiles,
    defaultProfileId: workspaceSetup?.defaultTerminalProfile ?? settings?.defaultTerminalProfileId,
    headlessActions: {
      terminate: async (id) => {
        try { await api.terminal.kill(id); }
        catch (error) { showToast(getErrorMessage(error, 'Could not terminate headless command'), 'error'); }
      },
      delete: (id) => sessionStore.removeHeadlessRun(id),
      inspect: (id) => { setInspectHeadlessRunId(id); openView('stackdock.headless.view'); },
      inspectRunId: inspectHeadlessRunId,
    },
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
      commitStaged,
      stageAllAndCommit,
      switchBranch: switchGitBranch,
      fetch: () => runGitRemoteAction('fetch'),
      pull: () => runGitRemoteAction('pull'),
      push: () => runGitRemoteAction('push'),
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
  const sessionContribution = sessionContributions[0] ?? null;
  const activityContributions = getEnabledViewContributions(enabledExtensions, 'activity', extensionCtx);
  const renderExtensionView = (contribution: (typeof activityContributions)[number] | (typeof sessionContributions)[number]) => extensionRegistry.nativeExtensions.get(contribution.extensionId)?.renderView?.(contribution, extensionCtx) ?? null;
  const legacyActivityViewIds = activityContributions.filter((_, index) => index === 0 ? mergedLayout.panels.fileTreeVisible : index === 1 ? mergedLayout.panels.gitPanelVisible : false).map((view) => view.id);
  const configuredActivityViewIds = mergedLayout.extensions?.visibleViewIds;
  const visibleActivityViewIds = (configuredActivityViewIds ?? legacyActivityViewIds).filter((id) => activityContributions.some((view) => view.id === id));
  const visibleActivityContributions = activityContributions.filter((view) => visibleActivityViewIds.includes(view.id));
  const sidebarVisible = visibleActivityContributions.length > 0;
  const sessionsVisible = sessionContributions.length > 0 && mergedLayout.panels.sessionsVisible !== false;
  const panelSizes = mergedLayout.panels.panelSizes ?? { sessions: 14, explorer: 18, main: 68, editor: 72, git: 28, upper: 62, terminal: 38 };
  const safePanelSizes = getSafePanelSizes(panelSizes, sidebarVisible, sessionsVisible);
  const extensionCommands = enabledExtensions.flatMap((manifest) => extensionRegistry.nativeExtensions.get(manifest.id)?.getCommands?.(extensionCtx) ?? []);
  function openSettings(tab: SettingsTab = 'general') { setSettingsInitialTab(tab); setSettingsOpen(true); }
  const settingsActions: CommandAction[] = [
    { id: 'stackdock.settings.open', label: 'Open Settings', keybind: settings?.keybinds['stackdock.settings.open'], run: () => openSettings('general') },
    { id: 'stackdock.settings.open.general', label: 'Open Settings: General', keybind: settings?.keybinds['stackdock.settings.open.general'], run: () => openSettings('general') },
    { id: 'stackdock.settings.open.appearance', label: 'Open Settings: Appearance', keybind: settings?.keybinds['stackdock.settings.open.appearance'], run: () => openSettings('appearance') },
    { id: 'stackdock.settings.open.terminal', label: 'Open Settings: Terminal profiles', keybind: settings?.keybinds['stackdock.settings.open.terminal'], run: () => openSettings('terminal') },
    { id: 'stackdock.settings.open.extensions', label: 'Open Settings: Extensions', keybind: settings?.keybinds['stackdock.settings.open.extensions'], run: () => openSettings('extensions') },
    { id: 'stackdock.settings.open.workspace', label: 'Open Settings: Workspace', keybind: settings?.keybinds['stackdock.settings.open.workspace'], run: () => openSettings('workspace') },
    { id: 'stackdock.settings.open.keybinds', label: 'Open Settings: Keybinds', keybind: settings?.keybinds['stackdock.settings.open.keybinds'], run: () => openSettings('keybinds') },
  ];
  const launcherActions: CommandAction[] = [
    // User-defined commands first so they're front-and-center in the palette.
    ...(workspaceSetup?.commands ?? []).map((command) => ({ id: `ws:${command.id}`, label: command.label, description: command.command, keybind: command.keybind, run: () => runPaletteCommand(command) })),
    ...(automation?.commands ?? []).map((command) => ({ id: `global:${command.id}`, label: command.label, description: command.command, keybind: command.keybind, run: () => runPaletteCommand(command) })),
    { id: 'stackdock.terminal.new', label: 'New Terminal', keybind: settings?.keybinds['stackdock.terminal.new'], run: () => createTerminal(undefined, 'Terminal', '') },
    ...extensionCommands.map((command) => ({ ...command, keybind: settings?.keybinds[command.id] })),
    { id: 'stackdock.view.toggleTerminal', label: 'Show/Toggle Terminal', keybind: settings?.keybinds['stackdock.view.toggleTerminal'], run: toggleMainView },
    { id: 'stackdock.view.toggleSidebar', label: 'Toggle Sidebar', keybind: settings?.keybinds['stackdock.view.toggleSidebar'], run: toggleActivitySidebar },
    { id: 'stackdock.tab.closeActive', label: 'Close Active Tab', keybind: settings?.keybinds['stackdock.tab.closeActive'], run: () => { if (mainView === 'web' && activeWebId) closeLink(activeWebId); else if (activeFilePath) void closeFile(activeFilePath, activeEditors.activeEditorGroup); } },
    ...(activeTerminalId ? [
      { id: 'restart-terminal', label: 'Restart Terminal', run: () => restartTerminal(activeTerminalId) },
      { id: 'close-terminal', label: 'Close Terminal', run: () => closeTerminal(activeTerminalId) },
    ] : []),
    ...settingsActions,
    { id: 'open-folder', label: 'Open Workspace Folder', run: () => api.shell.openPath(workspace.path) },
  ];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (launcherOpen) return;
      if (keybindMatchesEvent(settings?.keybinds['stackdock.commandPalette.open'], event)) { event.preventDefault(); setLauncherOpen(true); return; }
      if (keybindMatchesEvent(settings?.keybinds['stackdock.sessions.switcher.open'], event)) { event.preventDefault(); setSessionSwitcherOpen(true); return; }
      if (isEditableTarget(event.target)) return;
      const action = launcherActions.find((item) => item.keybind && keybindMatchesEvent(item.keybind, event));
      if (action) { event.preventDefault(); void action.run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [launcherOpen, launcherActions, settings?.keybinds]);

  const activeSession = activeTerminalId ? sessions.find((session) => session.id === activeTerminalId) ?? null : null;
  const activeSplitGroup = activeSession?.splitGroupId ? sessions.filter((session) => session.splitGroupId === activeSession.splitGroupId) : [];
  const visibleSessionPanes = activeSplitGroup.length >= 2
    ? [...activeSplitGroup].sort((a, b) => (a.splitGroupOrder ?? sessions.indexOf(a)) - (b.splitGroupOrder ?? sessions.indexOf(b)))
    : activeSession ? [activeSession] : [];
  const sessionSplitDirection = activeSession?.splitDirection ?? 'row';

  function renderSessionMainPane(session: WorkspaceTerminalSession) {
    const paneEditors = normalizeEditors(editorsBySession[session.id]);
    const paneEditorGroup = paneEditors.editorGroups.find((group) => group.id === paneEditors.activeEditorGroup) ?? paneEditors.editorGroups[0];
    const paneOpenFiles = paneEditors.editorGroups.flatMap((group) => group.openFiles);
    const paneOpenLinks = paneEditors.openLinks;
    const paneContentTabCount = paneOpenFiles.length + paneOpenLinks.length;
    let paneMainView: MainTabKind = paneEditors.activeKind;
    if (paneMainView === 'editor' && !paneOpenFiles.length) paneMainView = 'terminal';
    if (paneMainView === 'web' && !paneOpenLinks.length) paneMainView = 'terminal';
    const paneWebSplit = paneEditors.webSplit && paneOpenLinks.length ? paneEditors.webSplit : null;
    const panePrimaryView = paneWebSplit && paneMainView === 'web' ? 'terminal' : paneMainView;
    const paneActiveFilePath = paneEditorGroup.activeFile;
    const paneActiveWebId = paneEditors.activeWeb;
    const paneWebPane = paneWebSplit ? (
      <>
        {paneWebSplit === 'right' || paneWebSplit === 'down' ? <PanelResizeHandle className={`resize-handle ${paneWebSplit === 'down' ? 'horizontal' : 'vertical'}`} /> : null}
        <Panel key="web-split" id={`main-web-split-${session.id}`} order={paneWebSplit === 'left' || paneWebSplit === 'up' ? 1 : 2} defaultSize={45} minSize={15}>
          <div className="main-tab-pane web-split-pane" style={{ display: 'flex' }}>
            <WebTabPanel tabs={paneOpenLinks} activeId={paneActiveWebId} onTitle={setWebTitle} onClose={(id) => closeLinkFor(session.id, id)} />
          </div>
        </Panel>
        {paneWebSplit === 'left' || paneWebSplit === 'up' ? <PanelResizeHandle className={`resize-handle ${paneWebSplit === 'up' ? 'horizontal' : 'vertical'}`} /> : null}
      </>
    ) : null;
    return (
      <div className={`workspace-main-area main-tabbed session-pane${session.id === activeTerminalId ? ' active' : ''}`} onMouseDown={() => sessionStore.setActiveSession(session.id)}>
        {paneContentTabCount > 0 ? (
          <div className="editor-tabbar main-tabbar">
            <div className="tab-strip">
              <div className={`tab main-terminal-tab${paneMainView === 'terminal' ? ' active' : ''}`} title="Terminal" onClick={() => showTerminalFor(session.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTerminalTabMenu({ x: event.clientX, y: event.clientY }); }}>
                <span className="tab-name">Terminal</span>
              </div>
              {paneEditorGroup.openFiles.map((file) => (
                <div key={`${session.id}:${paneEditorGroup.id}:${file.path}`} className={`tab${paneMainView === 'editor' && file.path === paneActiveFilePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}`} title={file.path} onClick={() => selectFileFor(session.id, file.path, paneEditorGroup.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTabMenu({ file, groupId: paneEditorGroup.id, x: event.clientX, y: event.clientY }); }} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); void closeFileFor(session.id, file.path, paneEditorGroup.id); } }}>
                  <span className="tab-name">{file.name}{file.dirty ? '*' : ''}</span>
                  <span className="tab-close" onClick={(event) => { event.stopPropagation(); void closeFileFor(session.id, file.path, paneEditorGroup.id); }}><span className="dot">●</span><span className="x">×</span></span>
                </div>
              ))}
              {paneOpenLinks.map((link) => (
                <div key={link.id} className={`tab web-tab-chip${(paneMainView === 'web' || paneWebSplit) && link.id === paneActiveWebId ? ' active' : ''}`} title={link.url} onClick={() => selectWebFor(session.id, link.id)} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeLinkFor(session.id, link.id); } }}>
                  <span className="tab-icon" aria-hidden>🌐</span><span className="tab-name">{link.name}</span>
                  <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeLinkFor(session.id, link.id); }}><span className="x">×</span></span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {terminalTabMenu && session.id === activeTerminalId ? (
          <div className="context-menu tab-context-menu" style={{ top: terminalTabMenu.y, left: terminalTabMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
            <button className="context-menu-item" disabled={paneContentTabCount === 0} onClick={() => { void closeAllContentTabsFor(session.id); setTerminalTabMenu(null); }}>Close Others</button>
          </div>
        ) : null}
        <div className="main-tab-content">
          <PanelGroup direction={paneWebSplit === 'up' || paneWebSplit === 'down' ? 'vertical' : 'horizontal'} className="web-split-group">
            {paneWebSplit === 'left' || paneWebSplit === 'up' ? paneWebPane : null}
            <Panel key="primary" id={`main-primary-${session.id}`} order={paneWebSplit === 'left' || paneWebSplit === 'up' ? 2 : 1} minSize={20}>
              <div className="main-tab-pane" style={{ display: panePrimaryView === 'terminal' ? 'flex' : 'none' }}>
                <TerminalPanel sessions={[session]} activeId={session.id} onOpenLink={(url) => openLinkFor(session.id, url)} settings={settings} isVisible={true} onAttachmentError={(message) => showToast(message, 'error')} />
              </div>
              <div className="main-tab-pane" style={{ display: panePrimaryView === 'editor' ? 'flex' : 'none' }}>
                {paneOpenFiles.length ? (
                  <Suspense fallback={<div className="empty-pad muted">Loading editor…</div>}>
                    <PanelGroup direction={paneEditors.splitOrientation === 'horizontal' ? 'horizontal' : 'vertical'} className="editor-split-group">
                      {paneEditors.editorGroups.flatMap((group, index) => [
                        <Panel key={group.id} id={`editor-${session.id}-${group.id}`} minSize={20} className={group.id === paneEditors.activeEditorGroup ? 'editor-group-pane active' : 'editor-group-pane'}>
                          <div className="editor-group-shell" onMouseDown={() => patchSession(session.id, (prev) => ({ ...prev, activeEditorGroup: group.id }))}>
                            {group.activeFile && htmlPreviewBySession[session.id] === group.activeFile ? (
                              <WebTabPanel tabs={[{ id: `preview:${group.activeFile}`, url: fileUrlFromPath(group.activeFile), name: baseName(group.activeFile) }]} activeId={`preview:${group.activeFile}`} onTitle={() => undefined} showToolbar={false} />
                            ) : (
                              <EditorPanel openFiles={group.openFiles} activePath={group.activeFile} onOpenFile={(path) => selectFileFor(session.id, path, group.id)} onChangeFile={(path, content) => changeFileFor(session.id, path, content)} onSaveFile={(path) => saveFileFor(session.id, path)} onCloseFile={(path) => closeFileFor(session.id, path, group.id)} settings={settings ?? undefined} diff={editorDiff} diffMode={diffMode} showTabs={false} visible={panePrimaryView === 'editor'} />
                            )}
                          </div>
                        </Panel>,
                        index < paneEditors.editorGroups.length - 1 ? <PanelResizeHandle key={`${group.id}:resize`} className={paneEditors.splitOrientation === 'horizontal' ? 'resize-handle vertical' : 'resize-handle horizontal'} /> : null,
                      ])}
                    </PanelGroup>
                  </Suspense>
                ) : <div className="empty-pad muted">Open file to edit.</div>}
                {tabMenu && session.id === activeTerminalId ? (
                  <div className="context-menu tab-context-menu" style={{ top: tabMenu.y, left: tabMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
                    <button className="context-menu-item" onClick={() => { splitFileFor(session.id, tabMenu.file.path, tabMenu.groupId, 'left'); setTabMenu(null); }}>Split Left</button>
                    <button className="context-menu-item" onClick={() => { splitFileFor(session.id, tabMenu.file.path, tabMenu.groupId, 'right'); setTabMenu(null); }}>Split Right</button>
                    <button className="context-menu-item" onClick={() => { splitFileFor(session.id, tabMenu.file.path, tabMenu.groupId, 'up'); setTabMenu(null); }}>Split Up</button>
                    <button className="context-menu-item" onClick={() => { splitFileFor(session.id, tabMenu.file.path, tabMenu.groupId, 'down'); setTabMenu(null); }}>Split Down</button>
                    <button className="context-menu-item" onClick={() => { void closeFileFor(session.id, tabMenu.file.path, tabMenu.groupId); setTabMenu(null); }}>Close</button>
                    <button className="context-menu-item" onClick={() => { void closeOthersFor(session.id, tabMenu.file.path, tabMenu.groupId); setTabMenu(null); }}>Close Others</button>
                    <button className="context-menu-item" onClick={() => { void closeToSideFor(session.id, tabMenu.file.path, tabMenu.groupId, 'right'); setTabMenu(null); }}>Close to Right</button>
                    <button className="context-menu-item" onClick={() => { void closeToSideFor(session.id, tabMenu.file.path, tabMenu.groupId, 'left'); setTabMenu(null); }}>Close to Left</button>
                  </div>
                ) : null}
              </div>
              {!paneWebSplit ? <div className="main-tab-pane" style={{ display: paneMainView === 'web' ? 'flex' : 'none' }}><WebTabPanel tabs={paneOpenLinks} activeId={paneActiveWebId} onTitle={setWebTitle} onClose={(id) => closeLinkFor(session.id, id)} /></div> : null}
            </Panel>
            {paneWebSplit === 'right' || paneWebSplit === 'down' ? paneWebPane : null}
          </PanelGroup>
        </div>
      </div>
    );
  }

  const webPane = webSplit ? (
    <>
      {webSplit === 'right' || webSplit === 'down' ? <PanelResizeHandle className={`resize-handle ${webSplit === 'down' ? 'horizontal' : 'vertical'}`} /> : null}
      <Panel key="web-split" id="main-web-split" order={webSplit === 'left' || webSplit === 'up' ? 1 : 2} defaultSize={45} minSize={15}>
        <div className="main-tab-pane web-split-pane" style={{ display: 'flex' }}>
          <WebTabPanel tabs={openLinks} activeId={activeWebId} onTitle={setWebTitle} onClose={closeLink} />
        </div>
      </Panel>
      {webSplit === 'left' || webSplit === 'up' ? <PanelResizeHandle className={`resize-handle ${webSplit === 'up' ? 'horizontal' : 'vertical'}`} /> : null}
    </>
  ) : null;

  return (
    <div className="workspace-shell workspace-terminal-mode">
      <header className="topbar compact-topbar workspace-titlebar">
        <div className="topbar-left">
          <button className="topbar-icon-btn" onClick={onBack} title="Back to workspaces" aria-label="Back to workspaces"><HomeIcon /></button>
          <span className="topbar-divider" aria-hidden />
          <div className="topbar-nav">
            {sessionContribution ? <button className={sessionsVisible ? 'topbar-icon-btn active-toggle' : 'topbar-icon-btn'} onClick={() => toggleView(sessionContribution.id)} title={sessionContribution.title} aria-label={sessionContribution.title}>{renderContributionIcon(sessionContribution.icon)}</button> : null}
            {activityContributions.map((contribution) => (
              <button key={contribution.id} className={visibleActivityViewIds.includes(contribution.id) ? 'topbar-icon-btn active-toggle' : 'topbar-icon-btn'} onClick={() => toggleView(contribution.id)} title={contribution.title} aria-label={contribution.title}>{renderContributionIcon(contribution.icon)}</button>
            ))}
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
            <button className="topbar-icon-btn" onClick={() => void api.shell.openPath(workspace.path)} title="Open Folder" aria-label="Open Folder"><FolderOpenIcon /></button>
          </div>
          <span className="topbar-divider" aria-hidden />
          <WindowControls />
        </div>
      </header>

      <PanelGroup key={`${sessionsVisible ? 'sessions' : 'no-sessions'}-${sidebarVisible ? 'with-sidebar' : 'without-sidebar'}`} direction="horizontal" className="workspace-body with-global-sessions" onLayout={(sizes) => { let i = 0; const next: NonNullable<WorkspaceLayout['panels']['panelSizes']> = {}; if (sessionsVisible) next.sessions = sizes[i++]; if (sidebarVisible) next.explorer = sizes[i++]; next.main = sizes[i++]; updatePanelSizes(next); }}>
        {sessionsVisible ? (
          <>
            <Panel id="sessions" order={1} defaultSize={safePanelSizes.sessions} minSize={10} className="global-sessions-panel">
              {sessionContributions.length > 1 ? (
                <PanelGroup direction="vertical" className="sidebar-stack sessions-stack" onLayout={([upper, lower]) => updatePanelSizes({ sessionsUpper: upper, headless: lower })}>
                  <Panel id="sessions-primary" defaultSize={panelSizes.sessionsUpper ?? 78} minSize={35}>
                    {renderExtensionView(sessionContributions[0])}
                  </Panel>
                  <PanelResizeHandle id="sessions-stack-resize" className="resize-handle horizontal" />
                  <Panel id="sessions-secondary" defaultSize={panelSizes.headless ?? 22} minSize={12}>
                    {sessionContributions.slice(1).map((contribution) => <div key={contribution.id} className="extension-sidebar-view">{renderExtensionView(contribution)}</div>)}
                  </Panel>
                </PanelGroup>
              ) : renderExtensionView(sessionContributions[0])}
            </Panel>
            <PanelResizeHandle id="sessions-resize" className="resize-handle vertical" />
          </>
        ) : null}
        {sidebarVisible ? (
          <>
            <Panel id="activity-sidebar" order={2} defaultSize={safePanelSizes.explorer} minSize={12} className="workspace-explorer">
              {visibleActivityContributions.length > 1 ? (
                <PanelGroup direction="vertical" className="sidebar-stack" onLayout={([upper, lower]) => updatePanelSizes({ upper, git: lower })}>
                  <Panel id="activity-sidebar-primary" defaultSize={panelSizes.upper ?? 58} minSize={20}>
                    {renderExtensionView(visibleActivityContributions[0])}
                  </Panel>
                  <PanelResizeHandle id="sidebar-stack-resize" className="resize-handle horizontal" />
                  <Panel id="activity-sidebar-secondary" defaultSize={panelSizes.git ?? 42} minSize={20}>
                    {visibleActivityContributions.slice(1).map((contribution) => <div key={contribution.id} className="extension-sidebar-view">{renderExtensionView(contribution)}</div>)}
                  </Panel>
                </PanelGroup>
              ) : (
                renderExtensionView(visibleActivityContributions[0])
              )}
            </Panel>
            <PanelResizeHandle id="explorer-resize" className="resize-handle vertical" />
          </>
        ) : null}
        <Panel id="main" order={3} defaultSize={safePanelSizes.main} minSize={30}>
          <div
            className="session-split-host"
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(SESSION_DRAG_MIME)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setSessionDropSide(getDropSide(event, event.currentTarget));
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSessionDropSide(null); }}
            onDrop={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(SESSION_DRAG_MIME)) return;
              event.preventDefault();
              const id = event.dataTransfer.getData(SESSION_DRAG_MIME);
              const side = sessionDropSide ?? getDropSide(event, event.currentTarget);
              setSessionDropSide(null);
              if (id) void splitTerminal(id, side);
            }}
          >
            {visibleSessionPanes.length > 1 ? (
              <PanelGroup direction={sessionSplitDirection === 'column' ? 'vertical' : 'horizontal'} className="session-pane-group">
                {visibleSessionPanes.flatMap((session, index) => [
                  <Panel key={session.id} id={`session-pane-${session.id}`} minSize={20}>
                    {renderSessionMainPane(session)}
                  </Panel>,
                  index < visibleSessionPanes.length - 1 ? <PanelResizeHandle key={`${session.id}:resize`} className={`session-pane-resize resize-handle ${sessionSplitDirection === 'column' ? 'horizontal' : 'vertical'}`} /> : null,
                ])}
              </PanelGroup>
            ) : visibleSessionPanes[0] ? renderSessionMainPane(visibleSessionPanes[0]) : <div className="empty-pad muted">Open terminal from Sessions.</div>}
            {sessionDropSide ? <div className={`session-split-drop-overlay side-${sessionDropSide}`}>Split {sessionDropSide[0].toUpperCase() + sessionDropSide.slice(1)}</div> : null}
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
      {pendingBranchSwitch ? (
        <div className="modal-backdrop confirm-backdrop" onMouseDown={() => setPendingBranchSwitch(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-switch-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confirm-dialog-head">
              <span className="confirm-dialog-icon" aria-hidden>⎇</span>
              <div>
                <h3 id="branch-switch-title">Switch branch?</h3>
                <p>Uncommitted changes are present in this workspace.</p>
              </div>
            </div>
            <p className="confirm-dialog-body">Git may block switching to <strong>{pendingBranchSwitch}</strong> if any changes conflict. Your changes will remain in the working tree when Git can switch safely.</p>
            <div className="modal-actions confirm-dialog-actions">
              <button className="ghost" onClick={() => setPendingBranchSwitch(null)}>Cancel</button>
              <button className="primary" autoFocus onClick={confirmPendingBranchSwitch}>Switch Branch</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSafePanelSizes(panelSizes: NonNullable<WorkspaceLayout['panels']['panelSizes']>, sidebarVisible: boolean, sessionsVisible = true) {
  const sessions = sessionsVisible ? clamp(panelSizes.sessions ?? 14, 10, 24) : 0;
  if (!sidebarVisible) return { sessions, explorer: panelSizes.explorer ?? 18, main: 100 - sessions };

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
