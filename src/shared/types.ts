export interface EditorThemeRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface StackDockTheme {
  id: string;
  label: string;
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: EditorThemeRule[];
  /** Raw VS Code workbench colors used to drive both Monaco and StackDock UI CSS variables. */
  colors?: Record<string, string>;
}

/** @deprecated Use StackDockTheme. */
export type ImportedEditorTheme = StackDockTheme;

export type ExtensionContributionLocation = 'activity' | 'sessions' | 'statusBar' | 'bottomBar';
export type ExtensionSource = 'bundled' | 'local';
export interface ExtensionViewContribution { id: string; extensionId: string; title: string; icon?: string; location: Exclude<ExtensionContributionLocation, 'statusBar'>; order?: number; native?: boolean; entry?: string; when?: 'always' | 'gitRepo' | 'headlessActive'; }
export interface ExtensionStatusBarContribution { id: string; extensionId: string; side: 'left' | 'right'; order?: number; label?: string; tooltip?: string; entry?: string; native?: boolean; when?: 'always' | 'gitRepo'; popoverWidth?: number; popoverHeight?: number; }
export type ExtensionConfigPrimitive = string | number | boolean;
export interface ExtensionConfigField { key: string; label: string; type: 'boolean' | 'number' | 'text' | 'select'; description?: string; default?: ExtensionConfigPrimitive; min?: number; max?: number; step?: number; options?: { label: string; value: string }[]; }
export interface ExtensionConfigurationContribution { title?: string; fields: ExtensionConfigField[]; }
export type TerminalCommandHookSource = 'interactive' | 'startup' | 'resume' | 'headless' | 'programmatic';
export interface ExtensionTerminalCommandHookContribution { id: string; match: string; sources?: TerminalCommandHookSource[]; appendArgs: string; description?: string; }
export interface ExtensionManifest { id: string; name: string; version: string; description?: string; defaultEnabled?: boolean; source?: ExtensionSource; packagePath?: string; capabilities?: string[]; main?: string; renderer?: string; contributes?: { views?: ExtensionViewContribution[]; statusBar?: ExtensionStatusBarContribution[]; configuration?: ExtensionConfigurationContribution; terminalCommandHooks?: ExtensionTerminalCommandHookContribution[] }; }
export interface ExtensionLoadError { extensionId?: string; packagePath?: string; message: string; }
export interface ExtensionListResult { extensions: ExtensionManifest[]; errors: ExtensionLoadError[]; }
export interface ExtensionSettings { localPackagePaths: string[]; disabled: string[]; enabled: string[]; config: Record<string, Record<string, ExtensionConfigPrimitive>>; }
export interface WorkspaceExtensionState { enabled?: string[]; disabled?: string[]; activeActivityViewId?: string; activeBottomViewId?: string; panelSizesByViewId?: Record<string, number>; visibleViewIds?: string[]; }
export interface WorkspaceViewState { sessionsVisible: boolean; visibleActivityViewIds: string[]; }

export type KeybindMap = Record<string, string>;

export interface StackDockSettings {
  /** Unified app + Monaco theme id. */
  themeId: string;
  /** User-imported VS Code JSON/JSONC themes. */
  importedThemes: StackDockTheme[];
  /** @deprecated Migrated from the old app-shell theme option. */
  theme?: 'dark' | 'system';
  defaultTerminalProfileId?: string;
  confirmBeforeDiscard: boolean;
  emptySessionsVisible: boolean;
  showSessionCwdForAll: boolean;
  gitRefreshIntervalSeconds: number;
  autoSave: boolean;
  autoSaveDelayMs: number;
  /** When true, clicking a terminal link opens the system browser instead of an in-app web tab. */
  openLinksExternally: boolean;
  /** Inject BROWSER/PLANNOTATOR_BROWSER into new terminals so CLI tools open pages as in-app web tabs. */
  captureTerminalBrowserOpens: boolean;
  /** How captured pages open: plain tab, or tab + split of the main area. */
  capturedLinkOpenMode: 'tab' | 'split-right' | 'split-left' | 'split-up' | 'split-down';
  ui: { fontFamily: string; fontSize: number };
  code: { ligatures: boolean };
  editor: { fontSize: number; fontFamily: string; tabSize: number; wordWrap: 'on' | 'off'; /** @deprecated Use StackDockSettings.themeId. */ themeId?: string; /** @deprecated Use StackDockSettings.importedThemes. */ importedThemes?: StackDockTheme[] };
  terminal: { fontSize: number; fontFamily: string; cursorBlink: boolean; startAtBottom: boolean; markdownFormatting: boolean; persistentSessionCache?: boolean };
  terminalProfiles: TerminalProfile[];
  extensions: ExtensionSettings;
  workspaceViewState: WorkspaceViewState;
  keybinds: KeybindMap;
}

