export interface WorkspaceCommand {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  terminalName?: string;
  autoStart?: boolean;
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

export interface TerminalSession {
  id: string;
  name: string;
  profileId: string;
  cwd: string;
  startupCommand?: string;
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
  };
  workspaces: {
    list(): Promise<Workspace[]>;
    add(folderPath: string): Promise<Workspace>;
    update(workspace: Workspace): Promise<Workspace>;
    remove(id: string): Promise<void>;
    loadLayout(workspaceId: string): Promise<WorkspaceLayout | null>;
    saveLayout(layout: WorkspaceLayout): Promise<void>;
  };
  fs: {
    readDirectory(path: string): Promise<DirectoryEntry[]>;
    readFile(path: string): Promise<ReadFileResult>;
    writeFile(path: string, content: string): Promise<void>;
    createFile(path: string): Promise<void>;
    createFolder(path: string): Promise<void>;
    renamePath(oldPath: string, newPath: string): Promise<void>;
    deletePath(path: string): Promise<void>;
    revealInExplorer(path: string): Promise<void>;
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
