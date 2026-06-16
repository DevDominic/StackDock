import { describe, expect, it } from 'vitest';
import type { TerminalCommandIntegration, TerminalInteractiveCommandContext, TerminalInteractiveCommandResult } from '../electron/terminalIntegration';

type TestEntry = {
  inputLine: string;
  writes: string[];
  terminalIntegrations: TerminalCommandIntegration[];
  inputWriteQueue: Promise<void>;
  refresh?: () => Promise<void>;
};

function resolveInteractiveCommand(entry: TestEntry, command: string) {
  for (const integration of entry.terminalIntegrations) {
    const result = integration.resolveInteractiveCommand?.(command, { restoreId: 'restore_abc', cwd: 'C:\\repo', name: 'Terminal' });
    if (result) return result.command;
  }
  return command;
}

function transformTerminalInput(entry: TestEntry, data: string) {
  let output = '';
  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const typed = entry.inputLine;
      const resolved = resolveInteractiveCommand(entry, typed);
      output += `${resolved.startsWith(typed) ? resolved.slice(typed.length) : resolved}${char}`;
      entry.inputLine = '';
    } else if (char === '\u0003') {
      entry.inputLine = '';
      output += char;
    } else if (char === '\b' || char === '\u007f') {
      entry.inputLine = entry.inputLine.slice(0, -1);
      output += char;
    } else if (char >= ' ' && char !== '\u007f') {
      entry.inputLine += char;
      output += char;
    } else {
      output += char;
    }
  }
  return output;
}

async function queuedWrite(entry: TestEntry, data: string) {
  const runAfterPreviousWrites = entry.inputWriteQueue.catch(() => undefined);
  const writeTask = runAfterPreviousWrites.then(async () => {
    if (data.includes('\r') || data.includes('\n')) await entry.refresh?.();
    entry.writes.push(transformTerminalInput(entry, data));
  });
  entry.inputWriteQueue = writeTask.catch(() => undefined);
  await writeTask;
}

describe('terminal input write queue', () => {
  it('preserves chunk order so interactive pi receives a session id', async () => {
    const integration: TerminalCommandIntegration = {
      id: 'stackdock.pi',
      resolveInteractiveCommand(command: string, _ctx: TerminalInteractiveCommandContext): TerminalInteractiveCommandResult | undefined {
        if (command === 'pi') return { command: 'pi --session-id "stackdock.restore_abc"' };
        return undefined;
      },
    };
    const entry: TestEntry = { inputLine: '', writes: [], terminalIntegrations: [integration], inputWriteQueue: Promise.resolve() };

    await Promise.all([queuedWrite(entry, 'p'), queuedWrite(entry, 'i'), queuedWrite(entry, '\r')]);

    expect(entry.writes.join('')).toBe('pi --session-id "stackdock.restore_abc"\r');
    expect(entry.inputLine).toBe('');
  });

  it('recovers the queue after a failed write task', async () => {
    const entry: TestEntry = { inputLine: '', writes: [], terminalIntegrations: [], inputWriteQueue: Promise.reject(new Error('previous failure')) };

    await queuedWrite(entry, 'o');
    await queuedWrite(entry, 'k');

    expect(entry.writes.join('')).toBe('ok');
  });
});