/** @deprecated Superseded by PaletteCommand (stored in automation.json). Kept so old workspaces.json still type-checks; no longer written or surfaced. */
export interface WorkspaceCommand {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  terminalName?: string;
  autoStart?: boolean;
}

/** A user-defined command that runs a shell command in a terminal. Used for both global and per-workspace commands. */
export interface PaletteCommand {
  id: string;
  label: string;
  command: string;
  keybind?: string;
  cwd?: string;
  /** Run hidden, notify with final output, then close. */
  headless?: boolean;
  /** Per-workspace: name given to the terminal the command spawns. */
  terminalName?: string;
  /** Per-workspace: run automatically when the workspace opens. */
  autoStart?: boolean;
}

/** Per-workspace automation: applied when terminals are created for that workspace. */
export interface WorkspaceSetup {
  defaultTerminalProfile?: string;
  newSessionCommand?: string;
  commands?: PaletteCommand[];
}

/** Hand-editable automation.json: global palette commands + per-workspace setups. */
export interface AutomationConfig {
  commands: PaletteCommand[];
  workspaces: Record<string, WorkspaceSetup>;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt?: string;
  pinned?: boolean;
  trusted?: boolean;
  commands?: WorkspaceCommand[];
}

export interface AppRestoreState {
  lastWorkspaceId?: string;
  lastTerminalRestoreId?: string;
  lastTerminalRuntimeId?: string;
}

export interface LaunchInfo {
  version: string;
  releaseNotesVersion: string;
  safeMode: boolean;
  dataPath: string;
  logsPath: string;
}

export interface ReleaseNotesState {
  version: string;
  seen: boolean;
}

export interface LaunchDiagnosticExportOptions {
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  redactPaths?: boolean;
}

export interface WorkspaceLayout {
  workspaceId: string;
  activeTerminalRestoreId?: string;
  activeTerminalRuntimeId?: string;
  panels: {
    fileTreeWidth: number;
    gitPanelWidth: number;
    terminalHeight: number;
    fileTreeVisible: boolean;
    gitPanelVisible: boolean;
    terminalVisible: boolean;
    sessionsVisible?: boolean;
    panelSizes?: {
      sessions?: number;
      explorer?: number;
      main?: number;
      editor?: number;
      git?: number;
      upper?: number;
      terminal?: number;
      sessionsUpper?: number;
      headless?: number;
    };
  };
  editors: {
    openFiles: string[];
    activeFile?: string;
    groups?: { openFiles: string[]; activeFile?: string }[];
    activeGroupIndex?: number;
    splitOrientation?: 'horizontal' | 'vertical';
  };
  terminals: TerminalSession[];
  extensions?: WorkspaceExtensionState;
}

export interface TerminalProfile {
  id: string;
  name: string;
  shell: string;
  args: string[];
  startupCommand?: string;
}

export interface TerminalResumeState {
  integrationId: string;
  sessionId?: string;
  resumeCommand?: string;
  storagePath?: string;
}

export interface WorkspaceTerminalSession extends TerminalSession {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
}

export type TerminalSplitDirection = 'row' | 'column';
export type TerminalSplitSide = 'left' | 'right' | 'up' | 'down';

export interface TerminalSessionUpdate {
  name?: string;
  splitGroupId?: string | null;
  splitDirection?: TerminalSplitDirection | null;
  splitGroupOrder?: number | null;
}

