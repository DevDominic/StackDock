import { describe, expect, it } from 'vitest';
import type { StackDockSettings } from '../src/shared/types';
import { coerceConfigValue, defaultsFromFields, getExtensionConfig, setExtensionConfig } from '../src/extensions/configuration';

const settings: StackDockSettings = {
  themeId: 'x', importedThemes: [], confirmBeforeDiscard: true, emptySessionsVisible: false, showSessionCwdForAll: false, gitRefreshIntervalSeconds: 1, autoSave: true, autoSaveDelayMs: 1000, openLinksExternally: false, captureTerminalBrowserOpens: true, capturedLinkOpenMode: 'tab',
  ui: { fontFamily: 'sans', fontSize: 13 }, code: { ligatures: true }, editor: { fontSize: 13, fontFamily: 'mono', tabSize: 2, wordWrap: 'off' }, terminal: { fontSize: 13, fontFamily: 'mono', cursorBlink: true }, terminalProfiles: [], extensions: { localPackagePaths: [], enabled: [], disabled: [], config: { 'x.ext': { enabled: true } } },
};

describe('extension configuration helpers', () => {
  it('merges defaults with stored values', () => {
    expect(getExtensionConfig(settings, 'x.ext', { enabled: false, count: 1 })).toEqual({ enabled: true, count: 1 });
  });
  it('updates extension config immutably', () => {
    const next = setExtensionConfig(settings, 'x.ext', { count: 2 });
    expect(next.extensions.config['x.ext']).toEqual({ enabled: true, count: 2 });
    expect(settings.extensions.config['x.ext']).toEqual({ enabled: true });
  });
  it('extracts and coerces field defaults', () => {
    const fields = [{ key: 'count', label: 'Count', type: 'number' as const, default: 1, min: 1 }];
    expect(defaultsFromFields(fields)).toEqual({ count: 1 });
    expect(coerceConfigValue(fields[0], -4)).toBe(1);
  });
});
