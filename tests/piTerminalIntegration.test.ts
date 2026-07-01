import { describe, expect, it, vi } from 'vitest';
import type { StackDockSettings, TerminalSession, TerminalSnapshot } from '../src/shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Users\\domin\\AppData\\Roaming' },
}));

import { createPiTerminalIntegration } from '../extensions/builtin/pi/main/terminalIntegration';
import { transformTerminalInput } from '../electron/terminalInput';

function settings(): StackDockSettings {
  return {
    themeId: 'x',
    importedThemes: [],
    confirmBeforeDiscard: true,
    emptySessionsVisible: false,
    showSessionCwdForAll: false,
    gitRefreshIntervalSeconds: 0,
    autoSave: true,
    autoSaveDelayMs: 1000,
    openLinksExternally: false,
    captureTerminalBrowserOpens: true,
    capturedLinkOpenMode: 'tab',
    ui: { fontFamily: 'sans', fontSize: 13 },
    code: { ligatures: true },
    editor: { fontSize: 13, fontFamily: 'mono', tabSize: 2, wordWrap: 'off' },
    terminal: { fontSize: 13, fontFamily: 'mono', cursorBlink: true, startAtBottom: true, markdownFormatting: true },
    terminalProfiles: [],
    extensions: { localPackagePaths: [], enabled: [], disabled: [], config: {} },
    workspaceViewState: { sessionsVisible: true, visibleActivityViewIds: [] },
    keybinds: {},
  };
}

