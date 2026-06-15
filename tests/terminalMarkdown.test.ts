import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '../src/shared/types';
import { createTerminalMarkdownState, flushTerminalMarkdownState, formatTerminalMarkdownChunk, shouldFormatTerminalMarkdown } from '../src/lib/terminalMarkdown';

function session(patch: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term_1',
    name: 'Terminal',
    profileId: 'powershell',
    cwd: 'C:\\repo',
    createdAt: '2026-06-15T00:00:00.000Z',
    ...patch,
  };
}

describe('terminal markdown formatter', () => {
  it('styles fenced code block delimiters and body lines', () => {
    const state = createTerminalMarkdownState();
    const formatted = formatTerminalMarkdownChunk('```bash\necho hi\n```\n', state);

    expect(formatted).toContain('\x1b[2;36m```bash\x1b[0m\n');
    expect(formatted).toContain('\x1b[48;5;236;38;5;252mecho hi\x1b[0m\n');
    expect(formatted).toContain('\x1b[2;36m```\x1b[0m\n');
    expect(state.inFence).toBe(false);
  });

  it('keeps fenced code state across chunks', () => {
    const state = createTerminalMarkdownState();

    const opening = formatTerminalMarkdownChunk('```bash\n', state);
    const body = formatTerminalMarkdownChunk('npm test\n', state);
    const closing = formatTerminalMarkdownChunk('```\n', state);

    expect(opening).toContain('\x1b[2;36m```bash\x1b[0m\n');
    expect(body).toBe('\x1b[48;5;236;38;5;252mnpm test\x1b[0m\n');
    expect(closing).toContain('\x1b[2;36m```\x1b[0m\n');
    expect(state.inFence).toBe(false);
  });

  it('buffers incomplete trailing lines until flushed', () => {
    const state = createTerminalMarkdownState();

    expect(formatTerminalMarkdownChunk('run `npm', state)).toBe('');
    expect(formatTerminalMarkdownChunk(' test` now\n', state)).toBe('run \x1b[96m`npm test`\x1b[0m now\n');
    expect(flushTerminalMarkdownState(state)).toBe('');
  });

  it('styles inline code outside fences', () => {
    const state = createTerminalMarkdownState();

    expect(formatTerminalMarkdownChunk('run `npm test` now\n', state)).toBe('run \x1b[96m`npm test`\x1b[0m now\n');
  });

  it('passes ANSI/control lines through unchanged', () => {
    const state = createTerminalMarkdownState();
    const ansi = '\x1b[31mred `code`\x1b[0m\n';

    expect(formatTerminalMarkdownChunk(ansi, state)).toBe(ansi);
  });

  it('leaves ordinary text unchanged', () => {
    const state = createTerminalMarkdownState();

    expect(formatTerminalMarkdownChunk('hello world\r\n', state)).toBe('hello world\r\n');
  });

  it('detects Pi sessions only', () => {
    expect(shouldFormatTerminalMarkdown(session({ profileId: 'pi' }))).toBe(true);
    expect(shouldFormatTerminalMarkdown(session({ startupCommand: 'pi --session-id abc' }))).toBe(true);
    expect(shouldFormatTerminalMarkdown(session({ resumeState: { integrationId: 'stackdock.pi', sessionId: 'abc' } }))).toBe(true);
    expect(shouldFormatTerminalMarkdown(session({ profileId: 'powershell', startupCommand: 'npm test' }))).toBe(false);
  });
});
