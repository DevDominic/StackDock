import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StackDockSettings } from '../src/shared/types';
import { loadExtensions, resolveExtensionAsset } from '../electron/extensionService';

let tempDirs: string[] = [];
async function pkg(manifest: unknown) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-ext-')); tempDirs.push(dir); await fs.writeFile(path.join(dir, 'stackdock.extension.json'), JSON.stringify(manifest)); await fs.writeFile(path.join(dir, 'index.html'), '<h1>ok</h1>'); return dir; }
function settings(paths: string[]): StackDockSettings { return { themeId: 'x', importedThemes: [], confirmBeforeDiscard: true, emptySessionsVisible: false, showSessionCwdForAll: false, gitRefreshIntervalSeconds: 0, autoSave: true, autoSaveDelayMs: 1000, openLinksExternally: false, captureTerminalBrowserOpens: true, capturedLinkOpenMode: 'tab' as const, ui: { fontFamily: 'sans', fontSize: 13 }, code: { ligatures: true }, editor: { fontSize: 13, fontFamily: 'mono', tabSize: 2, wordWrap: 'off' }, terminal: { fontSize: 13, fontFamily: 'mono', cursorBlink: true, startAtBottom: false, markdownFormatting: true }, terminalProfiles: [], extensions: { localPackagePaths: paths, enabled: [], disabled: [], config: {} }, workspaceViewState: { sessionsVisible: true, visibleActivityViewIds: [] }, keybinds: {} }; }
afterEach(async () => { await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))); tempDirs = []; });

describe('extensionService', () => {
  it('loads a valid local manifest', async () => {
    const dir = await pkg({ id: 'example.ok', name: 'OK', version: '1.0.0', contributes: { views: [{ id: 'example.ok.view', title: 'OK', location: 'activity', entry: 'index.html' }] } });
    const result = await loadExtensions(settings([dir]));
    expect(result.errors).toEqual([]);
    expect(result.extensions.some((item) => item.id === 'example.ok')).toBe(true);
    expect(resolveExtensionAsset('example.ok', '/index.html')).toBe(path.join(dir, 'index.html'));
  });
  it('reports invalid ids and traversal entries', async () => {
    const badId = await pkg({ id: '../bad', name: 'Bad', version: '1' });
    const traversal = await pkg({ id: 'example.traversal', name: 'Bad', version: '1', contributes: { views: [{ id: 'v', title: 'v', location: 'activity', entry: '../x.html' }] } });
    const result = await loadExtensions(settings([badId, traversal]));
    expect(result.errors).toHaveLength(2);
  });
  it('rejects duplicate extension ids', async () => {
    const a = await pkg({ id: 'example.dup', name: 'A', version: '1' });
    const b = await pkg({ id: 'example.dup', name: 'B', version: '1' });
    const result = await loadExtensions(settings([a, b]));
    expect(result.errors).toHaveLength(1);
  });

  it('loads valid terminal command hook contributions', async () => {
    const dir = await pkg({ id: 'example.hooks', name: 'Hooks', version: '1', capabilities: ['terminal-command-hook'], contributes: { terminalCommandHooks: [{ id: 'append.session', match: '^tool(?:\\s|$)', sources: ['interactive'], appendArgs: '--workspace ${name}' }] } });
    const result = await loadExtensions(settings([dir]));
    const manifest = result.extensions.find((item) => item.id === 'example.hooks');
    expect(result.errors).toEqual([]);
    expect(manifest?.contributes?.terminalCommandHooks).toEqual([{ id: 'append.session', match: '^tool(?:\\s|$)', sources: ['interactive'], appendArgs: '--workspace ${name}', description: undefined }]);
  });

  it('rejects invalid terminal command hook contributions', async () => {
    const noCapability = await pkg({ id: 'example.no-cap', name: 'No Cap', version: '1', contributes: { terminalCommandHooks: [{ id: 'hook', match: '^tool', appendArgs: '--x' }] } });
    const badRegex = await pkg({ id: 'example.bad-regex', name: 'Bad Regex', version: '1', capabilities: ['terminal-command-hook'], contributes: { terminalCommandHooks: [{ id: 'hook', match: '[', appendArgs: '--x' }] } });
    const badSource = await pkg({ id: 'example.bad-source', name: 'Bad Source', version: '1', capabilities: ['terminal-command-hook'], contributes: { terminalCommandHooks: [{ id: 'hook', match: '^tool', sources: ['unknown'], appendArgs: '--x' }] } });
    const badTemplate = await pkg({ id: 'example.bad-template', name: 'Bad Template', version: '1', capabilities: ['terminal-command-hook'], contributes: { terminalCommandHooks: [{ id: 'hook', match: '^tool', appendArgs: '${env.HOME}' }] } });
    const result = await loadExtensions(settings([noCapability, badRegex, badSource, badTemplate]));
    expect(result.errors).toHaveLength(4);
    expect(result.errors.map((item) => item.message).join('\n')).toContain('terminal-command-hook');
    expect(result.errors.map((item) => item.message).join('\n')).toContain('Invalid terminalCommandHook.match regex');
    expect(result.errors.map((item) => item.message).join('\n')).toContain('Unknown terminalCommandHook source unknown');
    expect(result.errors.map((item) => item.message).join('\n')).toContain('Unsupported terminalCommandHook template variable env.HOME');
  });
});
