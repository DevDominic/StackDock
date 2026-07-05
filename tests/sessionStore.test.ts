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

function nextTerminal(restoreId?: string): TerminalSession {
  createCount += 1;
  return {
    id: `term-${createCount}`,
    restoreId: restoreId ?? `restore-${createCount}`,
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
        create: vi.fn((_profileId: string, _cwd: string, _name?: string, _startupCommand?: string, restoreId?: string) => Promise.resolve(nextTerminal(restoreId))),
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

  it('reuses an existing restored session instead of creating duplicates', async () => {
    const store = await loadStore();
    const first = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', restoreId: 'restore-stable' });
    const second = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', restoreId: 'restore-stable' });

    expect(second).toBe(first);
    expect(window.stackdock.terminal.create).toHaveBeenCalledTimes(1);
    expect(store.getState().sessions).toHaveLength(1);
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

  it('removes shell exit echo from headless command output', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'npm test', headless: true });

    store.getState().appendHeadlessOutput(session.id, 'npm test\r\npass\r\nPS C:\\repo> exit\r\n');

    expect(store.getState().headlessRuns.find((run) => run.id === session.id)?.output.trim()).toBe('pass');
  });

  it('parses Pi JSON thinking and text deltas without showing raw JSON', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'pi --mode json -p "hello"', headless: true });

    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'turn_start' })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', thinking_delta: 'checking repo' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', text_delta: 'Hello' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', text_delta: ' world' } })}\n`);

    const run = store.getState().headlessRuns.find((item) => item.id === session.id)!;
    expect(run.outputFormat).toBe('pi-json');
    expect(run.progress).toContain('Thinking…');
    expect(run.progress).toContain('checking repo');
    expect(run.output).toBe('Hello world');
    expect(run.output).not.toContain('message_update');
  });

  it('parses Pi JSON assistantMessageEvent delta fields from runtime schema', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'pi --mode json -p "hello"', headless: true });

    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'runtime ' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Runtime' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' answer' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: 'reading ' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: 'files' } })}\n`);

    const run = store.getState().headlessRuns.find((item) => item.id === session.id)!;
    expect(run.outputFormat).toBe('pi-json');
    expect(run.progress).toContain('runtime thinking');
    expect(run.progress).not.toContain('runtime \nthinking');
    expect(run.progress).toContain('reading files');
    expect(run.progress).not.toContain('reading \nfiles');
    expect(run.output).toBe('Runtime answer');
  });

  it('formats Pi JSON tool execution updates without raw JSON or duplicate partials', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'pi --mode json -p "hello"', headless: true });

    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'npm test' } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'tool_execution_update', toolCallId: 'call-1', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'line one\n' }] } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'tool_execution_update', toolCallId: 'call-1', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'line one\nline two\n' }] } })}\n`);
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'bash' })}\n`);

    const run = store.getState().headlessRuns.find((item) => item.id === session.id)!;
    expect(run.outputFormat).toBe('pi-json');
    expect(run.progress).toContain('Running bash: npm test…');
    expect(run.progress).toContain('line one');
    expect(run.progress).toContain('line two');
    expect(run.progress).toContain('bash completed');
    expect(run.progress).not.toContain('tool_execution_update');
    expect(run.progress?.match(/line one/g) ?? []).toHaveLength(1);
  });

  it('buffers split Pi JSON lines before parsing', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'pi --mode json -p "hello"', headless: true });
    const line = JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', text_delta: 'split ok' } }) + '\n';

    store.getState().appendHeadlessOutput(session.id, line.slice(0, 20));
    expect(store.getState().headlessRuns.find((run) => run.id === session.id)?.output).toBe('');

    store.getState().appendHeadlessOutput(session.id, line.slice(20));
    expect(store.getState().headlessRuns.find((run) => run.id === session.id)?.output).toBe('split ok');
  });

  it('uses final assistant message instead of raw Pi JSON result on completion', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'pi --mode json -p "hello"', headless: true });
    const finalEvent = { type: 'agent_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Final answer' }] } };

    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ type: 'agent_start' })}\n`);
    store.getState().completeHeadlessRun(session.id, { output: `${JSON.stringify(finalEvent)}\n`, exitCode: 0 });

    const run = store.getState().headlessRuns.find((item) => item.id === session.id)!;
    expect(run.completedAt).toBeTypeOf('number');
    expect(run.outputFormat).toBe('pi-json');
    expect(run.output).toBe('Final answer');
  });

  it('keeps malformed and unrelated JSON output as plain text', async () => {
    const store = await loadStore();
    const session = await store.getState().createSession({ workspaceId: 'workspace-a', workspaceName: 'A', workspacePath: 'C:/a', profileId: 'powershell', startupCommand: 'node script.js', headless: true });

    store.getState().appendHeadlessOutput(session.id, '{not json}\n');
    store.getState().appendHeadlessOutput(session.id, `${JSON.stringify({ ok: true })}\n`);

    const run = store.getState().headlessRuns.find((item) => item.id === session.id)!;
    expect(run.outputFormat).toBe('plain');
    expect(run.output).toContain('{not json}');
    expect(run.output).toContain('{"ok":true}');
  });
});
