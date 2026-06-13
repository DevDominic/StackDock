import { describe, expect, it } from 'vitest';
import { buildRestoredScrollbackBarrier, sanitizeSnapshotReplay, trimSnapshotOutput } from '../src/shared/terminalSnapshot';

describe('terminal snapshot sanitation', () => {
  it('strips complete leading device attribute responses', () => {
    expect(sanitizeSnapshotReplay('\x1b[?1;2chello')).toBe('hello');
  });

  it('strips missing-ESC device attribute tails', () => {
    expect(sanitizeSnapshotReplay('[?1;2chello')).toBe('hello');
    expect(sanitizeSnapshotReplay('?1;2chello')).toBe('hello');
    expect(sanitizeSnapshotReplay(';2chello')).toBe('hello');
  });

  it('strips trim boundaries inside CSI sequences', () => {
    const output = trimSnapshotOutput(`${'x'.repeat(20)}\x1b[?1;2chello`, 11);
    expect(output).toBe('hello');
    expect(output).not.toMatch(/^\[\?1;2c/);
  });

  it('strips terminal queries xterm would answer on replay', () => {
    expect(sanitizeSnapshotReplay('a\x1b[cb')).toBe('ab'); // primary DA
    expect(sanitizeSnapshotReplay('a\x1b[0cb')).toBe('ab');
    expect(sanitizeSnapshotReplay('a\x1b[>cb')).toBe('ab'); // secondary DA
    expect(sanitizeSnapshotReplay('a\x1b[=cb')).toBe('ab'); // tertiary DA
    expect(sanitizeSnapshotReplay('a\x1b[6nb')).toBe('ab'); // cursor position report
    expect(sanitizeSnapshotReplay('a\x1b[?2026$pb')).toBe('ab'); // DECRQM
    expect(sanitizeSnapshotReplay('a\x1b[>0qb')).toBe('ab'); // XTVERSION
    expect(sanitizeSnapshotReplay('a\x1b]11;?\x07b')).toBe('ab'); // OSC bg color query
    expect(sanitizeSnapshotReplay('a\x1b]10;?\x1b\\b')).toBe('ab'); // OSC fg color query, ST-terminated
  });

  it('strips echoed DA response litter from polluted snapshots', () => {
    expect(sanitizeSnapshotReplay('PS C:\\> [?1;2c more')).toBe('PS C:\\>  more');
  });

  it('preserves complete color sequences', () => {
    expect(sanitizeSnapshotReplay('\x1b[31mred\x1b[0m')).toBe('\x1b[31mred\x1b[0m');
  });

  it('trims without starting on UTF-8 continuation bytes', () => {
    const output = trimSnapshotOutput(`${'😀'.repeat(8)}ok`, 7);
    expect(output).not.toContain('\ufffd');
    expect(output.endsWith('ok')).toBe(true);
  });

  it('builds a restored scrollback barrier with resume notice and viewport padding', () => {
    const barrier = buildRestoredScrollbackBarrier(3, 'pi -r');
    expect(barrier).toContain('──── restored scrollback; live output follows ────');
    expect(barrier).toContain('[resuming session with: pi -r]');
    expect(barrier).toMatch(/(?:\r\n){3}\x1b\[H\x1b\[J$/);
    expect(barrier.endsWith('\x1b[H\x1b[J')).toBe(true);
  });

  it('clamps invalid restored scrollback barrier row counts', () => {
    expect(buildRestoredScrollbackBarrier(-2)).not.toMatch(/(?:\r\n){3}\x1b\[H\x1b\[J$/);
    expect(buildRestoredScrollbackBarrier(Number.NaN)).not.toMatch(/(?:\r\n){3}\x1b\[H\x1b\[J$/);
  });
});
