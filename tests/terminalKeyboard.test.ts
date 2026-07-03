import { describe, expect, it } from 'vitest';
import { getTerminalCsiUSequence } from '../src/lib/terminalKeyboard';

describe('terminal keyboard CSI-u encoding', () => {
  it('encodes Ctrl+Alt printable hotkeys for terminal TUIs', () => {
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'p', ctrlKey: true, altKey: true })).toBe('\x1b[112;7u');
    expect(getTerminalCsiUSequence({ type: 'keydown', key: ']', ctrlKey: true, altKey: true })).toBe('\x1b[93;7u');
  });

  it('encodes shifted combined modifiers using the shifted key codepoint', () => {
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'P', ctrlKey: true, shiftKey: true })).toBe('\x1b[80;6u');
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'P', ctrlKey: true, altKey: true, shiftKey: true })).toBe('\x1b[80;8u');
  });

  it('keeps legacy-compatible text chords on xterm default handling', () => {
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'p' })).toBeNull();
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'P', shiftKey: true })).toBeNull();
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'p', ctrlKey: true })).toBeNull();
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'p', altKey: true })).toBeNull();
  });

  it('encodes modified special keys such as Shift+Enter', () => {
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'Enter', shiftKey: true })).toBe('\x1b[13;2u');
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'Enter', ctrlKey: true, altKey: true })).toBe('\x1b[13;7u');
  });

  it('ignores keyup, composition, and meta chords', () => {
    expect(getTerminalCsiUSequence({ type: 'keyup', key: 'p', ctrlKey: true, altKey: true })).toBeNull();
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'p', ctrlKey: true, altKey: true, isComposing: true })).toBeNull();
    expect(getTerminalCsiUSequence({ type: 'keydown', key: 'p', ctrlKey: true, altKey: true, metaKey: true })).toBeNull();
  });
});
