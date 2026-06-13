import { describe, expect, it } from 'vitest';
import { eventToKeybind, findKeybindConflicts, formatKeybind, keybindMatchesEvent, normalizeKeybind } from '../src/shared/keybinds';

describe('keybind helpers', () => {
  it('normalizes aliases and modifier order', () => {
    expect(normalizeKeybind('shift+cmd+p')).toBe('Mod+Shift+P');
    expect(normalizeKeybind('control + alt + comma')).toBe('Ctrl+Alt+,');
    expect(normalizeKeybind('esc')).toBe('Escape');
    expect(normalizeKeybind('ctrl+backtick')).toBe('Ctrl+`');
  });

  it('rejects empty or bare modifiers', () => {
    expect(normalizeKeybind('')).toBeNull();
    expect(normalizeKeybind('Ctrl')).toBeNull();
  });

  it('converts and matches events', () => {
    const event = { key: 'p', ctrlKey: true, shiftKey: true };
    expect(eventToKeybind(event)).toBe('Ctrl+Shift+P');
    expect(keybindMatchesEvent('Mod+Shift+P', event, 'Win32')).toBe(true);
    expect(keybindMatchesEvent('Mod+Shift+P', { key: 'p', metaKey: true, shiftKey: true }, 'MacIntel')).toBe(true);
  });

  it('formats and groups conflicts', () => {
    expect(formatKeybind('Mod+Shift+P', 'Win32')).toBe('Ctrl+Shift+P');
    const conflicts = findKeybindConflicts([
      { id: 'a', label: 'A', keybind: 'ctrl+k' },
      { id: 'b', label: 'B', keybind: 'Ctrl+K' },
      { id: 'c', label: 'C', keybind: 'Ctrl+L' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].items.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
