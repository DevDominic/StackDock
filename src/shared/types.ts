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

export interface StackDockSettings {
  /** Unified app + Monaco theme id. */
  themeId: string;
  /** User-imported VS Code JSON/JSONC themes. */
  importedThemes: StackDockTheme[];
  /** @deprecated Migrated from the old app-shell theme option. */
  theme?: 'dark' | 'system';
  defaultTerminalProfileId?: string;
  confirmBeforeDiscard: boolean;
  showHiddenFiles: boolean;
  emptySessionsVisible: boolean;
  showSessionCwdForAll: boolean;
  gitRefreshIntervalSeconds: number;
  autoSave: boolean;
  autoSaveDelayMs: number;
  /** When true, clicking a terminal link opens the system browser instead of an in-app web tab. */
  openLinksExternally: boolean;
  ui: { fontFamily: string; fontSize: number };
  code: { ligatures: boolean };
  editor: { fontSize: number; fontFamily: string; tabSize: number; wordWrap: 'on' | 'off'; /** @deprecated Use StackDockSettings.themeId. */ themeId?: string; /** @deprecated Use StackDockSettings.importedThemes. */ importedThemes?: StackDockTheme[] };
  terminal: { fontSize: number; fontFamily: string; cursorBlink: boolean };
  terminalProfiles: TerminalProfile[];
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
  cwd?: string;
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
  commands?: WorkspaceCommand[];
}

export interface AppRestoreState {
  lastWorkspaceId?: string;
  lastTerminalRestoreId?: string;
  lastTerminalRuntimeId?: string;
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
}

export interface TerminalProfile {
  id: string;
  name: string;
  shell: string;
  args: string[];
}

export interface WorkspaceTerminalSession extends TerminalSession {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
}

export interface TerminalSessionContext {
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
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
  piSessionId?: string;
  piResumeCommand?: string;
  splitGroupId?: string;
  splitDirection?: 'row' | 'column';
  createdAt: string;
}

export interface TerminalSnapshot {
  id: string;
  restoreId?: string;
  output: string;
  updatedAt?: string;
  piSessionId?: string;
  piResumeCommand?: string;
}

export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  files: GitFileStatus[];
}

export interface GitFileContents {
  path: string;
  original: string;
  modified: string;
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

export interface WindowTitleBarOverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

export interface StackDockApi {
  app: {
    pickWorkspaceFolder(): Promise<string | null>;
    importJsonFile(): Promise<{ path: string; content: string } | null>;
    minimizeWindow(): Promise<void>;
    toggleMaximizeWindow(): Promise<boolean>;
    closeWindow(): Promise<void>;
    isWindowMaximized(): Promise<boolean>;
    windowControlsStyle(): Promise<WindowControlsStyle>;
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
    readDirectory(path: string, options?: { showHidden?: boolean }): Promise<DirectoryEntry[]>;
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
  };
  git: {
    status(path: string): Promise<GitStatus>;
    diff(path: string, filePath?: string, staged?: boolean): Promise<string>;
    fileContents(path: string, filePath: string, staged?: boolean): Promise<GitFileContents>;
    stage(path: string, filePath: string): Promise<void>;
    unstage(path: string, filePath: string): Promise<void>;
    discard(path: string, filePath: string): Promise<void>;
    commit(path: string, message: string): Promise<void>;
    addAll(path: string): Promise<void>;
  };
  settings: {
    load(): Promise<StackDockSettings>;
    save(settings: StackDockSettings): Promise<StackDockSettings>;
  };
  automation: {
    load(): Promise<AutomationConfig>;
    loadRaw(): Promise<string>;
    saveRaw(content: string): Promise<AutomationConfig>;
  };
  attachments: {
    getPathForFile(file: unknown): string;
    hasClipboardImage(): boolean;
    hasClipboardText(): boolean;
    inspectPath(path: string, source: TerminalAttachmentSource, options?: TerminalAttachmentOptions): Promise<TerminalAttachment>;
    savePastedImage(dataUrl: string, name?: string, options?: TerminalAttachmentOptions): Promise<TerminalAttachment>;
    saveClipboardImage(name?: string, options?: TerminalAttachmentOptions): Promise<TerminalAttachment | null>;
  };
  terminal: {
    profiles(): Promise<TerminalProfile[]>;
    create(profileId: string, cwd: string, name?: string, startupCommand?: string, restoreId?: string, context?: TerminalSessionContext): Promise<TerminalSession>;
    restoreState(): Promise<TerminalPersistedState | null>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    setVisible(ids: string[]): Promise<void>;
    kill(id: string): Promise<void>;
    snapshot(idOrRestoreId: string): Promise<TerminalSnapshot | null>;
    forgetSnapshot(idOrRestoreId: string): Promise<void>;
  };
  onTerminalData(callback: (payload: { id: string; data: string }) => void): () => void;
  onTerminalExit(callback: (payload: { id: string; exitCode: number | null }) => void): () => void;
  onWorkspaceChanged(callback: () => void): () => void;
  onFileSystemChanged(callback: (payload: { rootPath: string }) => void): () => void;
}

declare global {
  interface Window {
    stackdock: StackDockApi;
  }
}

export {};
