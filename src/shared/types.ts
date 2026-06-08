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
  editor: { fontSize: number; fontFamily: string; tabSize: number; wordWrap: 'on' | 'off'; /** @deprecated Use StackDockSettings.themeId. */ themeId?: string; /** @deprecated Use StackDockSettings.importedThemes. */ importedThemes?: StackDockTheme[] };
  terminal: { fontSize: number; fontFamily: string; cursorBlink: boolean };
  terminalProfiles: TerminalProfile[];
}

export interface WorkspaceCommand {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  terminalName?: string;
  autoStart?: boolean;
}

/** A user-defined command-palette entry that runs a shell command in a terminal. */
export interface PaletteCommand {
  id: string;
  label: string;
  command: string;
  cwd?: string;
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

export interface WorkspaceLayout {
  workspaceId: string;
  panels: {
    fileTreeWidth: number;
    gitPanelWidth: number;
    terminalHeight: number;
    fileTreeVisible: boolean;
    gitPanelVisible: boolean;
    terminalVisible: boolean;
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

export interface TerminalSession {
  id: string;
  name: string;
  profileId: string;
  cwd: string;
  startupCommand?: string;
  splitGroupId?: string;
  splitDirection?: 'row' | 'column';
  createdAt: string;
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

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  hidden: boolean;
}

export interface ReadFileResult {
  path: string;
  content: string;
}

export interface StackDockApi {
  app: {
    pickWorkspaceFolder(): Promise<string | null>;
    importJsonFile(): Promise<{ path: string; content: string } | null>;
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
  terminal: {
    profiles(): Promise<TerminalProfile[]>;
    create(profileId: string, cwd: string, name?: string, startupCommand?: string): Promise<TerminalSession>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
  };
  onTerminalData(callback: (payload: { id: string; data: string }) => void): () => void;
  onTerminalExit(callback: (payload: { id: string; exitCode: number | null }) => void): () => void;
  onWorkspaceChanged(callback: () => void): () => void;
}

declare global {
  interface Window {
    stackdock: StackDockApi;
  }
}

export {};
