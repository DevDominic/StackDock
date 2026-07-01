import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { AutomationConfig, ExtensionViewContribution, GitFileStatus, GitStatus, LaunchInfo, PaletteCommand, StackDockSettings, TerminalPersistedTab, TerminalProfile, TerminalSplitSide, Workspace, WorkspaceLayout, WorkspaceTerminalSession, WorkspaceViewZone } from '../../shared/types';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../common/ToastProvider';
import { usePromptDialog } from '../common/PromptProvider';
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
import { ReleaseNotesDialog } from '../ReleaseNotesDialog';
import { FolderIcon, FolderOpenIcon, GitBranchIcon, HomeIcon, MicrophoneIcon, PanelLeftIcon, SettingsIcon } from '../icons';
import { resolveTerminalStartupCommand } from '../../shared/terminalProfiles';
import { keybindMatchesEvent, isEditableTarget } from '../../shared/keybinds';

const EditorPanel = lazy(() => import('./EditorPanel.js').then((module) => ({ default: module.EditorPanel })));

// Which kind of content tab is showing in the shared main area for a session.
type MainTabKind = 'terminal' | 'editor' | 'web';

type SplitDirection = 'left' | 'right' | 'up' | 'down';
type EditorSplitOrientation = 'horizontal' | 'vertical';

const SESSION_DRAG_MIME = 'application/x-stackdock-session-id';
const FILE_TAB_DRAG_MIME = 'application/x-stackdock-file-tab';
const MOVABLE_WORKSPACE_VIEW_IDS = new Set(['stackdock.git.view', 'stackdock.voiceInput.view']);
const PI_EXTENSION_ID = 'stackdock.pi';
const PI_RESUME_COMMAND_PATTERN = /^\s*pi\b(?=.*(?:^|\s)--session(?:-id)?(?:\s|=))/i;

function piResumeRestoringEnabled(settings: StackDockSettings) {
  return settings.extensions.config?.[PI_EXTENSION_ID]?.resumeRestoredTerminals !== false;
}

function isPiResumeState(resumeState: TerminalPersistedTab['resumeState'] | null | undefined) {
  return resumeState?.integrationId === PI_EXTENSION_ID;
}

function isPiResumeCommand(command: string | undefined) {
  return !!command && PI_RESUME_COMMAND_PATTERN.test(command);
}

function restoredTerminalStartupCommand(session: WorkspaceLayout['terminals'][number] | TerminalPersistedTab, snapshot: Awaited<ReturnType<typeof api.terminal.snapshot>>, settings: StackDockSettings) {
  const persistedResumeCommand = 'resumeStartupCommand' in session ? session.resumeStartupCommand : undefined;
  const suppressPiResume = !piResumeRestoringEnabled(settings) && (
    isPiResumeState(session.resumeState)
    || isPiResumeState(snapshot?.resumeState)
    || isPiResumeCommand(persistedResumeCommand)
    || isPiResumeCommand(session.startupCommand)
  );
  if (!suppressPiResume) {
    const resumeCommand = persistedResumeCommand ?? session.resumeState?.resumeCommand ?? snapshot?.resumeState?.resumeCommand;
    if (resumeCommand) return resumeCommand;
  }
  if (suppressPiResume && isPiResumeCommand(session.startupCommand)) {
    return session.originalStartupCommand && !isPiResumeCommand(session.originalStartupCommand) ? session.originalStartupCommand : 'pi';
  }
  return session.startupCommand;
}

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

function isGitDirectoryStatusPath(file: string) {
  return /[\\/]$/.test(file);
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

function quoteTerminalPath(targetPath: string) {
  if (!/[\s"'`$&(){}\[\];<>|]/.test(targetPath)) return targetPath;
  return `"${targetPath.replace(/(["\\$`])/g, '\\$1')}"`;
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
  onOpenWorkspacePicker(): Promise<boolean>;
  settings?: StackDockSettings | null;
  onSettingsApplied?(settings: StackDockSettings): void;
}

