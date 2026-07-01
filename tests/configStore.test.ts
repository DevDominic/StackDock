import fs from 'fs/promises';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/stackdock-test' },
}));

import { getDefaultSettings, loadSettings } from '../electron/configStore';

const configPath = path.join('/tmp/stackdock-test', 'StackDock', 'config.json');

async function writeConfig(config: unknown) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config), 'utf8');
}

afterEach(async () => {
  await fs.rm(configPath, { force: true });
});

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

  it('defaults Smart Input to disabled, Enter-to-send, no automatic execute', () => {
    const settings = getDefaultSettings('darwin');

    expect(settings.terminal.smartInput).toEqual({ enabled: false, enterToSend: true, sendEnter: false });
  });
});

describe('configStore Smart Input migration', () => {
  it('fills Smart Input defaults for configs saved before the feature existed', async () => {
    await writeConfig({ terminal: { fontSize: 15 } });

    const settings = await loadSettings();

    expect(settings.terminal.fontSize).toBe(15);
    expect(settings.terminal.smartInput).toEqual({ enabled: false, enterToSend: true, sendEnter: false });
  });

  it('preserves explicit Smart Input choices', async () => {
    await writeConfig({ terminal: { smartInput: { enabled: true, enterToSend: false, sendEnter: true } } });

    const settings = await loadSettings();

    expect(settings.terminal.smartInput).toEqual({ enabled: true, enterToSend: false, sendEnter: true });
  });
});
