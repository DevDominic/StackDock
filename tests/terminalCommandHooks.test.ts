import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadExtensions } from '../electron/extensionService';
import { transformTerminalInput, runTerminalCommandHooks } from '../electron/terminalInput';
import type { TerminalCommandIntegration } from '../electron/terminalIntegration';
import { getEnabledTerminalIntegrations } from '../extensions/mainRegistry';
import type { StackDockSettings, TerminalSession, TerminalSnapshot } from '../src/shared/types';

let tempDirs: string[] = [];
async function pkg(manifest: unknown) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-ext-')); tempDirs.push(dir); await fs.writeFile(path.join(dir, 'stackdock.extension.json'), JSON.stringify(manifest)); return dir; }
function settings(paths: string[], disabled: string[] = []): StackDockSettings { return { themeId: 'x', importedThemes: [], confirmBeforeDiscard: true, emptySessionsVisible: false, showSessionCwdForAll: false, gitRefreshIntervalSeconds: 0, autoSave: true, autoSaveDelayMs: 1000, openLinksExternally: false, captureTerminalBrowserOpens: true, capturedLinkOpenMode: 'tab' as const, ui: { fontFamily: 'sans', fontSize: 13 }, code: { ligatures: true }, editor: { fontSize: 13, fontFamily: 'mono', tabSize: 2, wordWrap: 'off' }, terminal: { fontSize: 13, fontFamily: 'mono', cursorBlink: true, startAtBottom: false, markdownFormatting: true }, terminalProfiles: [], extensions: { localPackagePaths: paths, enabled: [], disabled, config: {} }, workspaceViewState: { sessionsVisible: true, visibleActivityViewIds: [] }, keybinds: {} }; }
function entry(terminalIntegrations: TerminalCommandIntegration[] = []) {
  const session = { id: 'term_1', restoreId: 'restore_abc', name: 'Terminal', profileId: 'powershell', cwd: 'C:\\repo', createdAt: '2026-06-14T00:00:00.000Z' } satisfies TerminalSession;
  const snapshot = { id: 'term_1', restoreId: 'restore_abc', output: '' } satisfies TerminalSnapshot;
  return { session, snapshot, inputLine: '', terminalIntegrations };
}
afterEach(async () => { await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))); tempDirs = []; });

describe('declarative terminal command hooks', () => {
  it('appends templated args for matching interactive commands', async () => {
    const dir = await pkg({ id: 'example.hooks', name: 'Hooks', version: '1', defaultEnabled: true, capabilities: ['terminal-command-hook'], contributes: { terminalCommandHooks: [{ id: 'append.session', match: '^tool(?:\\s|$)', sources: ['interactive'], appendArgs: '--workspace ${name}' }] } });
    const appSettings = settings([dir]);
    await loadExtensions(appSettings);
    const testEntry = entry(getEnabledTerminalIntegrations(appSettings));

    expect(await transformTerminalInput(testEntry, 'tool\r', testEntry.snapshot)).toBe('tool --workspace Terminal\r');
  });

  it('leaves non-matching commands and disabled extensions unchanged', async () => {
    const dir = await pkg({ id: 'example.hooks', name: 'Hooks', version: '1', defaultEnabled: true, capabilities: ['terminal-command-hook'], contributes: { terminalCommandHooks: [{ id: 'append.session', match: '^tool(?:\\s|$)', appendArgs: '--workspace ${name}' }] } });
    const appSettings = settings([dir]);
    await loadExtensions(appSettings);
    expect(await transformTerminalInput(entry(getEnabledTerminalIntegrations(appSettings)), 'other\r', entry().snapshot)).toBe('other\r');

    const disabledSettings = settings([dir], ['example.hooks']);
    expect(await transformTerminalInput(entry(getEnabledTerminalIntegrations(disabledSettings)), 'tool\r', entry().snapshot)).toBe('tool\r');
  });

  it('awaits startup-source hooks before command resolution', async () => {
    const testEntry = entry([{ id: 'slow', async beforeShellCommand(command) { await new Promise((resolve) => setTimeout(resolve, 10)); return { command: `${command} --ready` }; } }]);

    await expect(runTerminalCommandHooks(testEntry, 'tool', testEntry.snapshot, { source: 'startup' })).resolves.toBe('tool --ready');
  });
});
