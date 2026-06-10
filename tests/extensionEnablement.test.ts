import { describe, expect, it } from 'vitest';
import type { ExtensionManifest, StackDockSettings } from '../src/shared/types';
import { resolveEnabledExtensions } from '../src/extensions/enablement';

const settings = (enabled: string[] = [], disabled: string[] = []): StackDockSettings => ({
  themeId: 'x', importedThemes: [], confirmBeforeDiscard: true, emptySessionsVisible: false, showSessionCwdForAll: false, gitRefreshIntervalSeconds: 0, autoSave: true, autoSaveDelayMs: 1000, openLinksExternally: false, captureTerminalBrowserOpens: true, capturedLinkOpenMode: 'tab' as const,
  ui: { fontFamily: 'sans', fontSize: 13 }, code: { ligatures: true }, editor: { fontSize: 13, fontFamily: 'mono', tabSize: 2, wordWrap: 'off' }, terminal: { fontSize: 13, fontFamily: 'mono', cursorBlink: true }, terminalProfiles: [], extensions: { localPackagePaths: [], enabled, disabled },
});
const manifests: ExtensionManifest[] = [{ id: 'builtin.on', name: 'On', version: '1', defaultEnabled: true }, { id: 'local.off', name: 'Off', version: '1', defaultEnabled: false }];

describe('extension enablement', () => {
  it('enables default built-ins', () => { expect(resolveEnabledExtensions(manifests, settings()).map((m) => m.id)).toEqual(['builtin.on']); });
  it('applies global disable', () => { expect(resolveEnabledExtensions(manifests, settings([], ['builtin.on']))).toHaveLength(0); });
  it('applies global enable for local packages', () => { expect(resolveEnabledExtensions(manifests, settings(['local.off'])).map((m) => m.id)).toContain('local.off'); });
  it('workspace override wins', () => { expect(resolveEnabledExtensions(manifests, settings([], ['builtin.on']), { enabled: ['builtin.on'] }).map((m) => m.id)).toContain('builtin.on'); });
});
