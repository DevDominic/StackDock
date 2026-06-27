import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/stackdock-test' },
}));

import { getDefaultSettings } from '../electron/configStore';

describe('configStore terminal defaults', () => {
  it('uses macOS shells for darwin defaults', () => {
    const settings = getDefaultSettings('darwin');

    expect(settings.defaultTerminalProfileId).toBe('zsh');
    expect(settings.terminalProfiles.map((profile) => profile.id)).toEqual(['zsh', 'bash', 'pi']);
    expect(settings.terminalProfiles.map((profile) => profile.shell)).toEqual(['/bin/zsh', '/bin/bash', '/bin/zsh']);
  });

  it('keeps Windows shells for win32 defaults', () => {
    const settings = getDefaultSettings('win32');

    expect(settings.defaultTerminalProfileId).toBe('powershell');
    expect(settings.terminalProfiles.some((profile) => profile.shell === 'powershell.exe')).toBe(true);
    expect(settings.terminalProfiles.some((profile) => profile.shell === 'cmd.exe')).toBe(true);
  });

  it('keeps workspace view toggles in global defaults', () => {
    const settings = getDefaultSettings('win32');

    expect(settings.workspaceViewState).toEqual({
      sessionsVisible: true,
      visibleActivityViewIds: ['stackdock.explorer.view', 'stackdock.git.view'],
      viewPlacements: {},
      viewOrder: [],
    });
  });

  it('defaults microphone permission to prompt', () => {
    const settings = getDefaultSettings('win32');

    expect(settings.permissions).toEqual({ microphone: 'prompt' });
  });
});
