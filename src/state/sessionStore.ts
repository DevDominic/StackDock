import { create } from 'zustand';
import { api } from '../lib/api';
import type { WorkspaceTerminalSession } from '../shared/types';

interface CreateInput { workspaceId: string; workspaceName: string; workspacePath: string; profileId: string; cwd?: string; name?: string; startupCommand?: string; restoreId?: string; }
interface SessionState {
  sessions: WorkspaceTerminalSession[];
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  createSession(input: CreateInput): Promise<WorkspaceTerminalSession>;
  closeSession(id: string): Promise<void>;
  renameSession(id: string, name: string): void;
  replaceSession(id: string, next: WorkspaceTerminalSession): void;
  setActiveSession(id: string): void;
  setActiveWorkspace(id: string | null): void;
  getWorkspaceSessions(workspaceId: string): WorkspaceTerminalSession[];
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeWorkspaceId: null,
  async createSession(input) {
    const terminal = await api.terminal.create(input.profileId, input.cwd ?? input.workspacePath, input.name, input.startupCommand, input.restoreId);
    const session: WorkspaceTerminalSession = { ...terminal, workspaceId: input.workspaceId, workspaceName: input.workspaceName, workspacePath: input.workspacePath };
    set({ sessions: [...get().sessions, session], activeSessionId: session.id, activeWorkspaceId: session.workspaceId });
    void api.app.saveRestoreState({ lastWorkspaceId: session.workspaceId, lastTerminalRestoreId: session.restoreId, lastTerminalRuntimeId: session.id }).catch(() => undefined);
    return session;
  },
  async closeSession(id) {
    const closing = get().sessions.find((session) => session.id === id);
    await api.terminal.kill(id);
    if (closing?.restoreId) await api.terminal.forgetSnapshot(closing.restoreId).catch(() => undefined);
    const next = get().sessions.filter((session) => session.id !== id);
    set({ sessions: next, activeSessionId: get().activeSessionId === id ? next[0]?.id ?? null : get().activeSessionId });
  },
  renameSession(id, name) { set({ sessions: get().sessions.map((session) => session.id === id ? { ...session, name } : session) }); },
  replaceSession(id, next) {
    set({ sessions: get().sessions.map((session) => session.id === id ? next : session), activeSessionId: next.id, activeWorkspaceId: next.workspaceId });
    void api.app.saveRestoreState({ lastWorkspaceId: next.workspaceId, lastTerminalRestoreId: next.restoreId, lastTerminalRuntimeId: next.id }).catch(() => undefined);
  },
  setActiveSession(id) {
    const session = get().sessions.find((item) => item.id === id);
    set({ activeSessionId: id, activeWorkspaceId: session?.workspaceId ?? get().activeWorkspaceId });
    if (session) void api.app.saveRestoreState({ lastWorkspaceId: session.workspaceId, lastTerminalRestoreId: session.restoreId, lastTerminalRuntimeId: session.id }).catch(() => undefined);
  },
  setActiveWorkspace(id) { set({ activeWorkspaceId: id }); if (id) void api.app.saveRestoreState({ lastWorkspaceId: id, lastTerminalRestoreId: get().sessions.find((session) => session.id === get().activeSessionId)?.restoreId, lastTerminalRuntimeId: get().activeSessionId ?? undefined }).catch(() => undefined); },
  getWorkspaceSessions(workspaceId) { return get().sessions.filter((session) => session.workspaceId === workspaceId); },
}));
