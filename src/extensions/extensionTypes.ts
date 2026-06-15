import type { MouseEvent, ReactNode } from 'react';
import type { ExtensionConfigPrimitive, ExtensionManifest, ExtensionStatusBarContribution, ExtensionViewContribution, GitFileStatus, GitStatus, HeadlessCommandRun, StackDockSettings, TerminalProfile, Workspace, WorkspaceTerminalSession } from '../shared/types';

export interface ExtensionCommand {
  id: string;
  label: string;
  description?: string;
  run(): void | Promise<void>;
  prompt?: { placeholder: string; run(value: string): void | Promise<void>; };
}

export interface WorkspaceExtensionContext {
  workspace: Workspace;
  settings: StackDockSettings | null;
  git: GitStatus | null;
  sessions: WorkspaceTerminalSession[];
  allSessions: WorkspaceTerminalSession[];
  activeSessionId: string | null;
  headlessRuns: HeadlessCommandRun[];
  isRepo: boolean;
  refreshToken: number;
  actions: {
    openFile(path: string): void | Promise<void>;
    previewFile(path: string): void | Promise<void>;
    openTerminalHere(path: string): void | Promise<void>;
    openView(viewId: string): void;
    toggleView(viewId: string): void;
    openGit(): void;
    refreshGit(): void | Promise<void>;
    revealFolder(path?: string): void | Promise<void>;
    selectSession(id: string): void;
    createSession(): void | Promise<void>;
  };
  workspaces: Workspace[];
  profiles: TerminalProfile[];
  defaultProfileId?: string;
  gitActions: {
    error: string | null;
    selectedFile: GitFileStatus | null;
    selectedStagedPaths: string[];
    selectedChangePaths: string[];
    selectFile(file: GitFileStatus, staged: boolean, event?: MouseEvent<HTMLButtonElement>, groupFiles?: GitFileStatus[]): void | Promise<void>;
    stage(path: string): void | Promise<void>;
    stageSelected(paths: string[]): void | Promise<void>;
    stageAll(): void | Promise<void>;
    unstage(path: string): void | Promise<void>;
    unstageSelected(paths: string[]): void | Promise<void>;
    discard(path: string): void | Promise<void>;
    discardSelected(paths: string[]): void | Promise<void>;
    commit(message: string): void | Promise<void>;
    commitStaged(message: string): void | Promise<void>;
    stageAllAndCommit(message: string): void | Promise<void>;
    switchBranch(branch: string): void | Promise<void>;
    fetch(): void | Promise<void>;
    pull(): void | Promise<void>;
    push(): void | Promise<void>;
  };
  headlessActions: {
    terminate(id: string): void | Promise<void>;
    delete(id: string): void | Promise<void>;
    inspect(id: string): void;
    inspectRunId?: string | null;
  };
  sessionActions: {
    create(target: Workspace, profileId: string): Promise<void>;
    openWorkspace(id: string): void | Promise<void>;
    close(id: string): void | Promise<void>;
    rename(id: string, name: string): void | Promise<void>;
    restart(id: string): void | Promise<void>;
    duplicate(id: string): void | Promise<void>;
    setCwd(id: string, cwd: string): void | Promise<void>;
    split(id: string, direction: 'row' | 'column'): void | Promise<void>;
  };
}

export interface ExtensionSettingsContext {
  manifest: ExtensionManifest;
  settings: StackDockSettings;
  config: Record<string, ExtensionConfigPrimitive>;
  setConfig(patch: Record<string, ExtensionConfigPrimitive>): void;
}

export interface NativeExtension {
  manifest: ExtensionManifest;
  renderView?(contribution: ExtensionViewContribution, ctx: WorkspaceExtensionContext): ReactNode;
  renderStatusBar?(contribution: ExtensionStatusBarContribution, ctx: WorkspaceExtensionContext): ReactNode;
  renderSettings?(ctx: ExtensionSettingsContext): ReactNode;
  getCommands?(ctx: WorkspaceExtensionContext): ExtensionCommand[];
}
