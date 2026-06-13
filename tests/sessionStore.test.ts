import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '../src/shared/types';

let createCount = 0;
const saveRestoreState = vi.fn(() => Promise.resolve({}));
const kill = vi.fn(() => Promise.resolve());
const forgetSnapshot = vi.fn(() => Promise.resolve());

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
  vi.resetModules();
  vi.stubGlobal('window', {
    stackdock: {
      terminal: {
        create: vi.fn(() => Promise.resolve(nextTerminal())),
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
