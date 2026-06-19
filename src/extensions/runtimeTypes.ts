import type { StackDockSettings, Workspace } from '../shared/types';

export interface ExtensionInvoke {
  invoke(command: string, ...args: unknown[]): Promise<unknown>;
}

export interface ExtensionRendererContext extends ExtensionInvoke {
  extensionId: string;
  workspace: Workspace;
  settings: StackDockSettings | null;
  actions: {
    openFile(path: string): void | Promise<void>;
    previewFile(path: string): void | Promise<void>;
    openTerminalHere(path: string): void | Promise<void>;
    addPathToContext(path: string): void | Promise<void>;
    closeDeletedPath(path: string): void | Promise<void>;
    openView(viewId: string): void;
    toggleView(viewId: string): void;
    revealFolder(path?: string): void | Promise<void>;
    selectSession(id: string): void;
    createSession(): void | Promise<void>;
  };
}

export interface ExtensionMainRpc {
  handle(command: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void;
}
