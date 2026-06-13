import { describe, expect, it } from 'vitest';
import { normalizeAutomation } from '../electron/automationStore';

describe('automation keybind normalization', () => {
  it('preserves valid keybinds and drops invalid keybinds', () => {
    const normalized = normalizeAutomation({
      commands: [
        { id: 'global', label: 'Global', command: 'npm test', keybind: 'ctrl+shift+t' },
        { id: 'bad', label: 'Bad', command: 'echo bad', keybind: 'ctrl' },
      ],
      workspaces: {
        ws1: { commands: [{ id: 'workspace', label: 'Workspace', command: 'npm run dev', keybind: 'cmd+k' }] },
      },
    });
    expect(normalized.commands[0].keybind).toBe('Ctrl+Shift+T');
    expect(normalized.commands[1].keybind).toBeUndefined();
    expect(normalized.workspaces.ws1.commands?.[0].keybind).toBe('Mod+K');
  });
});
