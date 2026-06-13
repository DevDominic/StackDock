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

  it('deduplicates command ids so existing workspace commands edit independently', () => {
    const normalized = normalizeAutomation({
      commands: [
        { label: 'Test', command: 'npm test' },
        { label: 'Test', command: 'npm run test:watch' },
      ],
      workspaces: {
        ws1: {
          commands: [
            { id: 'dev', label: 'Dev', command: 'npm run dev' },
            { id: 'dev', label: 'Dev copy', command: 'npm run dev -- --host' },
          ],
        },
      },
    });
    expect(normalized.commands.map((command) => command.id)).toEqual(['test', 'test-2']);
    expect(normalized.workspaces.ws1.commands?.map((command) => command.id)).toEqual(['dev', 'dev-2']);
  });
});