export interface HeadlessCommandRun {
  id: string;
  restoreId?: string;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  label: string;
  command: string;
  cwd: string;
  startedAt: number;
  completedAt?: number;
  output: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

export interface TerminalSessionContext {
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  headless?: boolean;
  commandLabel?: string;
}

export interface TerminalPersistedTab extends TerminalSession {
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  lastActiveAt?: string;
  resumeStartupCommand?: string;
}

export interface TerminalPersistedState {
  version: 1;
  savedAt: string;
  tabs: TerminalPersistedTab[];
}

export interface TerminalSession {
  id: string;
  restoreId?: string;
  name: string;
  profileId: string;
  cwd: string;
  startupCommand?: string;
  originalStartupCommand?: string;
  resumeState?: TerminalResumeState;
  restoredFromSnapshot?: boolean;
  splitGroupId?: string;
  splitDirection?: TerminalSplitDirection;
  splitGroupOrder?: number;
  createdAt: string;
}

export interface TerminalSnapshot {
  id: string;
  restoreId?: string;
  output: string;
  updatedAt?: string;
  resumeState?: TerminalResumeState;
}

export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  conflictStatus?: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  branches?: string[];
  ahead?: number;
  behind?: number;
  operation?: 'merge' | 'rebase' | 'cherry-pick';
  conflicts?: number;
  mergeReady?: boolean;
  remoteErrorKind?: 'auth' | 'terminal-required' | 'other';
  files: GitFileStatus[];
}

export interface GitFileContents {
  path: string;
  original: string;
  modified: string;
  binary?: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  hidden: boolean;
}

export type TerminalAttachmentSource = 'drop' | 'paste-file' | 'paste-image';

export interface TerminalAttachment {
  id: string;
  source: TerminalAttachmentSource;
  path: string;
  referencePath: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  isDirectory: boolean;
  isImage: boolean;
  isLarge: boolean;
  originalPath?: string;
}

export interface TerminalAttachmentOptions {
  /** Files larger than this are represented by their parent directory. */
  largeFileThresholdBytes?: number;
}

export interface ReadFileResult {
  path: string;
  content: string;
}

export interface ReadFileDataUrlResult {
  path: string;
  dataUrl: string;
  mimeType: string;
}

export type WindowControlsStyle = 'native' | 'custom';
export type WindowPlatform = 'windows' | 'macos' | 'linux' | 'other';
export type WindowControlsPosition = 'left' | 'right';
export type WindowControlsVariant = 'windows' | 'macos';

export interface WindowControlsConfig {
  platform: WindowPlatform;
  style: WindowControlsStyle;
  position: WindowControlsPosition;
  variant: WindowControlsVariant;
}

export interface WindowTitleBarOverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

