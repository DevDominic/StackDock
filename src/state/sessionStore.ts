import { create } from 'zustand';
import { api } from '../lib/api';
import type { HeadlessCommandRun, WorkspaceTerminalSession } from '../shared/types';

const HEADLESS_OUTPUT_MAX_CHARS = 128 * 1024;

function stripAnsi(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function cleanHeadlessOutput(output: string, command: string) {
  let trimmed = stripAnsi(output);
  if (command) {
    const exactIndex = trimmed.lastIndexOf(command);
    const prefixIndex = exactIndex < 0 ? trimmed.lastIndexOf(command.slice(0, Math.min(command.length, 80))) : -1;
    const commandIndex = exactIndex >= 0 ? exactIndex : prefixIndex;
    if (commandIndex >= 0) trimmed = trimmed.slice(commandIndex + (exactIndex >= 0 ? command.length : 0));
  }
  return trimmed
    .split('\n')
    .filter((line, index) => !(index === 0 && !line.trim()))
    .filter((line, index) => !(index === 0 && line.trim() === 'exit'))
    .join('\n');
}

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

function pickNextActiveSession(sessions: WorkspaceTerminalSession[], preferredWorkspaceId?: string | null, previousActiveSessionId?: string | null) {
  const sameWorkspace = preferredWorkspaceId ? sessions.find((session) => session.workspaceId === preferredWorkspaceId && session.id !== previousActiveSessionId) : null;
  return sameWorkspace ?? sessions.find((session) => session.id !== previousActiveSessionId) ?? sessions[0] ?? null;
}

function persistActiveSession(session: WorkspaceTerminalSession | null, workspaceIdFallback?: string | null) {
  if (session) {
    void api.app.saveRestoreState({ lastWorkspaceId: session.workspaceId, lastTerminalRestoreId: session.restoreId, lastTerminalRuntimeId: session.id }).catch(() => undefined);
  } else if (workspaceIdFallback) {
    void api.app.saveRestoreState({ lastWorkspaceId: workspaceIdFallback }).catch(() => undefined);
  }
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
    persistActiveSession(session);
    return session;
  },
  async closeSession(id) {
    const current = get();
    const closing = current.sessions.find((session) => session.id === id);
    await api.terminal.kill(id);
    if (closing?.restoreId) await api.terminal.forgetSnapshot(closing.restoreId).catch(() => undefined);
    const next = get().sessions.filter((session) => session.id !== id);
    if (get().activeSessionId !== id) {
      set({ sessions: next });
      return;
    }
    const picked = pickNextActiveSession(next, closing?.workspaceId ?? current.activeWorkspaceId, id);
    const fallbackWorkspaceId = picked?.workspaceId ?? closing?.workspaceId ?? current.activeWorkspaceId;
    set({ sessions: next, activeSessionId: picked?.id ?? null, activeWorkspaceId: fallbackWorkspaceId ?? null });
    persistActiveSession(picked, fallbackWorkspaceId);
  },
  appendHeadlessOutput(id, data) {
    set({ headlessRuns: get().headlessRuns.map((run) => run.id === id ? { ...run, output: cleanHeadlessOutput((run.output + data).slice(-HEADLESS_OUTPUT_MAX_CHARS), run.command) } : run) });
  },
  removeHeadlessRun(id) { set({ headlessRuns: get().headlessRuns.filter((run) => run.id !== id) }); },
  removeSessionLocal(id) {
    const current = get();
    const removing = current.sessions.find((session) => session.id === id);
    const next = current.sessions.filter((session) => session.id !== id);
    if (current.activeSessionId !== id) {
      set({ sessions: next });
      return;
    }
    const picked = pickNextActiveSession(next, removing?.workspaceId ?? current.activeWorkspaceId, id);
    const fallbackWorkspaceId = picked?.workspaceId ?? removing?.workspaceId ?? current.activeWorkspaceId;
    set({ sessions: next, activeSessionId: picked?.id ?? null, activeWorkspaceId: fallbackWorkspaceId ?? null });
    persistActiveSession(picked, fallbackWorkspaceId);
  },
  renameSession(id, name) { set({ sessions: get().sessions.map((session) => session.id === id ? { ...session, name } : session) }); },
  replaceSession(id, next) {
    set({ sessions: get().sessions.map((session) => session.id === id ? next : session), activeSessionId: next.id, activeWorkspaceId: next.workspaceId });
    persistActiveSession(next);
  },
  setActiveSession(id) {
    const session = get().sessions.find((item) => item.id === id);
    set({ activeSessionId: id, activeWorkspaceId: session?.workspaceId ?? get().activeWorkspaceId });
    if (session) persistActiveSession(session);
  },
  setActiveWorkspace(id) {
    const activeSession = get().sessions.find((session) => session.id === get().activeSessionId && session.workspaceId === id) ?? null;
    set({ activeWorkspaceId: id });
    if (id) persistActiveSession(activeSession, id);
  },
  getWorkspaceSessions(workspaceId) { return get().sessions.filter((session) => session.workspaceId === workspaceId); },
}));
