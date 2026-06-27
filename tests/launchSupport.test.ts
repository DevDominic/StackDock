import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StackDockSettings } from '../src/shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/stackdock-test', getVersion: () => '0.1.0' },
  shell: { openPath: vi.fn(() => Promise.resolve('')) },
}));

import { applySafeModeSettings } from '../electron/launchSupport';

function settings(): StackDockSettings {
  return {
    themeId: 'x',
    importedThemes: [],
    confirmBeforeDiscard: true,
    emptySessionsVisible: false,
    showSessionCwdForAll: false,
    gitRefreshIntervalSeconds: 1,
    autoSave: true,
    autoSaveDelayMs: 1000,
    openLinksExternally: false,
    captureTerminalBrowserOpens: true,
    capturedLinkOpenMode: 'tab',
    ui: { fontFamily: 'sans', fontSize: 13 },
    code: { ligatures: true },
    editor: { fontSize: 13, fontFamily: 'mono', tabSize: 2, wordWrap: 'off' },
    terminal: { fontSize: 13, fontFamily: 'mono', cursorBlink: true, startAtBottom: false, markdownFormatting: true },
    terminalProfiles: [],
    extensions: { localPackagePaths: ['C:/ext'], enabled: ['local.ext'], disabled: [], config: {} },
    workspaceViewState: { sessionsVisible: true, visibleActivityViewIds: [] },
    keybinds: {},
  };
}

afterEach(() => {
  delete process.env.STACKDOCK_SAFE_MODE;
});

describe('launchSupport Safe Mode', () => {
  it('drops local extension paths and explicit enablements when active', () => {
    process.env.STACKDOCK_SAFE_MODE = '1';

    const safe = applySafeModeSettings(settings());

    expect(safe.extensions.localPackagePaths).toEqual([]);
    expect(safe.extensions.enabled).toEqual([]);
  });

  it('keeps settings unchanged when Safe Mode is inactive', () => {
    const current = settings();

    expect(applySafeModeSettings(current)).toBe(current);
  });
});