export interface StackDockApi {
  app: {
    pickWorkspaceFolder(): Promise<string | null>;
    importJsonFile(): Promise<{ path: string; content: string } | null>;
    getLaunchInfo(): Promise<LaunchInfo>;
    getReleaseNotesState(): Promise<ReleaseNotesState>;
    markReleaseNotesSeen(version?: string): Promise<ReleaseNotesState>;
    exportDiagnostics(options?: LaunchDiagnosticExportOptions): Promise<{ path: string }>;
    exportSettingsBackup(): Promise<{ path: string }>;
    resetSettings(): Promise<StackDockSettings>;
    resetWorkspaceLayout(workspaceId: string): Promise<void>;
    enableSafeMode(): Promise<{ backupPath: string }>;
    openLogsFolder(): Promise<void>;
    openExternalTerminal(cwd: string): Promise<void>;
    minimizeWindow(): Promise<void>;
    toggleMaximizeWindow(): Promise<boolean>;
    closeWindow(): Promise<void>;
    isWindowMaximized(): Promise<boolean>;
    windowControlsStyle(): Promise<WindowControlsStyle>;
    windowControlsConfig(): Promise<WindowControlsConfig>;
    setTitleBarOverlay(options: WindowTitleBarOverlayOptions): Promise<void>;
    loadRestoreState(): Promise<AppRestoreState>;
    saveRestoreState(state: AppRestoreState): Promise<AppRestoreState>;
  };
  workspaces: {
    list(): Promise<Workspace[]>;
    add(folderPath: string): Promise<Workspace>;
    create(parentPath: string, name: string): Promise<Workspace>;
    update(workspace: Workspace): Promise<Workspace>;
    remove(id: string): Promise<void>;
    loadLayout(workspaceId: string): Promise<WorkspaceLayout | null>;
    saveLayout(layout: WorkspaceLayout): Promise<void>;
  };
  fs: {
    pathExists(path: string): Promise<boolean>;
    readDirectory(path: string): Promise<DirectoryEntry[]>;
    readFile(path: string): Promise<ReadFileResult>;
    readFileDataUrl(path: string): Promise<ReadFileDataUrlResult>;
    watchWorkspace(path: string): Promise<void>;
    writeFile(path: string, content: string): Promise<void>;
    createFile(path: string): Promise<void>;
    createFolder(path: string): Promise<void>;
    renamePath(oldPath: string, newPath: string): Promise<void>;
    deletePath(path: string): Promise<void>;
    revealInExplorer(path: string): Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    openPath(targetPath: string): Promise<void>;
  };
  git: {
    status(path: string): Promise<GitStatus>;
    branches(path: string): Promise<string[]>;
    diff(path: string, filePath?: string, staged?: boolean): Promise<string>;
    fileContents(path: string, filePath: string, staged?: boolean): Promise<GitFileContents>;
    stage(path: string, filePath: string): Promise<void>;
    unstage(path: string, filePath: string): Promise<void>;
    discard(path: string, filePath: string): Promise<void>;
    ignore(path: string, filePath: string): Promise<void>;
    commit(path: string, message: string): Promise<void>;
    addAll(path: string): Promise<void>;
    switchBranch(path: string, branch: string): Promise<void>;
    push(path: string): Promise<void>;
    pull(path: string): Promise<void>;
    pullMerge(path: string): Promise<void>;
    abortMerge(path: string): Promise<void>;
    fetch(path: string): Promise<void>;
    ignored(path: string, paths: string[]): Promise<string[]>;
  };
  settings: {
    load(): Promise<StackDockSettings>;
    defaults(): Promise<StackDockSettings>;
    save(settings: StackDockSettings): Promise<StackDockSettings>;
  };
  automation: {
    load(): Promise<AutomationConfig>;
    loadRaw(): Promise<string>;
    saveRaw(content: string): Promise<AutomationConfig>;
  };
  extensions: {
    list(): Promise<ExtensionListResult>;
    reload(): Promise<ExtensionListResult>;
    addLocalPackage(path: string): Promise<ExtensionListResult>;
    removeLocalPackage(path: string): Promise<ExtensionListResult>;
    invoke(extensionId: string, command: string, args?: unknown[]): Promise<unknown>;
  };
  attachments: {
    getPathForFile(file: unknown): string;
    hasClipboardImage(): boolean;
    hasClipboardText(): boolean;
    readClipboardText(): string;
    writeClipboardText(text: string): void;
    inspectPath(path: string, source: TerminalAttachmentSource, options?: TerminalAttachmentOptions): Promise<TerminalAttachment>;
    savePastedImage(dataUrl: string, name?: string, options?: TerminalAttachmentOptions): Promise<TerminalAttachment>;
    saveClipboardImage(name?: string, options?: TerminalAttachmentOptions): Promise<TerminalAttachment | null>;
  };
  terminal: {
    profiles(): Promise<TerminalProfile[]>;
    create(profileId: string, cwd: string, name?: string, startupCommand?: string, restoreId?: string, context?: TerminalSessionContext): Promise<TerminalSession>;
    update(id: string, patch: TerminalSessionUpdate): Promise<TerminalSession>;
    restoreState(): Promise<TerminalPersistedState | null>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    ready(id: string): Promise<void>;
    setVisible(ids: string[]): Promise<void>;
    kill(id: string, preserveSnapshot?: boolean): Promise<void>;
    snapshot(idOrRestoreId: string): Promise<TerminalSnapshot | null>;
    forgetSnapshot(idOrRestoreId: string): Promise<void>;
  };
  onTerminalData(callback: (payload: { id: string; data: string }) => void): () => void;
  onTerminalHeadlessData(callback: (payload: { id: string; data: string }) => void): () => void;
  onTerminalExit(callback: (payload: { id: string; exitCode: number | null }) => void): () => void;
  onTerminalHeadlessResult(callback: (payload: { id: string; label?: string; command: string; output: string; exitCode: number | null; timedOut?: boolean }) => void): () => void;
  onWorkspaceChanged(callback: () => void): () => void;
  onFileSystemChanged(callback: (payload: { rootPath: string }) => void): () => void;
  onOpenUrlRequest(callback: (payload: { url: string; sessionId?: string }) => void): () => void;
}

declare global {
  interface Window {
    stackdock: StackDockApi;
  }
}

export {};