export function WorkspaceShell({ workspace, onBack, onUpdateWorkspace, workspaces, onOpenWorkspace, onOpenWorkspacePicker, settings: appSettings, onSettingsApplied }: Props) {
  const { showToast } = useToast();
  const promptDialog = usePromptDialog();
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [editorDiff, setEditorDiff] = useState<EditorDiffModel | null>(null);
  const [diffMode, setDiffMode] = useState<EditorDiffMode>('side-by-side');
  const [settings, setSettings] = useState<StackDockSettings | null>(appSettings ?? null);
  const [launchInfo, setLaunchInfo] = useState<LaunchInfo | null>(null);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [automation, setAutomation] = useState<AutomationConfig | null>(null);
  const sessionStore = useSessionStore();
  const allSessions = sessionStore.sessions;
  const headlessRuns = sessionStore.headlessRuns;
  const [inspectHeadlessRunId, setInspectHeadlessRunId] = useState<string | null>(null);
  const sessions = allSessions.filter((session) => session.workspaceId === workspace.id);
  const activeTerminalId = sessions.some((session) => session.id === sessionStore.activeSessionId) ? sessionStore.activeSessionId : sessions[0]?.id ?? null;
  const [htmlPreviewBySession, setHtmlPreviewBySession] = useState<Record<string, string | null>>({});
  const [highlightedSessionIds, setHighlightedSessionIds] = useState<string[]>([]);
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
  const visibleEditorDiff = editorDiff && primaryView === 'editor' && activeFilePath === editorDiff.path ? editorDiff : null;
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
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<{ sessionId: string; file: OpenFileTab; groupId: string; x: number; y: number } | null>(null);
  const [terminalTabMenu, setTerminalTabMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [tabDrop, setTabDrop] = useState<{ side: TerminalSplitSide; kind: 'terminal' | 'file' } | null>(null);
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const [terminalReloadTokens, setTerminalReloadTokens] = useState<Record<string, number>>({});
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

  useEffect(() => {
    let active = true;
    api.app.getLaunchInfo().then((info) => { if (active) setLaunchInfo(info); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const workspaceTrusted = workspace.trusted !== false;
  const workspaceSetup = workspaceTrusted ? automation?.workspaces[workspace.id] : undefined;
  const isRepo = !!git?.isRepo;
  const gitExtensionId = extensionRegistry.extensions.find((manifest) => manifest.capabilities?.includes('git'))?.id;
  const gitConfig = getExtensionConfig(settings, gitExtensionId ?? '', { confirmBeforeDiscard: true, confirmBeforeRemoteActions: true, refreshIntervalSeconds: 1 });

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (activeTerminalId) clearSessionAttention(activeTerminalId);
  }, [activeTerminalId]);

  function requireTrusted(action: string) {
    if (workspaceTrusted) return true;
    showToast(`Trust this workspace before ${action}.`, 'info');
    return false;
  }

  async function trustWorkspace() {
    try {
      await onUpdateWorkspace({ ...workspace, trusted: true });
      showToast('Workspace trusted', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not trust workspace'), 'error');
    }
  }

  function updatePanels(next: Partial<WorkspaceLayout['panels']>) {
    setLayout((current) => {
      const base = current ?? getDefaultLayout(workspace.id);
      return { ...base, panels: { ...base.panels, ...next } };
    });
  }

  function updatePanelSizes(next: NonNullable<WorkspaceLayout['panels']['panelSizes']>) {
    updatePanels({ panelSizes: { ...(mergedLayout.panels.panelSizes ?? {}), ...next } });
  }

  function updateExtensionPanelSizes(next: Record<string, number>) {
    setLayout((current) => {
      const base = current ?? getDefaultLayout(workspace.id);
      return {
        ...base,
        extensions: {
          ...(base.extensions ?? {}),
          panelSizesByViewId: { ...(base.extensions?.panelSizesByViewId ?? {}), ...next },
        },
      };
    });
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
      // Recreate terminals from the last clean shutdown. This restores every
      // persisted workspace session into the global Sessions sidebar, not only
      // the last active workspace, then falls back to this workspace's saved
      // layout/default terminal when no persisted tab exists for it.
      let firstSessionId: string | null = sessionsRef.current[0]?.id ?? null;
      let createdSessions = false;
      try {
        const persistedTabs = persistedTerminals?.tabs ?? [];
        const restoredRestoreIds = new Set<string>();
        let restoredCurrentWorkspace = false;
        let restoredActiveRuntimeId: string | null = null;
        const persistedWorkspaceTerminals = persistedTabs.filter((session): session is TerminalPersistedTab => session.workspaceId === workspace.id || session.workspacePath === workspace.path);
        const persistedActiveRestoreId = persistedWorkspaceTerminals[persistedWorkspaceTerminals.length - 1]?.restoreId;

        if (!useSessionStore.getState().sessions.length && persistedTabs.length) {
          for (const session of persistedTabs) {
            const targetWorkspace = (session.workspaceId ? workspaces.find((item) => item.id === session.workspaceId) : null)
              ?? (session.workspacePath ? workspaces.find((item) => item.path === session.workspacePath) : null);
            if (!targetWorkspace) continue;
            const snapshot = session.restoreId ? await api.terminal.snapshot(session.restoreId).catch(() => null) : null;
            const startupCommand = restoredTerminalStartupCommand(session, snapshot, loadedSettings);
            const created = await sessionStore.createSession({ workspaceId: targetWorkspace.id, workspaceName: targetWorkspace.name, workspacePath: targetWorkspace.path, profileId: session.profileId, cwd: session.cwd, name: session.name, startupCommand, restoreId: session.restoreId });
            const restoredSession = { ...created, originalStartupCommand: session.originalStartupCommand ?? session.startupCommand, resumeState: session.resumeState ?? snapshot?.resumeState, restoredFromSnapshot: true, resumeStartupCommand: session.resumeStartupCommand ?? '', splitGroupId: session.splitGroupId, splitDirection: session.splitDirection, splitGroupOrder: session.splitGroupOrder };
            sessionStore.replaceSession(created.id, restoredSession);
            restoredRestoreIds.add(session.restoreId ?? session.id);
            createdSessions = true;
            if (targetWorkspace.id === workspace.id) {
              restoredCurrentWorkspace = true;
              firstSessionId ??= restoredSession.id;
              if (session.restoreId && (session.restoreId === loadedLayout?.activeTerminalRestoreId || session.restoreId === persistedActiveRestoreId)) restoredActiveRuntimeId = restoredSession.id;
              if (session.id === loadedLayout?.activeTerminalRuntimeId) restoredActiveRuntimeId = restoredSession.id;
            }
          }
        }

        const restoreById = new Map<string, WorkspaceLayout['terminals'][number] | TerminalPersistedTab>();
        for (const session of loadedLayout?.terminals ?? []) {
          const key = session.restoreId ?? session.id;
          if (!restoredRestoreIds.has(key)) restoreById.set(key, session);
        }
        for (const session of persistedWorkspaceTerminals) {
          const key = session.restoreId ?? session.id;
          if (!restoredRestoreIds.has(key)) restoreById.set(key, session);
        }
        const terminalsToRestore = [...restoreById.values()];
        if (!sessionsRef.current.length && !restoredCurrentWorkspace && terminalsToRestore.length) {
          for (const session of terminalsToRestore) {
            const snapshot = session.restoreId ? await api.terminal.snapshot(session.restoreId).catch(() => null) : null;
            const startupCommand = restoredTerminalStartupCommand(session, snapshot, loadedSettings);
            const created = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: session.profileId, cwd: session.cwd, name: session.name, startupCommand, restoreId: session.restoreId });
            const restoredSession = { ...created, originalStartupCommand: session.originalStartupCommand ?? session.startupCommand, resumeState: session.resumeState ?? snapshot?.resumeState, restoredFromSnapshot: true, ...('resumeStartupCommand' in session ? { resumeStartupCommand: session.resumeStartupCommand ?? '' } : {}), splitGroupId: session.splitGroupId, splitDirection: session.splitDirection, splitGroupOrder: session.splitGroupOrder };
            sessionStore.replaceSession(created.id, restoredSession);
            if (session.restoreId && (session.restoreId === loadedLayout?.activeTerminalRestoreId || session.restoreId === persistedActiveRestoreId)) restoredActiveRuntimeId = restoredSession.id;
            if (session.id === loadedLayout?.activeTerminalRuntimeId) restoredActiveRuntimeId = restoredSession.id;
            firstSessionId ??= restoredSession.id;
            createdSessions = true;
          }
        } else if (!sessionsRef.current.length && !restoredCurrentWorkspace && terminalProfiles[0]) {
          const created = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: setupProfile ?? terminalProfiles[0].id, cwd: workspace.path, name: 'Terminal', startupCommand: setup?.newSessionCommand });
          firstSessionId ??= created.id;
          createdSessions = true;
        }
        if (restoredActiveRuntimeId) firstSessionId = restoredActiveRuntimeId;
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
            if (!(await api.fs.pathExists(filePath))) continue;
            const mediaKind = mediaKindForPath(filePath);
            if (mediaKind) {
              const media = await api.fs.readFileDataUrl(filePath);
              tabByPath.set(filePath, { path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: '', dirty: false, mediaKind, mimeType: media.mimeType, dataUrl: media.dataUrl });
            } else {
              const file = await api.fs.readFile(filePath);
              tabByPath.set(filePath, { path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: file.content, dirty: false });
            }
          } catch {
            // File was deleted or moved while layout still referenced it. Skip it
            // instead of restoring a blank zombie tab.
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
      sessionStore.removeSessionLocal(payload.id);
      sessionStore.completeHeadlessRun(payload.id, payload);
      const output = useSessionStore.getState().headlessRuns.find((run) => run.id === payload.id)?.output.trim() || payload.output.trim();
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

  // If the repo goes away (or never existed), clear Source Control selection
  // without changing the global view toggles.
  useEffect(() => {
    if (git && !git.isRepo) {
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
      const shouldSave = await promptDialog.confirm({ title: `Save ${file.name}?`, message: 'Save changes before closing this file.', confirmLabel: 'Save' });
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

  function closeDeletedPath(path: string) {
    const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    setEditorsBySession((map) => {
      let changed = false;
      const next: Record<string, SessionEditors> = {};
      for (const [sessionId, entry] of Object.entries(map)) {
        const normalized = normalizeEditors(entry);
        const editorGroups = normalized.editorGroups.map((group) => {
          const openFiles = group.openFiles.filter((file) => {
            const filePath = file.path.replace(/\\/g, '/').toLowerCase();
            const deleted = filePath === normalizedPath || filePath.startsWith(`${normalizedPath}/`);
            if (deleted) changed = true;
            return !deleted;
          });
          const activeFile = openFiles.some((file) => file.path === group.activeFile) ? group.activeFile : openFiles[0]?.path ?? null;
          return { ...group, openFiles, activeFile };
        }).filter((group, _index, groups) => group.openFiles.length || groups.length === 1);
        const hasFiles = editorGroups.some((group) => group.openFiles.length);
        next[sessionId] = { ...normalized, editorGroups, activeEditorGroup: editorGroups.some((group) => group.id === normalized.activeEditorGroup) ? normalized.activeEditorGroup : editorGroups[0]?.id ?? normalized.activeEditorGroup, activeKind: hasFiles ? normalized.activeKind : normalized.openLinks.length ? 'web' : 'terminal' };
      }
      return changed ? next : map;
    });
    if (editorDiff?.path) {
      const diffPath = editorDiff.path.replace(/\\/g, '/').toLowerCase();
      if (diffPath === normalizedPath || diffPath.startsWith(`${normalizedPath}/`)) setEditorDiff(null);
    }
  }

  async function addPathToContext(path: string) {
    if (!activeTerminalId) return;
    try {
      const attachment = await api.attachments.inspectPath(path, 'drop');
      await api.terminal.write(activeTerminalId, `${quoteTerminalPath(attachment.referencePath)} `);
      showToast('Added folder to terminal context', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not add to context'), 'error');
    }
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

  function markSessionAttention(sessionId: string) {
    setHighlightedSessionIds((ids) => ids.includes(sessionId) ? ids : [...ids, sessionId]);
  }

  function clearSessionAttention(sessionId: string) {
    setHighlightedSessionIds((ids) => ids.filter((id) => id !== sessionId));
  }

  function activateSession(sessionId: string) {
    const hadAttention = highlightedSessionIds.includes(sessionId);
    clearSessionAttention(sessionId);
    if (hadAttention) {
      patchSession(sessionId, (prev) => prev.activeWeb && prev.openLinks.some((link) => link.id === prev.activeWeb) ? { ...prev, activeKind: 'web' } : prev);
    }
    const target = allSessions.find((session) => session.id === sessionId);
    sessionStore.setActiveSession(sessionId);
    if (target && target.workspaceId !== workspace.id) void onOpenWorkspace(target.workspaceId);
  }

  // Browser opens captured from terminal tools (via the loopback bridge). Respect
  // the external-browser setting so CLI/browser consent prompts do what they say.
  function openCapturedLink(url: string, sessionId?: string) {
    if (settings?.openLinksExternally) {
      void api.shell.openExternal(url).catch((error) => showToast(getErrorMessage(error, 'Could not open link'), 'error'));
      return;
    }
    const target = sessionId && allSessions.some((session) => session.id === sessionId)
      ? allSessions.find((session) => session.id === sessionId)!
      : null;
    const targetSessionId = target?.id ?? activeTerminalId;
    if (!targetSessionId) return;
    const targetIsActive = targetSessionId === activeTerminalId && (!target || target.workspaceId === workspace.id);
    const mode = settings?.capturedLinkOpenMode ?? 'tab';
    const split = mode === 'tab' ? null : (mode.replace('split-', '') as 'right' | 'left' | 'up' | 'down');
    patchSession(targetSessionId, (prev) => {
      const existing = prev.openLinks.find((link) => link.url === url);
      const tabId = existing?.id ?? crypto.randomUUID();
      const base = targetIsActive
        ? split
          ? { ...prev, webSplit: split }
          : { ...prev, activeKind: 'web' as const }
        : prev;
      if (existing) return { ...base, activeWeb: tabId };
      const tab: WebTab = { id: tabId, url, name: linkLabel(url) };
      return { ...base, openLinks: [...prev.openLinks, tab], activeWeb: tab.id };
    });
    if (!targetIsActive) markSessionAttention(targetSessionId);
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

  async function splitFileIntoSessionPane(sessionId: string, path: string, groupId: string, side: SplitDirection) {
    const sourceEditors = normalizeEditors(editorsBySession[sessionId]);
    if (sourceEditors.activeKind !== 'terminal') return false;
    const sourceGroup = sourceEditors.editorGroups.find((group) => group.id === groupId);
    const file = sourceGroup?.openFiles.find((item) => item.path === path);
    const sourceSession = sessions.find((session) => session.id === sessionId);
    if (!file || !sourceSession) return false;
    if (!requireTrusted('splitting a file beside the terminal')) return true;
    try {
      const direction = sideToDirection(side);
      const groupIdForSplit = sourceSession.splitGroupId ?? crypto.randomUUID();
      const existingMembers = sourceSession.splitGroupId
        ? [...sessions.filter((session) => session.splitGroupId === sourceSession.splitGroupId)].sort((a, b) => (a.splitGroupOrder ?? sessions.indexOf(a)) - (b.splitGroupOrder ?? sessions.indexOf(b)))
        : [sourceSession];
      const sourceIndex = Math.max(0, existingMembers.findIndex((session) => session.id === sourceSession.id));
      const insertIndex = isBeforeSide(side) ? sourceIndex : sourceIndex + 1;
      const created = await sessionStore.createSession({ workspaceId: sourceSession.workspaceId, workspaceName: sourceSession.workspaceName, workspacePath: sourceSession.workspacePath, profileId: sourceSession.profileId, cwd: sourceSession.cwd, name: `${sourceSession.name} Split`, startupCommand: '' });
      const targetGroup = createEditorGroup([{ ...file }], path);
      setEditorsBySession((map) => ({
        ...map,
        [created.id]: { ...normalizeEditors(map[created.id]), editorGroups: [targetGroup], activeEditorGroup: targetGroup.id, splitOrientation: 'horizontal', openLinks: [], activeKind: 'editor', activeWeb: null, webSplit: null },
      }));
      await Promise.all(existingMembers.map((session, index) => sessionStore.updateSessionMetadata(session.id, { splitGroupId: groupIdForSplit, splitDirection: direction, splitGroupOrder: index >= insertIndex ? index + 1 : index })));
      await sessionStore.updateSessionMetadata(created.id, { splitGroupId: groupIdForSplit, splitDirection: direction, splitGroupOrder: insertIndex });
      sessionStore.setActiveSession(created.id);
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not split file beside terminal'), 'error');
    }
    return true;
  }

  async function splitFileTabFor(sessionId: string, path: string, groupId: string, direction: SplitDirection) {
    if (await splitFileIntoSessionPane(sessionId, path, groupId, direction)) return;
    splitFileFor(sessionId, path, groupId, direction);
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
    if (!requireTrusted('running automation commands')) return;
    await createTerminal(undefined, command.terminalName || command.label || 'Command', command.command, command.cwd?.trim() ? command.cwd : workspace.path, { headless: command.headless === true, commandLabel: command.label });
    if (command.headless) showToast(`Running ${command.label} headlessly`, 'info');
    else showToast(`Started ${command.label}`, 'success');
  }

  // profileId omitted => fall back to this workspace's configured default
  // profile, then the global default. An empty startupCommand picks up the
  // workspace's "run on new session" command from automation.json.
  async function createTerminal(profileId?: string, name = 'Terminal', startupCommand = '', cwd = workspace.path, options?: { headless?: boolean; commandLabel?: string }) {
    if (!requireTrusted('creating terminals')) return;
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
    if (!requireTrusted('restarting terminals')) return;
    const old = allSessions.find((session) => session.id === id);
    if (!old) return;
    await api.terminal.kill(old.id, true);
    const next = await api.terminal.create(old.profileId, cwd ?? old.cwd, old.name, old.resumeState?.resumeCommand || old.startupCommand, old.restoreId, { workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath });
    const replacement: WorkspaceTerminalSession = { ...next, workspaceId: old.workspaceId, workspaceName: old.workspaceName, workspacePath: old.workspacePath, originalStartupCommand: old.originalStartupCommand ?? old.startupCommand, resumeState: next.resumeState ?? old.resumeState, splitGroupId: old.splitGroupId, splitDirection: old.splitDirection, splitGroupOrder: old.splitGroupOrder };
    sessionStore.replaceSession(id, replacement);
  }

  function reloadTerminalView(id: string) {
    setTerminalReloadTokens((tokens) => ({ ...tokens, [id]: (tokens[id] ?? 0) + 1 }));
    showToast('Terminal view reloaded from latest snapshot', 'success');
  }

  async function checkTerminalHealth(id: string) {
    try {
      const snapshot = await api.terminal.snapshot(id);
      if (!snapshot?.output) {
        showToast('No terminal snapshot is available yet', 'info');
        return;
      }
      reloadTerminalView(id);
    } catch (error) {
      showToast(getErrorMessage(error, 'Terminal health check failed'), 'error');
    }
  }

  async function killFrozenTerminal(id: string) {
    const target = allSessions.find((session) => session.id === id);
    if (!target) return;
    if (!(await promptDialog.confirm({ title: `Kill ${target.name}?`, message: 'This closes the terminal process and removes its saved snapshot.', confirmLabel: 'Kill', danger: true, icon: '!' }))) return;
    try {
      await api.terminal.kill(id);
      sessionStore.removeSessionLocal(id);
      showToast('Terminal killed', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not kill terminal'), 'error');
    }
  }

  async function openActiveExternalTerminal(id: string) {
    const target = allSessions.find((session) => session.id === id);
    try {
      await api.app.openExternalTerminal(target?.cwd ?? workspace.path);
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not open external terminal'), 'error');
    }
  }

  async function duplicateTerminal(id: string) {
    if (!requireTrusted('duplicating terminals')) return;
    const source = allSessions.find((session) => session.id === id);
    if (!source) return;
    await sessionStore.createSession({ workspaceId: source.workspaceId, workspaceName: source.workspaceName, workspacePath: source.workspacePath, profileId: source.profileId, cwd: source.cwd, name: `${source.name} Copy`, startupCommand: source.startupCommand ?? '' });
  }

  async function setTerminalCwd(id: string, cwd: string) {
    if (!cwd.trim()) return;
    if (!(await promptDialog.confirm({ title: 'Restart terminal?', message: 'Terminal will restart in the new working directory.', confirmLabel: 'Restart', icon: '↻' }))) return;
    await restartTerminal(id, cwd.trim());
  }

  async function splitTerminal(id: string, side: TerminalSplitSide) {
    if (!requireTrusted('splitting terminals')) return;
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

  async function detachTerminal(id: string) {
    const target = allSessions.find((session) => session.id === id);
    if (!target?.splitGroupId) return;
    try {
      const group = allSessions.filter((session) => session.splitGroupId === target.splitGroupId);
      await sessionStore.updateSessionMetadata(id, { splitGroupId: null, splitDirection: null, splitGroupOrder: null });
      const remaining = group.filter((session) => session.id !== id);
      if (remaining.length <= 1) {
        await Promise.all(remaining.map((session) => sessionStore.updateSessionMetadata(session.id, { splitGroupId: null, splitDirection: null, splitGroupOrder: null })));
      } else {
        await Promise.all(remaining.map((session, index) => sessionStore.updateSessionMetadata(session.id, { splitGroupOrder: index })));
      }
      sessionStore.setActiveSession(id);
    } catch (error) { showToast(getErrorMessage(error, 'Could not detach session'), 'error'); }
  }

  async function closeTerminal(id: string) {
    await sessionStore.closeSession(id);
  }

  async function closeTerminals(ids: string[]) {
    for (const id of ids) await sessionStore.closeSession(id);
  }

  function showGitError(error: unknown) {
    setGitError(error instanceof Error ? error.message : String(error));
  }

  async function openGitDiff(file: GitFileStatus, staged = file.staged && !file.unstaged) {
    const absolutePath = joinPath(workspace.path, file.path);
    setSelectedGitFile(file);
    setSelectedGitStaged(staged);
    if (isGitDirectoryStatusPath(file.path)) {
      setEditorDiff(null);
      showToast('Directory changes cannot be previewed as a file diff', 'info');
      return;
    }
    const contents = await api.git.fileContents(workspace.path, file.path, staged);
    if (contents.binary) {
      setEditorDiff(null);
      showToast('Binary files cannot be previewed in the diff editor', 'info');
      return;
    }
    setEditorDiff({ path: absolutePath, original: contents.original, staged, untracked: file.untracked });
    patchActive((prev) => {
      const targetGroupId = prev.activeEditorGroup;
      const tab: OpenFileTab = { path: absolutePath, name: baseName(absolutePath), content: contents.modified, dirty: false };
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

  async function selectGitFile(file: GitFileStatus, staged = file.staged && !file.unstaged, event?: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>, groupFiles: GitFileStatus[] = []) {
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
    if (!requireTrusted('staging git changes')) return;
    try { setGitError(null); await api.git.stage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function stagePaths(paths: string[]) {
    if (!requireTrusted('staging git changes')) return;
    try { setGitError(null); for (const path of paths) await api.git.stage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function stageAll() {
    if (!requireTrusted('staging git changes')) return;
    try { setGitError(null); await api.git.addAll(workspace.path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function unstage(path: string) {
    if (!requireTrusted('unstaging git changes')) return;
    try { setGitError(null); await api.git.unstage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function unstagePaths(paths: string[]) {
    if (!requireTrusted('unstaging git changes')) return;
    try { setGitError(null); for (const path of paths) await api.git.unstage(workspace.path, path); await refreshGit(); } catch (error) { showGitError(error); }
  }

  async function discardPath(path: string) {
    const file = selectedGitFile?.path === path ? selectedGitFile : git?.files.find((item) => item.path === path);
    if (file?.untracked) await api.fs.deletePath(joinPath(workspace.path, path));
    else await api.git.discard(workspace.path, path);
  }

  async function discard(path: string) {
    if (!requireTrusted('discarding git changes')) return;
    if (gitConfig.confirmBeforeDiscard !== false && !(await promptDialog.confirm({ title: `Discard ${path}?`, message: 'This cannot be undone.', confirmLabel: 'Discard', danger: true }))) return;
    try {
      setGitError(null);
      await discardPath(path);
      closeDeletedPath(joinPath(workspace.path, path));
      await refreshGit();
      setRefreshToken((token) => token + 1);
    } catch (error) { showGitError(error); }
  }

  async function discardPaths(paths: string[]) {
    if (!requireTrusted('discarding git changes')) return;
    if (!paths.length) return;
    if (gitConfig.confirmBeforeDiscard !== false && !(await promptDialog.confirm({ title: `Discard ${paths.length} selected ${paths.length === 1 ? 'file' : 'files'}?`, message: 'This cannot be undone.', confirmLabel: 'Discard', danger: true }))) return;
    try {
      setGitError(null);
      for (const path of paths) {
        await discardPath(path);
        closeDeletedPath(joinPath(workspace.path, path));
      }
      await refreshGit();
      setRefreshToken((token) => token + 1);
    } catch (error) { showGitError(error); }
  }

  async function ignore(path: string) {
    if (!requireTrusted('updating .gitignore')) return;
    try {
      setGitError(null);
      await api.git.ignore(workspace.path, path);
      await refreshGit();
      showToast(`Added ${path} to .gitignore`, 'success');
    } catch (error) { showGitError(error); }
  }

  async function commit(message: string) {
    if (!requireTrusted('committing git changes')) return;
    try { setGitError(null); await api.git.commit(workspace.path, message); await refreshGit(); showToast('Commit created', 'success'); } catch (error) { showGitError(error); showToast(getErrorMessage(error, 'Commit failed'), 'error'); }
  }

  async function commitStaged(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    await commit(trimmed);
  }

  async function stageAllAndCommit(message: string) {
    if (!requireTrusted('committing git changes')) return;
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
    if (!requireTrusted('switching git branches')) return;
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

  type GitRemoteKind = 'fetch' | 'pull' | 'pullMerge' | 'push';

  function isGitTerminalAuthError(error: unknown) {
    const message = getErrorMessage(error, '');
    return /Authentication failed|Credentials are incorrect or have expired|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|Repository not found.*(Authentication|auth|credential|permission)/i.test(message);
  }

  async function runGitInTerminal(kind: GitRemoteKind) {
    if (!requireTrusted(`running git ${kind} in terminal`)) return;
    const commands: Record<GitRemoteKind, string> = { fetch: 'git fetch', pull: 'git pull --ff-only', pullMerge: 'git pull --no-rebase --no-edit', push: 'git push' };
    await createTerminal(undefined, `Git ${kind === 'pullMerge' ? 'Pull Merge' : kind}`, commands[kind], workspace.path);
    showToast('Git command started in terminal. Press Refresh after it completes.', 'info');
  }

  async function runGitRemoteAction(kind: GitRemoteKind) {
    const label = kind === 'pullMerge' ? 'pull merge' : kind;
    if (!requireTrusted(`running git ${label}`)) return;
    if (gitConfig.confirmBeforeRemoteActions !== false && (kind === 'pull' || kind === 'pullMerge' || kind === 'push') && !(await promptDialog.confirm({ title: `Run git ${label}?`, message: `Workspace: ${workspace.name}\nThis will ${kind === 'push' ? 'update the remote repository' : 'modify local files'}.`, confirmLabel: label[0].toUpperCase() + label.slice(1), icon: '⎇' }))) return;
    try {
      setGitError(null);
      await api.git[kind](workspace.path);
      await refreshGit();
      if (kind === 'pull' || kind === 'pullMerge') setRefreshToken((token) => token + 1);
      showToast(`Git ${label} complete`, 'success');
    } catch (error) {
      await refreshGit();
      const message = getErrorMessage(error, `Git ${label} failed`);
      setGitError(message);
      if (isGitTerminalAuthError(error)) {
        const confirmed = await promptDialog.confirm({ title: `Git ${label} needs terminal authentication`, message: `${message}\n\nRun it in a terminal?`, confirmLabel: 'Run in Terminal', icon: '⎇' });
        if (confirmed) await runGitInTerminal(kind);
      } else {
        showToast(message, 'error');
      }
    }
  }

  async function abortGitMerge() {
    if (!requireTrusted('aborting merge')) return;
    if (!(await promptDialog.confirm({ title: 'Abort merge?', message: 'This will stop the current merge and restore pre-merge state where possible.', confirmLabel: 'Abort Merge', danger: true, icon: '⚠' }))) return;
    try {
      setGitError(null);
      await api.git.abortMerge(workspace.path);
      await refreshGit();
      setRefreshToken((token) => token + 1);
      showToast('Merge aborted', 'success');
    } catch (error) {
      showGitError(error);
      showToast(getErrorMessage(error, 'Could not abort merge'), 'error');
    }
  }

  const defaultLayout = getDefaultLayout(workspace.id);
  const mergedLayout = layout ?? defaultLayout;

  function saveWorkspaceViewState(next: StackDockSettings['workspaceViewState']) {
    if (!settings) return;
    const optimistic = { ...settings, workspaceViewState: next };
    setSettings(optimistic);
    onSettingsApplied?.(optimistic);
    api.settings.save(optimistic).then((saved) => {
      setSettings(saved);
      onSettingsApplied?.(saved);
    }).catch((error) => showToast(getErrorMessage(error, 'Could not save view setting'), 'error'));
  }

  function saveWorkspaceViewStatePatch(patch: Partial<StackDockSettings['workspaceViewState']>) {
    saveWorkspaceViewState({ ...workspaceViewState, ...patch });
  }

  function setViewVisible(viewId: string, visible: boolean) {
    const current = visibleActivityViewIds;
    const next = visible ? [...new Set([...current, viewId])] : current.filter((id) => id !== viewId);
    saveWorkspaceViewStatePatch({ visibleActivityViewIds: next });
  }

  function openView(viewId: string) {
    const sessionView = baseSessionContributions.some((view) => view.id === viewId);
    if (sessionView) { saveWorkspaceViewStatePatch({ sessionsVisible: true }); return; }
    if (!activityContributions.some((view) => view.id === viewId)) return;
    setViewVisible(viewId, true);
  }

  function toggleView(viewId: string) {
    const sessionView = baseSessionContributions.some((view) => view.id === viewId);
    if (sessionView) { saveWorkspaceViewStatePatch({ sessionsVisible: !sessionsVisible }); return; }
    if (!activityContributions.some((view) => view.id === viewId)) return;
    setViewVisible(viewId, !visibleActivityViewIds.includes(viewId));
  }

  function toggleActivitySidebar() {
    if (visibleActivityViewIds.length) saveWorkspaceViewStatePatch({ visibleActivityViewIds: [] });
    else if (activityContributions[0]) setViewVisible(activityContributions[0].id, true);
  }

  function renderContributionIcon(icon?: string) {
    if (icon === 'git') return <GitBranchIcon />;
    if (icon === 'sessions') return <PanelLeftIcon />;
    if (icon === 'mic') return <MicrophoneIcon />;
    return <FolderIcon />;
  }
  const extensionCtx: WorkspaceExtensionContext = {
    workspace,
    settings,
    git,
    sessions,
    allSessions,
    activeSessionId: activeTerminalId,
    highlightedSessionIds,
    headlessRuns,
    isRepo,
    refreshToken,
    actions: {
      openFile,
      previewFile,
      openTerminalHere,
      addPathToContext,
      closeDeletedPath,
      openView,
      toggleView,
      openGit: () => { const gitView = activityContributions.find((view) => view.icon === 'git'); if (gitView) openView(gitView.id); },
      refreshGit,
      revealFolder: (targetPath = workspace.path) => void api.fs.revealInExplorer(targetPath),
      selectSession: activateSession,
      createSession: () => createTerminal(undefined, 'Terminal', ''),
      runTerminalCommand: async (name, command, cwd = workspace.path, profileId) => {
        if (!requireTrusted('running extension commands')) throw new Error('Workspace is not trusted');
        const requested = profileId && profiles.some((profile) => profile.id === profileId) ? profileId : workspaceSetup?.defaultTerminalProfile ?? defaultProfile?.id ?? 'powershell';
        const effectiveProfile = profiles.some((profile) => profile.id === requested) ? requested : defaultProfile?.id ?? 'powershell';
        const selectedProfile = profiles.find((profile) => profile.id === effectiveProfile);
        const startupCommand = resolveTerminalStartupCommand({ explicitStartupCommand: command, profileStartupCommand: selectedProfile?.startupCommand });
        const session = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: effectiveProfile, cwd, name, startupCommand });
        showToast(`Started ${name}`, 'success');
        return session;
      },
      killTerminal: async (id) => {
        if (sessions.some((session) => session.id === id)) await closeTerminal(id);
        else await api.terminal.kill(id);
      },
      runHeadlessCommand: async (name, command, cwd = workspace.path) => {
        if (!requireTrusted('running extension commands')) throw new Error('Workspace is not trusted');
        const requested = workspaceSetup?.defaultTerminalProfile ?? defaultProfile?.id ?? 'powershell';
        const effectiveProfile = profiles.some((profile) => profile.id === requested) ? requested : defaultProfile?.id ?? 'powershell';
        const selectedProfile = profiles.find((profile) => profile.id === effectiveProfile);
        const startupCommand = resolveTerminalStartupCommand({ explicitStartupCommand: command, profileStartupCommand: selectedProfile?.startupCommand });
        const session = await sessionStore.createSession({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, profileId: effectiveProfile, cwd, name, startupCommand, headless: true, commandLabel: name });
        showToast(`Running ${name} under Commands`, 'info');
        openView('stackdock.headless.view');
        return session;
      },
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
      clearError: () => setGitError(null),
      selectedFile: selectedGitFile,
      selectedGroup: selectedGitFile ? (selectedGitStaged ? 'staged' : 'changes') : null,
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
      ignore,
      commit,
      commitStaged,
      stageAllAndCommit,
      switchBranch: switchGitBranch,
      fetch: () => runGitRemoteAction('fetch'),
      pull: () => runGitRemoteAction('pull'),
      pullMerge: () => runGitRemoteAction('pullMerge'),
      abortMerge: abortGitMerge,
      push: () => runGitRemoteAction('push'),
      pushInTerminal: () => runGitInTerminal('push'),
    },
    sessionActions: {
      create: async (target, profileId) => { const setup = automation?.workspaces[target.id]; const profile = profiles.find((item) => item.id === profileId); const startupCommand = resolveTerminalStartupCommand({ profileStartupCommand: profile?.startupCommand, workspaceStartupCommand: setup?.newSessionCommand }); await sessionStore.createSession({ workspaceId: target.id, workspaceName: target.name, workspacePath: target.path, profileId, cwd: target.path, name: 'Terminal', startupCommand }); if (target.id !== workspace.id) await onOpenWorkspace(target.id); },
      openWorkspace: (id) => void onOpenWorkspace(id),
      close: (id) => void closeTerminal(id),
      closeMany: (ids) => void closeTerminals(ids),
      rename: renameTerminal,
      restart: (id) => void restartTerminal(id),
      duplicate: (id) => void duplicateTerminal(id),
      setCwd: (id, cwd) => void setTerminalCwd(id, cwd),
      split: (id, direction) => void splitTerminal(id, direction),
      detach: (id) => void detachTerminal(id),
    },
  };
  const enabledExtensions = resolveEnabledExtensions(extensionRegistry.extensions, settings);
  const statusBarContributions = getEnabledStatusBarContributions(enabledExtensions, extensionCtx);
  const baseSessionContributions = getEnabledViewContributions(enabledExtensions, 'sessions', extensionCtx);
  const sessionContribution = baseSessionContributions[0] ?? null;
  const activityContributions = getEnabledViewContributions(enabledExtensions, 'activity', extensionCtx);
  const renderExtensionView = (contribution: ExtensionViewContribution) => extensionRegistry.nativeExtensions.get(contribution.extensionId)?.renderView?.(contribution, extensionCtx) ?? null;
  const defaultActivityViewIds = activityContributions.filter((_, index) => index < 2).map((view) => view.id);
  const workspaceViewState: StackDockSettings['workspaceViewState'] = {
    sessionsVisible: settings?.workspaceViewState.sessionsVisible !== false,
    visibleActivityViewIds: settings?.workspaceViewState.visibleActivityViewIds ?? defaultActivityViewIds,
    viewPlacements: settings?.workspaceViewState.viewPlacements ?? {},
    viewOrder: settings?.workspaceViewState.viewOrder ?? [],
  };
  const viewPlacements = workspaceViewState.viewPlacements ?? {};
  const viewOrder = workspaceViewState.viewOrder ?? [];
  const visibleActivityViewIds = workspaceViewState.visibleActivityViewIds.filter((id) => activityContributions.some((view) => view.id === id));
  const orderViewContributions = <T extends ExtensionViewContribution>(views: T[]) => {
    const orderIndex = new Map(viewOrder.map((id, index) => [id, index]));
    return [...views].sort((a, b) => {
      const aIndex = orderIndex.get(a.id);
      const bIndex = orderIndex.get(b.id);
      if (aIndex !== undefined || bIndex !== undefined) return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
      return (a.order ?? 0) - (b.order ?? 0);
    });
  };
  const visibleMovableContributions = activityContributions.filter((view) => visibleActivityViewIds.includes(view.id));
  const movedSessionContributions = visibleMovableContributions.filter((view) => MOVABLE_WORKSPACE_VIEW_IDS.has(view.id) && viewPlacements[view.id] === 'sessions');
  const visibleActivityContributions = orderViewContributions(visibleMovableContributions.filter((view) => !MOVABLE_WORKSPACE_VIEW_IDS.has(view.id) || viewPlacements[view.id] !== 'sessions'));
  const sessionContributions = orderViewContributions([...baseSessionContributions, ...movedSessionContributions]);
  const sidebarVisible = visibleActivityContributions.length > 0;
  const sessionsVisible = sessionContributions.length > 0 && settings?.workspaceViewState.sessionsVisible !== false;
  const panelSizes = mergedLayout.panels.panelSizes ?? { sessions: 14, explorer: 18, main: 68, editor: 72, git: 28, upper: 62, terminal: 38 };
  const viewPanelSizes = mergedLayout.extensions?.panelSizesByViewId ?? {};
  const safePanelSizes = getSafePanelSizes(panelSizes, sidebarVisible, sessionsVisible);
  const extensionCommands = enabledExtensions.flatMap((manifest) => extensionRegistry.nativeExtensions.get(manifest.id)?.getCommands?.(extensionCtx) ?? []);
  function renderTerminalOverlays(session: WorkspaceTerminalSession) {
    const smartInputEnabled = settings?.terminal.smartInput?.enabled === true;
    return enabledExtensions.flatMap((manifest) => {
      const extension = extensionRegistry.nativeExtensions.get(manifest.id);
      // Extensions embedded in the Smart Input composer drop their floating overlay while it is open.
      if (smartInputEnabled && extension?.renderTerminalSmartInputAction) return [];
      const overlay = extension?.renderTerminalOverlay?.(extensionCtx, session);
      return overlay ? [<div key={manifest.id} className="terminal-extension-overlay-item">{overlay}</div>] : [];
    });
  }

  function renderTerminalSmartInputActions(session: WorkspaceTerminalSession, insertText: (text: string) => void) {
    return enabledExtensions.flatMap((manifest) => {
      const action = extensionRegistry.nativeExtensions.get(manifest.id)?.renderTerminalSmartInputAction?.(extensionCtx, session, { insertText });
      return action ? [<div key={manifest.id} className="terminal-smart-input-action-item">{action}</div>] : [];
    });
  }

  function placeViewOnTarget(viewId: string, zone: WorkspaceViewZone, targetViewId: string, insertAfter: boolean, zoneViews: ExtensionViewContribution[]) {
    if (!MOVABLE_WORKSPACE_VIEW_IDS.has(viewId)) return;
    const nextPlacements = { ...viewPlacements, [viewId]: zone };
    if (zone === 'activity') delete nextPlacements[viewId];
    const nextZoneIds = zoneViews.map((view) => view.id).filter((id) => id !== viewId);
    const targetIndex = nextZoneIds.indexOf(targetViewId);
    nextZoneIds.splice(targetIndex < 0 ? nextZoneIds.length : targetIndex + (insertAfter ? 1 : 0), 0, viewId);
    const nextZoneIdSet = new Set(nextZoneIds);
    saveWorkspaceViewStatePatch({
      sessionsVisible: zone === 'sessions' ? true : workspaceViewState.sessionsVisible,
      visibleActivityViewIds: visibleActivityViewIds.includes(viewId) ? visibleActivityViewIds : [...visibleActivityViewIds, viewId],
      viewPlacements: nextPlacements,
      viewOrder: [...viewOrder.filter((id) => !nextZoneIdSet.has(id) && id !== viewId), ...nextZoneIds],
    });
  }

  function viewIdForResizeEdge(upper: ExtensionViewContribution, lower: ExtensionViewContribution) {
    if (MOVABLE_WORKSPACE_VIEW_IDS.has(lower.id)) return lower.id;
    if (MOVABLE_WORKSPACE_VIEW_IDS.has(upper.id)) return upper.id;
    return null;
  }

  function zoneViewsFor(zone: WorkspaceViewZone) {
    return zone === 'sessions' ? sessionContributions : visibleActivityContributions;
  }

  function finishViewEdgeMove(viewId: string, clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.extension-view-frame[data-view-id][data-view-zone]');
    const targetViewId = target?.dataset.viewId;
    const targetZone = target?.dataset.viewZone as WorkspaceViewZone | undefined;
    if (!targetViewId || (targetZone !== 'sessions' && targetZone !== 'activity')) return;
    const rect = target.getBoundingClientRect();
    placeViewOnTarget(viewId, targetZone, targetViewId, clientY > rect.top + rect.height / 2, zoneViewsFor(targetZone));
  }

  function startViewEdgeMove(event: { ctrlKey: boolean; preventDefault(): void; stopPropagation(): void }, viewId: string) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingViewId(viewId);
    const finish = (pointerEvent: globalThis.PointerEvent) => {
      finishViewEdgeMove(viewId, pointerEvent.clientX, pointerEvent.clientY);
      setDraggingViewId(null);
      window.removeEventListener('pointercancel', cancel, true);
    };
    const cancel = () => setDraggingViewId(null);
    window.addEventListener('pointerup', finish, { once: true, capture: true });
    window.addEventListener('pointercancel', cancel, { once: true, capture: true });
  }

  function renderViewFrame(contribution: ExtensionViewContribution, zone: WorkspaceViewZone, zoneViews: ExtensionViewContribution[]) {
    return (
      <div
        className={`extension-view-frame${draggingViewId ? ' view-drop-active' : ''}`}
        data-view-id={contribution.id}
        data-view-zone={zone}
      >
        <div className="extension-view-body">{renderExtensionView(contribution)}</div>
      </div>
    );
  }

  function renderViewStack(contributions: ExtensionViewContribution[], zone: WorkspaceViewZone) {
    if (contributions.length === 0) return null;
    if (contributions.length === 1) return renderViewFrame(contributions[0], zone, contributions);
    return (
      <PanelGroup
        direction="vertical"
        className={`sidebar-stack ${zone === 'sessions' ? 'sessions-stack' : ''}`}
        onLayout={(sizes) => {
          const next: Record<string, number> = {};
          contributions.forEach((contribution, index) => { next[contribution.id] = sizes[index]; });
          updateExtensionPanelSizes(next);
        }}
      >
        {contributions.flatMap((contribution, index) => [
          <Panel key={contribution.id} id={`${zone}-${contribution.id}`} defaultSize={viewPanelSizes[contribution.id] ?? 100 / contributions.length} minSize={6}>
            {renderViewFrame(contribution, zone, contributions)}
          </Panel>,
          index < contributions.length - 1 ? (
            <PanelResizeHandle
              key={`${contribution.id}:resize`}
              className={`resize-handle horizontal${viewIdForResizeEdge(contribution, contributions[index + 1]) ? ' movable-view-edge' : ''}`}
              title={viewIdForResizeEdge(contribution, contributions[index + 1]) ? 'Ctrl+drag to move this panel' : undefined}
              hitAreaMargins={{ coarse: 14, fine: 8 }}
              onPointerDownCapture={(event) => {
                const viewId = viewIdForResizeEdge(contribution, contributions[index + 1]);
                if (viewId) startViewEdgeMove(event, viewId);
              }}
            />
          ) : null,
        ])}
      </PanelGroup>
    );
  }
  const statusBarCommands: CommandAction[] = statusBarContributions
    .filter((contribution) => contribution.entry && !contribution.native)
    .map((contribution) => {
      const manifest = enabledExtensions.find((item) => item.id === contribution.extensionId);
      const label = contribution.tooltip || manifest?.name || contribution.label || contribution.id;
      return {
        id: `${contribution.id}.open`,
        label: label.startsWith('Open ') ? label : `Open ${label}`,
        description: manifest?.description,
        run: () => { window.dispatchEvent(new CustomEvent('stackdock:open-statusbar-contribution', { detail: contribution.id })); },
      };
    });
  function openSettings(tab: SettingsTab = 'general') { setSettingsInitialTab(tab); setSettingsOpen(true); }
  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.id === workspace.id) return -1;
    if (b.id === workspace.id) return 1;
    return new Date(b.lastOpenedAt ?? b.createdAt).getTime() - new Date(a.lastOpenedAt ?? a.createdAt).getTime();
  });

  async function createTerminalInWorkspace(target: Workspace) {
    if (!requireTrusted('creating terminals')) return;
    const setup = automation?.workspaces[target.id];
    const profileId = setup?.defaultTerminalProfile && profiles.some((profile) => profile.id === setup.defaultTerminalProfile) ? setup.defaultTerminalProfile : defaultProfile?.id ?? 'powershell';
    const profile = profiles.find((item) => item.id === profileId);
    const startupCommand = resolveTerminalStartupCommand({ profileStartupCommand: profile?.startupCommand, workspaceStartupCommand: setup?.newSessionCommand });
    await sessionStore.createSession({ workspaceId: target.id, workspaceName: target.name, workspacePath: target.path, profileId, cwd: target.path, name: 'Terminal', startupCommand });
    if (target.id !== workspace.id) await onOpenWorkspace(target.id);
    showToast(`Opened terminal in ${target.name}`, 'success');
  }

  async function exportDiagnosticsAction() {
    try {
      const result = await api.app.exportDiagnostics({ workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, redactPaths: true });
      showToast('Diagnostics exported', 'success', { onClick: () => void api.fs.revealInExplorer(result.path) });
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not export diagnostics'), 'error');
    }
  }

  async function exportSettingsBackupAction() {
    try {
      const result = await api.app.exportSettingsBackup();
      showToast('Settings backup exported', 'success', { onClick: () => void api.fs.revealInExplorer(result.path) });
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not export settings backup'), 'error');
    }
  }

  async function resetSettingsAction() {
    if (!(await promptDialog.confirm({ title: 'Reset settings?', message: 'This restores default app settings. Workspace files are not touched.', confirmLabel: 'Reset Settings', danger: true, icon: '!' }))) return;
    try {
      const saved = await api.app.resetSettings();
      setSettings(saved);
      applyTheme(saved.themeId, saved.importedThemes);
      onSettingsApplied?.(saved);
      setProfiles(await api.terminal.profiles());
      showToast('Settings reset to defaults', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not reset settings'), 'error');
    }
  }

  async function resetWorkspaceLayoutAction() {
    if (!(await promptDialog.confirm({ title: 'Reset workspace layout?', message: 'This resets panels, tabs, and saved layout for this workspace. Files and terminals are not deleted.', confirmLabel: 'Reset Layout', danger: true, icon: '!' }))) return;
    try {
      await api.app.resetWorkspaceLayout(workspace.id);
      setLayout(getDefaultLayout(workspace.id));
      setEditorsBySession({});
      setHtmlPreviewBySession({});
      showToast('Workspace layout reset', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not reset workspace layout'), 'error');
    }
  }

  async function enableSafeModeAction() {
    if (!(await promptDialog.confirm({ title: 'Enable Safe Mode?', message: 'StackDock will back up settings and remove local extension package paths for the next launch.', confirmLabel: 'Enable Safe Mode', icon: '!' }))) return;
    try {
      const result = await api.app.enableSafeMode();
      showToast('Safe Mode prepared for next launch', 'success', { onClick: () => void api.fs.revealInExplorer(result.backupPath) });
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not enable Safe Mode'), 'error');
    }
  }

  async function openLogsFolderAction() {
    try {
      await api.app.openLogsFolder();
    } catch (error) {
      showToast(getErrorMessage(error, 'Could not open logs folder'), 'error');
    }
  }

  const workspaceLauncherActions: CommandAction[] = sortedWorkspaces.map((target) => ({
    id: `stackdock.workspace.openTerminal.${target.id}`,
    label: `Open Workspace: ${target.name}`,
    description: target.id === workspace.id ? `Active • ${target.path}` : target.path,
    run: () => createTerminalInWorkspace(target),
  }));

  const settingsActions: CommandAction[] = [
    { id: 'stackdock.settings.open', label: 'Open Settings', keybind: settings?.keybinds['stackdock.settings.open'], run: () => openSettings('general') },
    { id: 'stackdock.settings.open.general', label: 'Open Settings: General', keybind: settings?.keybinds['stackdock.settings.open.general'], run: () => openSettings('general') },
    { id: 'stackdock.settings.open.appearance', label: 'Open Settings: Appearance', keybind: settings?.keybinds['stackdock.settings.open.appearance'], run: () => openSettings('appearance') },
    { id: 'stackdock.settings.open.terminal', label: 'Open Settings: Terminal profiles', keybind: settings?.keybinds['stackdock.settings.open.terminal'], run: () => openSettings('terminal') },
    { id: 'stackdock.settings.open.extensions', label: 'Open Settings: Extensions', keybind: settings?.keybinds['stackdock.settings.open.extensions'], run: () => openSettings('extensions') },
    { id: 'stackdock.settings.open.workspace', label: 'Open Settings: Workspace', keybind: settings?.keybinds['stackdock.settings.open.workspace'], run: () => openSettings('workspace') },
    { id: 'stackdock.settings.open.keybinds', label: 'Open Settings: Keybinds', keybind: settings?.keybinds['stackdock.settings.open.keybinds'], run: () => openSettings('keybinds') },
  ];
  const launchSupportActions: CommandAction[] = [
    { id: 'stackdock.diagnostics.export', label: 'StackDock: Export Diagnostics', description: 'Create a redacted local diagnostics bundle', run: exportDiagnosticsAction },
    { id: 'stackdock.logs.open', label: 'StackDock: Open Logs Folder', description: 'Open local app logs', run: openLogsFolderAction },
    { id: 'stackdock.releaseNotes.show', label: 'StackDock: Show Release Notes', description: launchInfo ? `Version ${launchInfo.releaseNotesVersion}` : undefined, run: () => setReleaseNotesOpen(true) },
    { id: 'stackdock.safeMode.enable', label: 'StackDock: Enable Safe Mode', description: 'Disable local extensions for the next launch after backing up settings', run: enableSafeModeAction },
    { id: 'stackdock.settings.backup', label: 'StackDock: Export Settings Backup', description: 'Copy current settings to the backups folder', run: exportSettingsBackupAction },
    { id: 'stackdock.settings.reset', label: 'StackDock: Reset Settings', description: 'Restore default app settings', run: resetSettingsAction },
    { id: 'stackdock.layout.reset', label: 'StackDock: Reset Workspace Layout', description: 'Reset panels and saved tabs for this workspace', run: resetWorkspaceLayoutAction },
  ];
  const launcherActions: CommandAction[] = [
    // User-defined commands first so they're front-and-center in the palette.
    ...(workspaceSetup?.commands ?? []).map((command) => ({ id: `ws:${command.id}`, label: command.label, description: command.command, keybind: command.keybind, run: () => runPaletteCommand(command) })),
    ...(automation?.commands ?? []).map((command) => ({ id: `global:${command.id}`, label: command.label, description: command.command, keybind: command.keybind, run: () => runPaletteCommand(command) })),
    { id: 'stackdock.terminal.new', label: 'New Terminal', keybind: settings?.keybinds['stackdock.terminal.new'], run: () => createTerminal(undefined, 'Terminal', '') },
    ...workspaceLauncherActions,
    ...extensionCommands.map((command) => ({ ...command, keybind: settings?.keybinds[command.id] })),
    ...statusBarCommands,
    { id: 'stackdock.view.toggleTerminal', label: 'Show/Toggle Terminal', keybind: settings?.keybinds['stackdock.view.toggleTerminal'], run: toggleMainView },
    { id: 'stackdock.view.toggleSidebar', label: 'Toggle Sidebar', keybind: settings?.keybinds['stackdock.view.toggleSidebar'], run: toggleActivitySidebar },
    { id: 'stackdock.tab.closeActive', label: 'Close Active Tab', keybind: settings?.keybinds['stackdock.tab.closeActive'], run: () => { if (mainView === 'web' && activeWebId) closeLink(activeWebId); else if (activeFilePath) void closeFile(activeFilePath, activeEditors.activeEditorGroup); } },
    ...(activeTerminalId ? [
      { id: 'stackdock.terminal.reloadView', label: 'Terminal: Reload View', description: 'Recreate the visible terminal renderer from the latest snapshot', run: () => reloadTerminalView(activeTerminalId) },
      { id: 'stackdock.terminal.checkHealth', label: 'Terminal: Check Health', description: 'Verify the active terminal snapshot and reload the view', run: () => checkTerminalHealth(activeTerminalId) },
      { id: 'stackdock.terminal.restartPreserveSnapshot', label: 'Terminal: Restart Preserving Snapshot', description: 'Restart the terminal while keeping its restore buffer', run: () => restartTerminal(activeTerminalId) },
      { id: 'stackdock.terminal.killFrozen', label: 'Terminal: Kill Frozen Terminal', description: 'Force-close the active terminal and discard its snapshot', run: () => killFrozenTerminal(activeTerminalId) },
      { id: 'stackdock.terminal.openExternal', label: 'Terminal: Open in External Terminal', description: 'Open a system terminal in this session working directory', run: () => openActiveExternalTerminal(activeTerminalId) },
      { id: 'restart-terminal', label: 'Restart Terminal', run: () => restartTerminal(activeTerminalId) },
      { id: 'close-terminal', label: 'Close Terminal', run: () => closeTerminal(activeTerminalId) },
    ] : []),
    ...settingsActions,
    ...launchSupportActions,
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
  const persistentSessionCache = settings?.terminal.persistentSessionCache !== false;
  const visibleSessionIdSet = new Set(visibleSessionPanes.map((session) => session.id));
  const visibleTerminalIds = visibleSessionPanes.map((session) => session.id);
  const visibleTerminalKey = visibleTerminalIds.join('\0');
  const [mountedTerminalSessionIds, setMountedTerminalSessionIds] = useState<string[]>([]);

  useEffect(() => {
    void api.terminal.setVisible(visibleTerminalIds);
    return () => { void api.terminal.setVisible([]); };
  }, [visibleTerminalKey]);

  useEffect(() => {
    const liveIds = new Set(sessions.map((session) => session.id));
    setMountedTerminalSessionIds((current) => {
      const next = persistentSessionCache ? current.filter((id) => liveIds.has(id)) : [];
      for (const id of visibleTerminalIds) if (!next.includes(id)) next.push(id);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [persistentSessionCache, sessions, visibleTerminalKey]);

  function startTerminalTabDrag(event: DragEvent<HTMLDivElement>, sessionId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(SESSION_DRAG_MIME, sessionId);
  }

  function startFileTabDrag(event: DragEvent<HTMLDivElement>, sessionId: string, groupId: string, path: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(FILE_TAB_DRAG_MIME, JSON.stringify({ sessionId, groupId, path }));
  }

  function renderSessionMainPane(session: WorkspaceTerminalSession, isPaneVisible = true) {
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
      <div key={session.id} className={`workspace-main-area main-tabbed session-pane${session.id === activeTerminalId ? ' active' : ''}`} style={{ display: isPaneVisible ? 'flex' : 'none' }} onMouseDown={() => sessionStore.setActiveSession(session.id)}>
        {paneContentTabCount > 0 ? (
          <div className="editor-tabbar main-tabbar">
            <div className="tab-strip">
              <div className={`tab main-terminal-tab${paneMainView === 'terminal' ? ' active' : ''}`} title="Terminal" draggable onDragStart={(event) => startTerminalTabDrag(event, session.id)} onClick={() => showTerminalFor(session.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); sessionStore.setActiveSession(session.id); setTerminalTabMenu({ sessionId: session.id, x: event.clientX, y: event.clientY }); }}>
                <span className="tab-name">Terminal</span>
              </div>
              {paneEditorGroup.openFiles.map((file) => (
                <div key={`${session.id}:${paneEditorGroup.id}:${file.path}`} className={`tab${paneMainView === 'editor' && file.path === paneActiveFilePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}`} title={file.path} draggable onDragStart={(event) => startFileTabDrag(event, session.id, paneEditorGroup.id, file.path)} onClick={() => selectFileFor(session.id, file.path, paneEditorGroup.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); sessionStore.setActiveSession(session.id); setTabMenu({ sessionId: session.id, file, groupId: paneEditorGroup.id, x: event.clientX, y: event.clientY }); }} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); void closeFileFor(session.id, file.path, paneEditorGroup.id); } }}>
                  <span className="tab-name">{file.name}{file.dirty ? '*' : ''}</span>
                  <span className="tab-close" draggable={false} onClick={(event) => { event.stopPropagation(); void closeFileFor(session.id, file.path, paneEditorGroup.id); }}><span className="dot">●</span><span className="x">×</span></span>
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
        {terminalTabMenu?.sessionId === session.id ? (
          <div className="context-menu tab-context-menu" style={{ top: terminalTabMenu.y, left: terminalTabMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
            <button className="context-menu-item" onClick={() => { void splitTerminal(session.id, 'left'); setTerminalTabMenu(null); }}>Split Left</button>
            <button className="context-menu-item" onClick={() => { void splitTerminal(session.id, 'right'); setTerminalTabMenu(null); }}>Split Right</button>
            <button className="context-menu-item" onClick={() => { void splitTerminal(session.id, 'up'); setTerminalTabMenu(null); }}>Split Up</button>
            <button className="context-menu-item" onClick={() => { void splitTerminal(session.id, 'down'); setTerminalTabMenu(null); }}>Split Down</button>
            <button className="context-menu-item" onClick={() => { void closeTerminal(session.id); setTerminalTabMenu(null); }}>Close</button>
            <button className="context-menu-item" disabled={paneContentTabCount === 0} onClick={() => { void closeAllContentTabsFor(session.id); setTerminalTabMenu(null); }}>Close Others</button>
          </div>
        ) : null}
        {tabMenu?.sessionId === session.id ? (
          <div className="context-menu tab-context-menu" style={{ top: tabMenu.y, left: tabMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
            <button className="context-menu-item" onClick={() => { void splitFileTabFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId, 'left'); setTabMenu(null); }}>Split Left</button>
            <button className="context-menu-item" onClick={() => { void splitFileTabFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId, 'right'); setTabMenu(null); }}>Split Right</button>
            <button className="context-menu-item" onClick={() => { void splitFileTabFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId, 'up'); setTabMenu(null); }}>Split Up</button>
            <button className="context-menu-item" onClick={() => { void splitFileTabFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId, 'down'); setTabMenu(null); }}>Split Down</button>
            <button className="context-menu-item" onClick={() => { void closeFileFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId); setTabMenu(null); }}>Close</button>
            <button className="context-menu-item" onClick={() => { void closeOthersFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId); setTabMenu(null); }}>Close Others</button>
            <button className="context-menu-item" onClick={() => { void closeToSideFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId, 'right'); setTabMenu(null); }}>Close to Right</button>
            <button className="context-menu-item" onClick={() => { void closeToSideFor(tabMenu.sessionId, tabMenu.file.path, tabMenu.groupId, 'left'); setTabMenu(null); }}>Close to Left</button>
          </div>
        ) : null}
        <div className="main-tab-content">
          <PanelGroup direction={paneWebSplit === 'up' || paneWebSplit === 'down' ? 'vertical' : 'horizontal'} className="web-split-group">
            {paneWebSplit === 'left' || paneWebSplit === 'up' ? paneWebPane : null}
            <Panel key="primary" id={`main-primary-${session.id}`} order={paneWebSplit === 'left' || paneWebSplit === 'up' ? 2 : 1} minSize={20}>
              <div className="main-tab-pane" style={{ display: panePrimaryView === 'terminal' ? 'flex' : 'none' }}>
                <TerminalPanel key={`${session.id}:${terminalReloadTokens[session.id] ?? 0}`} sessions={[session]} activeId={session.id} onOpenLink={(url) => openLinkFor(session.id, url)} settings={settings} isVisible={isPaneVisible && panePrimaryView === 'terminal'} onAttachmentError={(message) => showToast(message, 'error')} renderSmartInputActions={renderTerminalSmartInputActions} />
                {isPaneVisible && panePrimaryView === 'terminal' ? <div className="terminal-overlay-host">{renderTerminalOverlays(session)}</div> : null}
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
            {visibleEditorDiff && !visibleEditorDiff.untracked ? (
              <div className="diff-mode-control" role="group" aria-label="Editor diff display mode">
                <button className={diffMode === 'inline' ? 'active-toggle' : ''} onClick={() => setDiffMode('inline')}>Inline</button>
                <button className={diffMode === 'side-by-side' ? 'active-toggle' : ''} onClick={() => setDiffMode('side-by-side')}>Side by side</button>
                <button className={diffMode === 'compare-only' ? 'active-toggle' : ''} onClick={() => setDiffMode('compare-only')}>Compare only</button>
              </div>
            ) : null}
            <button className="topbar-icon-btn" onClick={() => { setSettingsInitialTab('general'); setSettingsOpen(true); }} title="Settings" aria-label="Settings"><SettingsIcon /></button>
            <button className="topbar-icon-btn" onClick={() => void api.shell.openPath(workspace.path)} title="Open Folder" aria-label="Open Folder"><FolderOpenIcon /></button>
          </div>
          <span className="topbar-divider topbar-window-divider" aria-hidden />
          <WindowControls />
        </div>
      </header>

      {!workspaceTrusted ? (
        <div className="workspace-trust-banner" role="status">
          <div>
            <strong>Untrusted workspace</strong>
            <span>Terminals, automation, git mutations, and workspace startup commands are blocked until you trust this folder.</span>
          </div>
          <button className="primary" onClick={() => void trustWorkspace()}>Trust workspace</button>
        </div>
      ) : null}
      {launchInfo?.safeMode ? (
        <div className="workspace-trust-banner" role="status">
          <div>
            <strong>Safe Mode active</strong>
            <span>Local extension packages are disabled for this launch.</span>
          </div>
          <button className="ghost" onClick={() => openSettings('extensions')}>Extensions</button>
        </div>
      ) : null}

      <PanelGroup key={`${sessionsVisible ? 'sessions' : 'no-sessions'}-${sidebarVisible ? 'with-sidebar' : 'without-sidebar'}`} direction="horizontal" className="workspace-body with-global-sessions" onLayout={(sizes) => { let i = 0; const next: NonNullable<WorkspaceLayout['panels']['panelSizes']> = {}; if (sessionsVisible) next.sessions = sizes[i++]; if (sidebarVisible) next.explorer = sizes[i++]; next.main = sizes[i++]; updatePanelSizes(next); }}>
        {sessionsVisible ? (
          <>
            <Panel id="sessions" order={1} defaultSize={safePanelSizes.sessions} minSize={4} className="global-sessions-panel">
              {renderViewStack(sessionContributions, 'sessions')}
            </Panel>
            <PanelResizeHandle id="sessions-resize" className="resize-handle vertical" />
          </>
        ) : null}
        {sidebarVisible ? (
          <>
            <Panel id="activity-sidebar" order={2} defaultSize={safePanelSizes.explorer} minSize={4} className="workspace-explorer">
              {renderViewStack(visibleActivityContributions, 'activity')}
            </Panel>
            <PanelResizeHandle id="explorer-resize" className="resize-handle vertical" />
          </>
        ) : null}
        <Panel id="main" order={3} defaultSize={safePanelSizes.main} minSize={30}>
          <div
            className="session-split-host"
            onDragOver={(event) => {
              const types = Array.from(event.dataTransfer.types);
              const kind = types.includes(SESSION_DRAG_MIME) ? 'terminal' : types.includes(FILE_TAB_DRAG_MIME) ? 'file' : null;
              if (!kind) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setTabDrop({ side: getDropSide(event, event.currentTarget), kind });
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTabDrop(null); }}
            onDrop={(event) => {
              const types = Array.from(event.dataTransfer.types);
              const isTerminalDrop = types.includes(SESSION_DRAG_MIME);
              const isFileDrop = types.includes(FILE_TAB_DRAG_MIME);
              if (!isTerminalDrop && !isFileDrop) return;
              event.preventDefault();
              const side = tabDrop?.side ?? getDropSide(event, event.currentTarget);
              setTabDrop(null);
              if (isTerminalDrop) {
                const id = event.dataTransfer.getData(SESSION_DRAG_MIME);
                if (id) void splitTerminal(id, side);
                return;
              }
              try {
                const payload = JSON.parse(event.dataTransfer.getData(FILE_TAB_DRAG_MIME)) as { sessionId?: unknown; groupId?: unknown; path?: unknown };
                if (typeof payload.sessionId === 'string' && typeof payload.groupId === 'string' && typeof payload.path === 'string') {
                  void splitFileTabFor(payload.sessionId, payload.path, payload.groupId, side);
                }
              } catch {
                // Ignore malformed drag payloads from outside StackDock.
              }
            }}
          >
            {visibleSessionPanes.length > 1 ? (
              <>
                <PanelGroup direction={sessionSplitDirection === 'column' ? 'vertical' : 'horizontal'} className="session-pane-group">
                  {visibleSessionPanes.flatMap((session, index) => [
                    <Panel key={session.id} id={`session-pane-${session.id}`} minSize={20}>
                      {renderSessionMainPane(session, true)}
                    </Panel>,
                    index < visibleSessionPanes.length - 1 ? <PanelResizeHandle key={`${session.id}:resize`} className={`session-pane-resize resize-handle ${sessionSplitDirection === 'column' ? 'horizontal' : 'vertical'}`} /> : null,
                  ])}
                </PanelGroup>
                {persistentSessionCache ? sessions.filter((session) => mountedTerminalSessionIds.includes(session.id) && !visibleSessionIdSet.has(session.id)).map((session) => <div key={`hidden-${session.id}`} className="persistent-session-cache-pane">{renderSessionMainPane(session, false)}</div>) : null}
              </>
            ) : visibleSessionPanes[0] ? (
              persistentSessionCache ? sessions.filter((session) => mountedTerminalSessionIds.includes(session.id)).map((session) => renderSessionMainPane(session, visibleSessionIdSet.has(session.id))) : renderSessionMainPane(visibleSessionPanes[0], true)
            ) : <div className="empty-pad muted">Open terminal from Sessions.</div>}
            {tabDrop ? <div className={`session-split-drop-overlay side-${tabDrop.side}`}>Split {tabDrop.side[0].toUpperCase() + tabDrop.side.slice(1)}</div> : null}
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
        onOpenFile={(path) => void openFile(path)}
        onClose={() => setSessionSwitcherOpen(false)}
      />
      {settingsOpen && settings ? <SettingsModal settings={settings} currentWorkspaceId={workspace.id} initialTab={settingsInitialTab} onSave={async (next) => { const saved = await api.settings.save(next); setSettings(saved); applyTheme(saved.themeId, saved.importedThemes); onSettingsApplied?.(saved); setProfiles(await api.terminal.profiles()); }} onAutomationSaved={(config) => setAutomation(config)} onRunCommand={(command) => void runPaletteCommand(command)} onClose={() => setSettingsOpen(false)} /> : null}
      {releaseNotesOpen ? <ReleaseNotesDialog launchInfo={launchInfo} onClose={() => setReleaseNotesOpen(false)} /> : null}
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
  const sessions = sessionsVisible ? clamp(panelSizes.sessions ?? 18, 4, 35) : 0;
  if (!sidebarVisible) return { sessions, explorer: panelSizes.explorer ?? 18, main: 100 - sessions };

  const maxExplorer = Math.max(4, 100 - sessions - 30);
  const explorer = clamp(panelSizes.explorer ?? 18, 4, maxExplorer);
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
      panelSizes: { sessions: 18, explorer: 18, main: 64, editor: 72, git: 28, upper: 62, terminal: 38 },
    },
    editors: { openFiles: [], activeFile: undefined },
    terminals: [],
  };
}