describe('Pi terminal integration', () => {
  it('adds stable session id but no custom session dir by default', () => {
    const integration = createPiTerminalIntegration(settings());
    const result = integration.resolveStartupCommand?.('pi', { restoreId: 'restore_abc', cwd: 'C:\\repo' });

    expect(result?.command).toContain('--session-id "stackdock.restore_abc"');
    expect(result?.command).not.toContain('--session-dir');
    expect(result?.resumeState?.storagePath).toBeUndefined();
  });

  it('adds StackDock session dir only when explicitly enabled', () => {
    const withSessionDir = settings();
    withSessionDir.extensions.config['stackdock.pi'] = { useStackDockSessionDir: true };
    const integration = createPiTerminalIntegration(withSessionDir);
    const result = integration.resolveStartupCommand?.('pi', { restoreId: 'restore_abc', cwd: 'C:\\repo' });

    expect(result?.command).toContain('--session-id "stackdock.restore_abc"');
    expect(result?.resumeState?.storagePath).toMatch(/[\\/]StackDock[\\/]extensions[\\/]stackdock\.pi[\\/]sessions$/);
    expect(result?.command).toContain(`--session-dir "${result?.resumeState?.storagePath}"`);
    expect(result?.command).not.toContain('C:\\\\Users');
  });

  it('adds stable session id to interactive pi flag invocations', () => {
    const integration = createPiTerminalIntegration(settings());
    const result = integration.resolveStartupCommand?.('pi -a', { restoreId: 'restore_abc', cwd: 'C:\\repo' });

    expect(result?.command).toBe('pi -a --session-id "stackdock.restore_abc"');
    expect(result?.resumeState?.sessionId).toBe('stackdock.restore_abc');
  });

  it('adds stable session id when pi is typed interactively', async () => {
    const integration = createPiTerminalIntegration(settings());
    const result = await integration.beforeShellCommand?.('pi -a', { source: 'interactive', restoreId: 'restore_abc', cwd: 'C:\\repo' });

    expect(result?.command).toBe('pi -a --session-id "stackdock.restore_abc"');
    expect(result?.resumeState?.sessionId).toBe('stackdock.restore_abc');
  });

  it('adds stable session id when startup pi passes through beforeShellCommand', async () => {
    const integration = createPiTerminalIntegration(settings());
    const result = await integration.beforeShellCommand?.('pi', { source: 'startup', restoreId: 'restore_abc', cwd: 'C:\\repo' });

    expect(result?.command).toBe('pi --session-id "stackdock.restore_abc"');
    expect(result?.resumeState?.sessionId).toBe('stackdock.restore_abc');
  });

  it('adds stable session id when interactive pi arrives in separate chunks', async () => {
    const integration = createPiTerminalIntegration(settings());
    const session = {
      id: 'term_1',
      restoreId: 'restore_abc',
      name: 'Terminal',
      profileId: 'powershell',
      cwd: 'C:\\repo',
      createdAt: '2026-06-14T00:00:00.000Z',
    } satisfies TerminalSession;
    const snapshot = { id: 'term_1', restoreId: 'restore_abc', output: '' } satisfies TerminalSnapshot;
    const entry = { session, terminalIntegrations: [integration], inputLine: '' };

    const output = (await transformTerminalInput(entry, 'p', snapshot))
      + (await transformTerminalInput(entry, 'i', snapshot))
      + (await transformTerminalInput(entry, '\r', snapshot));

    expect(output).toBe('pi --session-id "stackdock.restore_abc"\r');
    expect(session.resumeState?.sessionId).toBe('stackdock.restore_abc');
    expect(snapshot.resumeState?.sessionId).toBe('stackdock.restore_abc');
  });

  it('does not inject session args into pi subcommands', () => {
    const integration = createPiTerminalIntegration(settings());
    const command = 'pi install npm:gentle-engram@0.1.8';

    expect(integration.resolveStartupCommand?.(command, { restoreId: 'restore_abc', cwd: 'C:\\repo' })?.command).toBe(command);
  });

  it('does not resume pi when restored terminal is back at a shell prompt', () => {
    const integration = createPiTerminalIntegration(settings());
    const session = {
      id: 'term_1',
      restoreId: 'restore_abc',
      name: 'Terminal',
      profileId: 'powershell',
      cwd: 'C:\\repo',
      startupCommand: 'pi --session-id "stackdock.restore_abc"',
      resumeState: { integrationId: 'stackdock.pi', sessionId: 'stackdock.restore_abc', resumeCommand: 'pi --session-id "stackdock.restore_abc"' },
      createdAt: '2026-06-14T00:00:00.000Z',
    } satisfies TerminalSession;
    const snapshot = {
      id: 'term_1',
      restoreId: 'restore_abc',
      output: 'pi v1.2.3\nModel scope: repo\nTo resume this session: pi --session abc\nPS C:\\repo> ',
    } satisfies TerminalSnapshot;

    expect(integration.buildResumeCommand?.({ session, snapshot })).toBeUndefined();
  });

  it('resumes pi when restored snapshot still shows pi UI', () => {
    const integration = createPiTerminalIntegration(settings());
    const session = {
      id: 'term_1',
      restoreId: 'restore_abc',
      name: 'Pi',
      profileId: 'pi',
      cwd: 'C:\\repo',
      startupCommand: 'pi --session-id "stackdock.restore_abc"',
      resumeState: { integrationId: 'stackdock.pi', sessionId: 'stackdock.restore_abc', resumeCommand: 'pi --session-id "stackdock.restore_abc"' },
      createdAt: '2026-06-14T00:00:00.000Z',
    } satisfies TerminalSession;
    const snapshot = {
      id: 'term_1',
      restoreId: 'restore_abc',
      output: 'pi v1.2.3\nModel scope: repo\nMCP: 2/2\n> ',
    } satisfies TerminalSnapshot;

    expect(integration.buildResumeCommand?.({ session, snapshot })).toBe('pi --session-id "stackdock.restore_abc"');
  });

  it('can disable automatic resume of restored pi terminals', () => {
    const disabled = settings();
    disabled.extensions.config['stackdock.pi'] = { resumeRestoredTerminals: false };
    const integration = createPiTerminalIntegration(disabled);
    const session = {
      id: 'term_1',
      restoreId: 'restore_abc',
      name: 'Pi',
      profileId: 'pi',
      cwd: 'C:\\repo',
      startupCommand: 'pi --session-id "stackdock.restore_abc"',
      resumeState: { integrationId: 'stackdock.pi', sessionId: 'stackdock.restore_abc', resumeCommand: 'pi --session-id "stackdock.restore_abc"' },
      createdAt: '2026-06-14T00:00:00.000Z',
    } satisfies TerminalSession;
    const snapshot = {
      id: 'term_1',
      restoreId: 'restore_abc',
      output: 'pi v1.2.3\nModel scope: repo\nMCP: 2/2\n> ',
    } satisfies TerminalSnapshot;

    expect(integration.resolveStartupCommand?.('pi', { restoreId: 'restore_abc', cwd: 'C:\\repo' })?.command).toBe('pi');
    expect(integration.buildResumeCommand?.({ session, snapshot })).toBeNull();
    expect(integration.captureResumeState).toBeUndefined();
    expect(integration.detectSnapshotResumeState).toBeUndefined();
  });
});
