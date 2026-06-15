import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '../src/shared/types';

let createCount = 0;
const saveRestoreState = vi.fn(() => Promise.resolve({}));
const kill = vi.fn(() => Promise.resolve());
const forgetSnapshot = vi.fn(() => Promise.resolve());
const update = vi.fn((id: string, patch: Partial<TerminalSession>) => {
  const next = { id, restoreId: `restore-${id}`, name: patch.name ?? 'Updated', profileId: 'powershell', cwd: 'C:/repo', createdAt: new Date(0).toISOString(), ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) if (value === null) delete next[key];
  return Promise.resolve(next as TerminalSession);
});

function nextTerminal(): TerminalSession {
  createCount += 1;
  return {
    id: `term-${createCount}`,
    restoreId: `restore-${createCount}`,
    name: `Terminal ${createCount}`,
    profileId: 'powershell',
    cwd: 'C:/repo',
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  createCount = 0;
  saveRestoreState.mockClear();
  kill.mockClear();
  forgetSnapshot.mockClear();
  update.mockClear();
  vi.resetModules();
  vi.stubGlobal('window', {
    stackdock: {
      terminal: {
        create: vi.fn(() => Promise.resolve(nextTerminal())),
        update,
        kill,
        forgetSnapshot,
      },
      app: { saveRestoreState },
    },
  });
});

async function loadStore() {
  const module = await import('../src/state/sessionStore');
  module.useSessionStore.setState({ sessions: [], headlessRuns: [], activeSessionId: null, activeWorkspaceId: null });
  return module.useSessionStore;
}

describe('sessionStore active fallback', () => {
  it('prefers another session in the same workspace after closing the active session', async () => {
    const store = await loadStore();
    const a1 = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    const a2 = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    await store.getState().createSession({ workspaceId: 'workspace-b', workspaceName: 'B', workspacePath: 'C:/b', profileId: 'powershell' });
    store.getState().setActiveSession(a2.id);
    saveRestoreState.mockClear();

    await store.getState().closeSession(a2.id);

    expect(kill).toHaveBeenCalledWith(a2.id);
    expect(forgetSnapshot).toHaveBeenCalledWith(a2.restoreId);
    expect(store.getState().activeSessionId).toBe(a1.id);
    expect(store.getState().activeWorkspaceId).toBe('workspace-a');
    expect(saveRestoreState).toHaveBeenCalledWith({ lastWorkspaceId: 'workspace-a', lastTerminalRestoreId: a1.restoreId, lastTerminalRuntimeId: a1.id });
  });

  it('falls back to another workspace when no same-workspace sessions remain', async () => {
    const store = await loadStore();
    const a = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    const b = await store.getState().createSession({ workspaceId: 'workspace-b', workspaceName: 'B', workspacePath: 'C:/b', profileId: 'powershell' });
    store.getState().setActiveSession(a.id);
    saveRestoreState.mockClear();

    store.getState().removeSessionLocal(a.id);

    expect(store.getState().activeSessionId).toBe(b.id);
    expect(store.getState().activeWorkspaceId).toBe('workspace-b');
    expect(saveRestoreState).toHaveBeenCalledWith({ lastWorkspaceId: 'workspace-b', lastTerminalRestoreId: b.restoreId, lastTerminalRuntimeId: b.id });
  });

  it('renames sessions through terminal metadata without changing active session', async () => {
    const store = await loadStore();
    const a = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    const b = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    store.getState().setActiveSession(a.id);

    await store.getState().renameSession(b.id, 'Renamed');

    expect(update).toHaveBeenCalledWith(b.id, { name: 'Renamed' });
    expect(store.getState().sessions.find((session) => session.id === b.id)?.name).toBe('Renamed');
    expect(store.getState().activeSessionId).toBe(a.id);
  });

  it('updates split metadata without changing active session', async () => {
    const store = await loadStore();
    const a = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    const b = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    store.getState().setActiveSession(a.id);

    await store.getState().updateSessionMetadata(b.id, { splitGroupId: 'group-1', splitDirection: 'row', splitGroupOrder: 1 });
    expect(store.getState().sessions.find((session) => session.id === b.id)).toMatchObject({ splitGroupId: 'group-1', splitDirection: 'row', splitGroupOrder: 1 });
    expect(store.getState().activeSessionId).toBe(a.id);

    await store.getState().updateSessionMetadata(b.id, { splitGroupId: null, splitDirection: null, splitGroupOrder: null });
    const updated = store.getState().sessions.find((session) => session.id === b.id)!;
    expect(updated.splitGroupId).toBeUndefined();
    expect(updated.splitDirection).toBeUndefined();
    expect(updated.splitGroupOrder).toBeUndefined();
    expect(store.getState().activeSessionId).toBe(a.id);
  });

  it('clears the active session when the last session is removed', async () => {
    const store = await loadStore();
    const only = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell' });
    saveRestoreState.mockClear();

    await expect(store.getState().closeSession(only.id)).resolves.toBeUndefined();

    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().activeSessionId).toBeNull();
    expect(store.getState().activeWorkspaceId).toBe('workspace-a');
    expect(saveRestoreState).toHaveBeenCalledWith({ lastWorkspaceId: 'workspace-a' });
  });
});
