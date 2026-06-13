import { create } from 'zustand';
import { api } from '../lib/api';
import type { HeadlessCommandRun, WorkspaceTerminalSession } from '../shared/types';

const HEADLESS_OUTPUT_MAX_CHARS = 128 * 1024;

interface CreateInput { workspaceId: string; workspaceName: string; workspacePath: string; profileId: string; cwd?: string; name?: string; startupCommand?: string; restoreId?: string; headless?: boolean; commandLabel?: string; }
interface SessionState {
  sessions: WorkspaceTerminalSession[];
  headlessRuns: HeadlessCommandRun[];
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  createSession(input: CreateInput): Promise<WorkspaceTerminalSession>;
  closeSession(id: string): Promise<void>;
  appendHeadlessOutput(id: string, data: string): void;
  removeHeadlessRun(id: string): void;
  removeSessionLocal(id: string): void;
  renameSession(id: string, name: string): void;
  replaceSession(id: string, next: WorkspaceTerminalSession): void;
  setActiveSession(id: string): void;
  setActiveWorkspace(id: string | null): void;
  getWorkspaceSessions(workspaceId: string): WorkspaceTerminalSession[];
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  headlessRuns: [],
  activeSessionId: null,
  activeWorkspaceId: null,
  async createSession(input) {
    const terminal = await api.terminal.create(input.profileId, input.cwd ?? input.workspacePath, input.name, input.startupCommand, input.restoreId, { workspaceId: input.workspaceId, workspaceName: input.workspaceName, workspacePath: input.workspacePath, headless: input.headless, commandLabel: input.commandLabel });
    const session: WorkspaceTerminalSession = { ...terminal, workspaceId: input.workspaceId, workspaceName: input.workspaceName, workspacePath: input.workspacePath };
    if (input.headless) {
      const run: HeadlessCommandRun = {
        id: session.id,
        restoreId: session.restoreId,
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        workspacePath: input.workspacePath,
        label: input.commandLabel ?? input.name ?? session.name,
        command: session.startupCommand ?? input.startupCommand ?? '',
        cwd: input.cwd ?? input.workspacePath,
        startedAt: Date.now(),
        output: '',
      };
      set({ headlessRuns: [...get().headlessRuns.filter((item) => item.id !== run.id), run] });
      return session;
    }
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
  appendHeadlessOutput(id, data) {
    set({ headlessRuns: get().headlessRuns.map((run) => run.id === id ? { ...run, output: (run.output + data).slice(-HEADLESS_OUTPUT_MAX_CHARS) } : run) });
  },
  removeHeadlessRun(id) { set({ headlessRuns: get().headlessRuns.filter((run) => run.id !== id) }); },
  removeSessionLocal(id) {
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
