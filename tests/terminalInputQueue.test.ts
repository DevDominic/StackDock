import { describe, expect, it } from 'vitest';
import type { TerminalCommandIntegration } from '../electron/terminalIntegration';
import { transformTerminalInput } from '../electron/terminalInput';
import type { TerminalSession, TerminalSnapshot } from '../src/shared/types';

type TestEntry = {
  session: TerminalSession;
  snapshot: TerminalSnapshot;
  inputLine: string;
  writes: string[];
  terminalIntegrations: TerminalCommandIntegration[];
  inputWriteQueue: Promise<void>;
  refresh?: () => Promise<void>;
};

function createEntry(terminalIntegrations: TerminalCommandIntegration[] = []): TestEntry {
  const session = { id: 'term_1', restoreId: 'restore_abc', name: 'Terminal', profileId: 'powershell', cwd: 'C:\\repo', createdAt: '2026-06-14T00:00:00.000Z' } satisfies TerminalSession;
  const snapshot = { id: 'term_1', restoreId: 'restore_abc', output: '' } satisfies TerminalSnapshot;
  return { session, snapshot, inputLine: '', writes: [], terminalIntegrations, inputWriteQueue: Promise.resolve() };
}

async function queuedWrite(entry: TestEntry, data: string) {
  const runAfterPreviousWrites = entry.inputWriteQueue.catch(() => undefined);
  const writeTask = runAfterPreviousWrites.then(async () => {
    if (data.includes('\r') || data.includes('\n')) await entry.refresh?.();
    entry.writes.push(await transformTerminalInput(entry, data, entry.snapshot));
  });
  entry.inputWriteQueue = writeTask.catch(() => undefined);
  await writeTask;
}

describe('terminal input write queue', () => {
  it('preserves chunk order so interactive pi receives a session id', async () => {
    const integration: TerminalCommandIntegration = {
      id: 'stackdock.pi',
      beforeShellCommand(command) {
        if (command === 'pi') return { command: 'pi --session-id "stackdock.restore_abc"' };
        return undefined;
      },
    };
    const entry = createEntry([integration]);

    await Promise.all([queuedWrite(entry, 'p'), queuedWrite(entry, 'i'), queuedWrite(entry, '\r')]);

    expect(entry.writes.join('')).toBe('pi --session-id "stackdock.restore_abc"\r');
    expect(entry.inputLine).toBe('');
  });

  it('awaits delayed async hooks before writing carriage return', async () => {
    let hookResolved = false;
    const integration: TerminalCommandIntegration = {
      id: 'slow',
      async beforeShellCommand(command) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        hookResolved = true;
        return { command: `${command} done` };
      },
    };
    const entry = createEntry([integration]);

    await queuedWrite(entry, 'x');
    const pending = queuedWrite(entry, '\r');
    expect(entry.writes.join('')).toBe('x');
    await pending;

    expect(hookResolved).toBe(true);
    expect(entry.writes.join('')).toBe('x done\r');
  });

  it('keeps command unchanged after hook error and recovers subsequent writes', async () => {
    const integration: TerminalCommandIntegration = {
      id: 'bad',
      beforeShellCommand() {
        throw new Error('boom');
      },
    };
    const entry = createEntry([integration]);

    await queuedWrite(entry, 'o');
    await queuedWrite(entry, 'k');
    await queuedWrite(entry, '\r');
    await queuedWrite(entry, 'n');
    await queuedWrite(entry, '\r');

    expect(entry.writes.join('')).toBe('ok\rn\r');
  });

  it('recovers the queue after a failed write task', async () => {
    const entry = createEntry();
    entry.inputWriteQueue = Promise.reject(new Error('previous failure'));

    await queuedWrite(entry, 'o');
    await queuedWrite(entry, 'k');

    expect(entry.writes.join('')).toBe('ok');
  });
});
