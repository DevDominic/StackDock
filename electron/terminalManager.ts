import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as pty from 'node-pty';
import { Terminal as HeadlessTerminal, type ITerminalAddon as HeadlessTerminalAddon } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { buildRestoredScrollbackBarrier, sanitizeSnapshotReplay, trimSnapshotOutput } from '../src/shared/terminalSnapshot';
import { resolveTerminalStartupCommand } from '../src/shared/terminalProfiles';
import type { TerminalPersistedState, TerminalPersistedTab, TerminalProfile, TerminalResumeState, TerminalSession, TerminalSessionContext, TerminalSessionUpdate, TerminalSnapshot } from '../src/shared/types';
import { getDefaultSettings, loadSettings } from './configStore';
import { ensureDataDirs, getTerminalSnapshotsDir, getTerminalStatePath } from './storage';
import { getBridgeEnv } from './browserBridge';
import type { TerminalCommandIntegration, TerminalCommandSource } from './terminalIntegration';
import { applyTerminalInputResumeState, runTerminalCommandHooks, transformTerminalInput } from './terminalInput';
import { getEnabledTerminalIntegrations } from '../extensions/mainRegistry';
import { ensureExtensionsLoaded } from './extensionService';

interface HeadlessProcessEntry {
  session: TerminalSession;
  context?: TerminalSessionContext;
  process: ChildProcessWithoutNullStreams | null;
  output: string;
  timer: NodeJS.Timeout | null;
  timedOut: boolean;
  resultSent: boolean;
}

interface RecordEntry {
  session: TerminalSession;
  context?: TerminalSessionContext;
  terminal: pty.IPty;
  pendingData: string[];
  flushTimer: NodeJS.Timeout | null;
  pendingStartupCommand: { command: string; timer: NodeJS.Timeout } | null;
  pendingRestoreBarrier: { resumeCommand?: string } | null;
  terminalIntegrations: TerminalCommandIntegration[];
  inputLine: string;
  inputWriteQueue: Promise<void>;
  // Shadow terminal that interprets every pty byte so snapshots can persist the
  // *rendered* buffer instead of the raw stream. Full-screen terminal apps
  // emit absolute-cursor repaint frames that only replay correctly into a
  // terminal with identical geometry and parser state; the serialized buffer
  // renders cleanly anywhere.
  headless: HeadlessTerminal;
  serializeAddon: SerializeAddon;
  recentOutput: string;
  headlessDisposed: boolean;
  discardSnapshot: boolean;
  headlessOutput: string;
  headlessTimer: NodeJS.Timeout | null;
  headlessTimedOut: boolean;
  headlessResultSent: boolean;
}

const terminals = new Map<string, RecordEntry>();
const headlessProcesses = new Map<string, HeadlessProcessEntry>();
const runtimeToRestore = new Map<string, string>();
const snapshots = new Map<string, TerminalSnapshot>();
const snapshotWriteTimers = new Map<string, NodeJS.Timeout>();
let visibleTerminalIds = new Set<string>();
let mainWindow: Electron.BrowserWindow | null = null;

const MAX_SNAPSHOT_BYTES = 512 * 1024;
const SNAPSHOT_SCROLLBACK_LINES = 2000;
const SPAWN_COLS = 120;
const SPAWN_ROWS = 30;
const VISIBLE_TERMINAL_OUTPUT_FLUSH_MS = 16;
const HIDDEN_TERMINAL_OUTPUT_FLUSH_MS = 250;
const HEADLESS_TIMEOUT_MS = 10 * 60 * 1000;
const HEADLESS_OUTPUT_MAX_BYTES = 128 * 1024;
const HEADLESS_TOAST_MAX_CHARS = 4000;
function snapshotPath(restoreId: string) {
  return path.join(getTerminalSnapshotsDir(), `${restoreId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}


// Waits for the headless terminal to finish parsing queued writes (an empty
// write's callback runs in order), then serializes the buffer.
function serializeEntrySnapshot(entry: RecordEntry): Promise<string> {
  if (entry.headlessDisposed) return Promise.resolve('');
  return new Promise((resolve) => {
    try {
      entry.headless.write('', () => {
        try {
          resolve(entry.serializeAddon.serialize({ scrollback: SNAPSHOT_SCROLLBACK_LINES }));
        } catch {
          resolve('');
        }
      });
    } catch {
      resolve('');
    }
  });
}

function ensureSnapshotRecord(entry: RecordEntry): TerminalSnapshot {
  const session = entry.session;
  const restoreId = session.restoreId ?? session.id;
  const snapshot = snapshots.get(restoreId) ?? { id: session.id, restoreId, output: '', updatedAt: new Date().toISOString(), resumeState: session.resumeState };
  snapshot.id = session.id;
  snapshot.resumeState = session.resumeState ?? snapshot.resumeState;
  snapshots.set(restoreId, snapshot);
  snapshots.set(session.id, snapshot);
  return snapshot;
}

async function persistEntrySnapshot(entry: RecordEntry) {
  if (entry.discardSnapshot) return;
  const snapshot = ensureSnapshotRecord(entry);
  if (!snapshot.restoreId) return;
  const output = await serializeEntrySnapshot(entry);
  if (output) {
    snapshot.output = trimSnapshotOutput(output, MAX_SNAPSHOT_BYTES);
    snapshot.updatedAt = new Date().toISOString();
  }
  await ensureDataDirs().then(() => fsp.writeFile(snapshotPath(snapshot.restoreId!), JSON.stringify(snapshot, null, 2), 'utf8')).catch(() => undefined);
}

function scheduleSnapshotWrite(entry: RecordEntry) {
  const restoreId = entry.session.restoreId ?? entry.session.id;
  const existing = snapshotWriteTimers.get(restoreId);
  if (existing) clearTimeout(existing);
  snapshotWriteTimers.set(restoreId, setTimeout(() => {
    snapshotWriteTimers.delete(restoreId);
    void persistEntrySnapshot(entry);
  }, 250));
}

export async function flushTerminalSnapshots() {
  for (const timer of snapshotWriteTimers.values()) clearTimeout(timer);
  snapshotWriteTimers.clear();
  for (const entry of terminals.values()) {
    if (entry.pendingData.length) flushTerminalOutput(entry);
  }
  await Promise.all([...terminals.values()].map((entry) => persistEntrySnapshot(entry)));
}

function applyResumeState(session: TerminalSession, snapshot: TerminalSnapshot, resumeState: TerminalResumeState | undefined) {
  applyTerminalInputResumeState(session, snapshot, resumeState);
}

function hydrateSnapshotResumeState(snapshot: TerminalSnapshot, terminalIntegrations: TerminalCommandIntegration[]) {
  if (snapshot.resumeState) return;
  for (const integration of terminalIntegrations) {
    const resumeState = integration.detectSnapshotResumeState?.({ snapshot });
    if (resumeState) {
      snapshot.resumeState = resumeState;
      return;
    }
  }
}

async function resolveIntegratedStartupCommand(command: string | undefined, restoreId: string, cwd: string, name: string | undefined, terminalIntegrations: TerminalCommandIntegration[]) {
  if (!command) return { command: undefined as string | undefined, resumeState: undefined as TerminalResumeState | undefined };
  for (const integration of terminalIntegrations) {
    const result = await integration.resolveStartupCommand?.(command, { restoreId, cwd, name });
    if (result) return { command: result.command, resumeState: result.resumeState };
  }
  return { command, resumeState: undefined as TerminalResumeState | undefined };
}

function buildResumeCommandResult(session: TerminalSession, snapshot: TerminalSnapshot | null | undefined, terminalIntegrations: TerminalCommandIntegration[]) {
  for (const integration of terminalIntegrations) {
    const command = integration.buildResumeCommand?.({ session, snapshot });
    if (command === null) return { command: undefined as string | undefined, suppressed: true };
    if (command) return { command, suppressed: false };
  }
  return { command: session.resumeState?.resumeCommand ?? snapshot?.resumeState?.resumeCommand, suppressed: false };
}


async function refreshTerminalIntegrations(entry: RecordEntry) {
  const settings = await loadSettings().catch(() => getDefaultSettings());
  await ensureExtensionsLoaded(settings);
  entry.terminalIntegrations = getEnabledTerminalIntegrations(settings);
}

function integrationOwnsCommand(command: string | undefined, terminalIntegrations: TerminalCommandIntegration[]) {
  return !!command && terminalIntegrations.some((integration) => integration.ownsCommand?.(command));
}

function terminalPersistedTab(entry: RecordEntry, terminalIntegrations: TerminalCommandIntegration[]): TerminalPersistedTab {
  const restoreId = entry.session.restoreId ?? entry.session.id;
  const snapshot = snapshots.get(restoreId);
  if (snapshot) hydrateSnapshotResumeState(snapshot, terminalIntegrations);
  const resumeCommandResult = buildResumeCommandResult(entry.session, snapshot, terminalIntegrations);
  const resumeState = resumeCommandResult.suppressed ? undefined : entry.session.resumeState ?? snapshot?.resumeState;
  const suppressIntegratedStartup = !resumeCommandResult.command && integrationOwnsCommand(entry.session.startupCommand, terminalIntegrations);
  return {
    ...entry.session,
    ...entry.context,
    startupCommand: suppressIntegratedStartup ? undefined : entry.session.startupCommand,
    resumeState,
    resumeStartupCommand: resumeCommandResult.command ?? '',
    lastActiveAt: new Date().toISOString(),
  };
}

export async function saveOpenTerminalState(): Promise<TerminalPersistedState> {
  await flushTerminalSnapshots();
  const settings = await loadSettings().catch(() => getDefaultSettings());
  await ensureExtensionsLoaded(settings);
  const terminalIntegrations = getEnabledTerminalIntegrations(settings);
  const state: TerminalPersistedState = { version: 1, savedAt: new Date().toISOString(), tabs: [...terminals.values()].map((entry) => terminalPersistedTab(entry, terminalIntegrations)) };
  await ensureDataDirs();
  await fsp.writeFile(getTerminalStatePath(), JSON.stringify(state, null, 2), 'utf8');
  return state;
}

export async function loadOpenTerminalState(): Promise<TerminalPersistedState | null> {
  const statePath = getTerminalStatePath();
  try {
    const parsed = JSON.parse(await fsp.readFile(statePath, 'utf8')) as TerminalPersistedState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.tabs)) return null;
    // Delete after reading so a crash before clean shutdown won't replay stale tabs.
    await fsp.unlink(statePath).catch(() => undefined);
    return parsed;
  } catch {
    return null;
  }
}

function updateSnapshot(entry: RecordEntry, data: string) {
  const session = entry.session;
  if (!entry.headlessDisposed) entry.headless.write(data);
  // Rolling raw tail lets extensions match resume hints across chunk boundaries
  // even though the snapshot itself is now the serialized buffer.
  entry.recentOutput = (entry.recentOutput + data).slice(-4096);
  const snapshot = ensureSnapshotRecord(entry);
  for (const integration of entry.terminalIntegrations) {
    applyResumeState(session, snapshot, integration.captureResumeState?.({ data, recentOutput: entry.recentOutput, session, snapshot }));
  }
  snapshot.updatedAt = new Date().toISOString();
  scheduleSnapshotWrite(entry);
}

function isTerminalVisible(entry: RecordEntry) {
  return visibleTerminalIds.has(entry.session.id);
}

// Startup commands are held until the renderer has replayed the restored
// snapshot and calls terminal.ready (or a fallback timeout for tabs restored in
// the background). Full-screen terminal apps paint their first frame immediately;
// launching them before the real-geometry restore barrier is serialized lets
// absolute cursor repaints overwrite restored history.
function applyPendingRestoreBarrier(entry: RecordEntry) {
  const pending = entry.pendingRestoreBarrier;
  if (!pending || entry.headlessDisposed) return;
  entry.pendingRestoreBarrier = null;
  entry.headless.write(buildRestoredScrollbackBarrier(entry.headless.rows, pending.resumeCommand));
}

async function writeCommandThroughHooks(entry: RecordEntry, command: string, source: TerminalCommandSource) {
  const snapshot = ensureSnapshotRecord(entry);
  const resolved = await runTerminalCommandHooks(entry, command, snapshot, { source });
  if (terminals.has(entry.session.id)) entry.terminal.write(`${resolved}\r`);
}

async function flushPendingStartupCommand(entry: RecordEntry) {
  const pending = entry.pendingStartupCommand;
  if (!pending) return;
  entry.pendingStartupCommand = null;
  clearTimeout(pending.timer);
  applyPendingRestoreBarrier(entry);
  await writeCommandThroughHooks(entry, pending.command, entry.session.restoredFromSnapshot ? 'resume' : 'startup');
}

function cancelPendingStartupCommand(entry: RecordEntry) {
  if (!entry.pendingStartupCommand) return;
  clearTimeout(entry.pendingStartupCommand.timer);
  entry.pendingStartupCommand = null;
}

function flushTerminalOutput(entry: RecordEntry) {
  if (entry.flushTimer) {
    clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
  }
  if (!entry.pendingData.length) return;
  const data = entry.pendingData.join('');
  entry.pendingData = [];
  updateSnapshot(entry, data);
  if (entry.context?.headless) mainWindow?.webContents.send('terminal:headlessData', { id: entry.session.id, data });
  mainWindow?.webContents.send('terminal:data', { id: entry.session.id, data });
}

function queueTerminalOutput(entry: RecordEntry, data: string) {
  if (entry.context?.headless) entry.headlessOutput = (entry.headlessOutput + data).slice(-HEADLESS_OUTPUT_MAX_BYTES);
  entry.pendingData.push(data);
  if (entry.flushTimer) return;
  const flushMs = isTerminalVisible(entry) ? VISIBLE_TERMINAL_OUTPUT_FLUSH_MS : HIDDEN_TERMINAL_OUTPUT_FLUSH_MS;
  entry.flushTimer = setTimeout(() => flushTerminalOutput(entry), flushMs);
}

export function setTerminalWindow(window: Electron.BrowserWindow | null) {
  mainWindow = window;
}

export function setVisibleTerminals(ids: string[]) {
  const nextVisibleTerminalIds = new Set(ids);
  const becameVisible = ids.filter((id) => !visibleTerminalIds.has(id));
  visibleTerminalIds = nextVisibleTerminalIds;
  for (const id of becameVisible) {
    const entry = terminals.get(id);
    if (entry?.pendingData.length) flushTerminalOutput(entry);
  }
}

export async function getTerminalProfiles(): Promise<TerminalProfile[]> {
  return (await loadSettings()).terminalProfiles;
}

async function resolveShell(profileId: string) {
  const profiles = await getTerminalProfiles().catch(() => getDefaultSettings().terminalProfiles);
  return profiles.find((profile) => profile.id === profileId) ?? profiles[0];
}

function resolveCwd(cwd: string) {
  try {
    return fs.existsSync(cwd) ? cwd : process.cwd();
  } catch {
    return process.cwd();
  }
}

function stripAnsi(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim();
}

function isExitEchoLine(line: string) {
  const trimmed = line.trim();
  return trimmed === 'exit' || /^(?:PS\s+)?[A-Za-z]:[\\/].*>\s*exit$/i.test(trimmed);
}

function cleanHeadlessOutput(value: string, command: string) {
  let output = value;
  if (command) {
    const exactIndex = output.lastIndexOf(command);
    const prefixIndex = exactIndex < 0 ? output.lastIndexOf(command.slice(0, Math.min(command.length, 80))) : -1;
    const commandIndex = exactIndex >= 0 ? exactIndex : prefixIndex;
    if (commandIndex >= 0) output = output.slice(commandIndex + (exactIndex >= 0 ? command.length : 0));
  }
  return output
    .split('\n')
    .filter((line, index) => !(index === 0 && !line.trim()))
    .filter((line) => !isExitEchoLine(line))
    .join('\n')
    .trim();
}

function truncateHeadlessOutput(value: string) {
  if (value.length <= HEADLESS_TOAST_MAX_CHARS) return value;
  return `${value.slice(0, HEADLESS_TOAST_MAX_CHARS - 1)}…`;
}

function wrapHeadlessStartupCommand(command: string, shell: string) {
  const shellName = path.basename(shell).toLowerCase();
  const suppressEcho = shellName === 'cmd.exe' || shellName === 'cmd' ? '@echo off\r\n' : '';
  return `${suppressEcho}${command}\r\nexit\r\n`;
}

function headlessSpawnArgs(profile: TerminalProfile, command: string) {
  const shellName = path.basename(profile.shell).toLowerCase();
  if (shellName === 'powershell.exe' || shellName === 'powershell' || shellName === 'pwsh.exe' || shellName === 'pwsh') {
    const args = profile.args.filter((arg) => !/^-NoExit$/i.test(arg));
    const hasNoLogo = args.some((arg) => /^-NoLogo$/i.test(arg));
    const hasNoProfile = args.some((arg) => /^-NoProfile$/i.test(arg));
    return [...(hasNoLogo ? [] : ['-NoLogo']), ...(hasNoProfile ? [] : ['-NoProfile']), ...args, '-Command', command];
  }
  if (shellName === 'cmd.exe' || shellName === 'cmd') return ['/d', '/s', '/c', command];
  if (shellName === 'bash.exe' || shellName === 'bash' || shellName === 'zsh' || shellName === 'sh') return ['-lc', command];
  return null;
}

function appendHeadlessProcessOutput(entry: HeadlessProcessEntry, data: string) {
  entry.output = (entry.output + data).slice(-HEADLESS_OUTPUT_MAX_BYTES);
  mainWindow?.webContents.send('terminal:headlessData', { id: entry.session.id, data });
}

function sendHeadlessProcessResult(entry: HeadlessProcessEntry, exitCode: number | null) {
  if (entry.resultSent) return;
  entry.resultSent = true;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const output = truncateHeadlessOutput(cleanHeadlessOutput(stripAnsi(entry.output), entry.session.startupCommand ?? ''));
  headlessProcesses.delete(entry.session.id);
  runtimeToRestore.delete(entry.session.id);
  mainWindow?.webContents.send('terminal:headlessResult', {
    id: entry.session.id,
    label: entry.context?.commandLabel ?? entry.session.name,
    command: entry.session.startupCommand ?? '',
    output,
    exitCode,
    timedOut: entry.timedOut || undefined,
  });
}

function runHeadlessProcess(session: TerminalSession, profile: TerminalProfile, command: string | undefined, cwd: string, context?: TerminalSessionContext, env?: Record<string, string>) {
  const entry: HeadlessProcessEntry = { session, context, process: null, output: '', timer: null, timedOut: false, resultSent: false };
  headlessProcesses.set(session.id, entry);
  runtimeToRestore.set(session.id, session.restoreId!);
  if (!command) {
    setTimeout(() => sendHeadlessProcessResult(entry, 0), 0);
    return;
  }
  try {
    const directArgs = headlessSpawnArgs(profile, command);
    const child = spawn(profile.shell, directArgs ?? profile.args, {
      cwd,
      env: { ...(process.env as Record<string, string>), STACKDOCK: '1', STACKDOCK_TERMINAL: '1', ...env },
      windowsHide: true,
      stdio: 'pipe',
    });
    entry.process = child;
    child.stdout.on('data', (data) => appendHeadlessProcessOutput(entry, data.toString()));
    child.stderr.on('data', (data) => appendHeadlessProcessOutput(entry, data.toString()));
    child.on('error', (error) => {
      appendHeadlessProcessOutput(entry, `${error.message}\n`);
      sendHeadlessProcessResult(entry, null);
    });
    child.on('exit', (exitCode) => sendHeadlessProcessResult(entry, exitCode));
    entry.timer = setTimeout(() => {
      entry.timedOut = true;
      sendHeadlessProcessResult(entry, null);
      child.kill();
    }, HEADLESS_TIMEOUT_MS);
    child.stdin.on('error', (error) => {
      appendHeadlessProcessOutput(entry, `${error.message}\n`);
      sendHeadlessProcessResult(entry, null);
    });
    if (directArgs) child.stdin.end();
    else child.stdin.end(wrapHeadlessStartupCommand(command, profile.shell));
  } catch (error) {
    appendHeadlessProcessOutput(entry, `${(error as Error).message}\n`);
    sendHeadlessProcessResult(entry, null);
  }
}

function sendHeadlessResult(entry: RecordEntry, exitCode: number | null) {
  if (!entry.context?.headless || entry.headlessResultSent) return;
  entry.headlessResultSent = true;
  if (entry.headlessTimer) {
    clearTimeout(entry.headlessTimer);
    entry.headlessTimer = null;
  }
  const output = truncateHeadlessOutput(cleanHeadlessOutput(stripAnsi(entry.headlessOutput), entry.session.startupCommand ?? ''));
  mainWindow?.webContents.send('terminal:headlessResult', {
    id: entry.session.id,
    label: entry.context.commandLabel ?? entry.session.name,
    command: entry.session.startupCommand ?? '',
    output,
    exitCode,
    timedOut: entry.headlessTimedOut || undefined,
  });
}

export async function createTerminal(profileId: string, cwd: string, name?: string, startupCommand?: string, restoreId?: string, context?: TerminalSessionContext): Promise<TerminalSession> {
  const settings = await loadSettings().catch(() => getDefaultSettings());
  await ensureExtensionsLoaded(settings);
  const profile = settings.terminalProfiles.find((item) => item.id === profileId) ?? settings.terminalProfiles[0] ?? getDefaultSettings().terminalProfiles[0];
  const terminalIntegrations = getEnabledTerminalIntegrations(settings);
  const resolvedCwd = resolveCwd(cwd);
  const stableRestoreId = restoreId || `restore_${crypto.randomUUID()}`;
  const effectiveStartupCommand = resolveTerminalStartupCommand({ explicitStartupCommand: startupCommand, profileStartupCommand: profile.startupCommand });
  const resolvedStartupCommand = await resolveIntegratedStartupCommand(effectiveStartupCommand, stableRestoreId, resolvedCwd, name || profile.name, terminalIntegrations);
  const normalizedStartupCommand = resolvedStartupCommand.command;
  const session: TerminalSession = {
    id: `term_${crypto.randomUUID()}`,
    restoreId: stableRestoreId,
    name: name || profile.name,
    profileId: profile.id,
    cwd: resolvedCwd,
    startupCommand: normalizedStartupCommand,
    resumeState: resolvedStartupCommand.resumeState,
    restoredFromSnapshot: Boolean(restoreId),
    createdAt: new Date().toISOString(),
  };

  const bridgeEnv = settings.captureTerminalBrowserOpens ? getBridgeEnv(session.id) : {};

  if (context?.headless) {
    runHeadlessProcess(session, profile, normalizedStartupCommand, resolvedCwd, context, bridgeEnv);
    return session;
  }

  const terminal = pty.spawn(profile.shell, profile.args, {
    name: 'xterm-256color',
    cols: SPAWN_COLS,
    rows: SPAWN_ROWS,
    cwd: resolvedCwd,
    env: { ...(process.env as Record<string, string>), STACKDOCK: '1', STACKDOCK_TERMINAL: '1', ...bridgeEnv },
    // Avoid node-pty's Windows kill-path helper (`conpty_console_list_agent`),
    // which can print noisy "AttachConsole failed" errors when Electron exits.
    ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
  });

  runtimeToRestore.set(session.id, session.restoreId!);
  const priorSnapshot = await getTerminalSnapshot(session.restoreId!).catch(() => null);
  const headless = new HeadlessTerminal({ cols: SPAWN_COLS, rows: SPAWN_ROWS, scrollback: SNAPSHOT_SCROLLBACK_LINES, allowProposedApi: true });
  const serializeAddon = new SerializeAddon();
  headless.loadAddon(serializeAddon as unknown as HeadlessTerminalAddon);
  const restoreResumeCommand = session.restoredFromSnapshot && priorSnapshot?.output ? buildResumeCommandResult(session, priorSnapshot, terminalIntegrations) : null;
  const pendingRestoreBarrier = session.restoredFromSnapshot && priorSnapshot?.output
    ? { resumeCommand: restoreResumeCommand?.command ?? (!restoreResumeCommand?.suppressed && integrationOwnsCommand(normalizedStartupCommand, terminalIntegrations) ? normalizedStartupCommand : undefined) }
    : null;
  if (session.restoredFromSnapshot && priorSnapshot?.output) {
    // Seed only the previous session's rendered buffer at spawn geometry. The
    // separator, blank viewport, and homed cursor are applied after the first
    // real resize so tall windows cannot pull old scrollback back into the live
    // repaint area.
    headless.write(`${priorSnapshot.output}\x1b[0m`);
  }
  const entry: RecordEntry = { session, context, terminal, pendingData: [], flushTimer: null, pendingStartupCommand: null, pendingRestoreBarrier, terminalIntegrations, inputLine: '', inputWriteQueue: Promise.resolve(), headless, serializeAddon, recentOutput: '', headlessDisposed: false, discardSnapshot: context?.headless === true, headlessOutput: '', headlessTimer: null, headlessTimedOut: false, headlessResultSent: false };
  terminal.onData((data) => queueTerminalOutput(entry, data));
  terminal.onExit(({ exitCode }) => {
    cancelPendingStartupCommand(entry);
    flushTerminalOutput(entry);
    if (context?.headless) sendHeadlessResult(entry, exitCode);
    else mainWindow?.webContents.send('terminal:exit', { id: session.id, exitCode });
    terminals.delete(session.id);
    runtimeToRestore.delete(session.id);
    void persistEntrySnapshot(entry).finally(() => {
      entry.headlessDisposed = true;
      entry.headless.dispose();
    });
  });

  terminals.set(session.id, entry);
  if (context?.headless && normalizedStartupCommand) {
    entry.headlessTimer = setTimeout(() => {
      entry.headlessTimedOut = true;
      entry.discardSnapshot = true;
      sendHeadlessResult(entry, null);
      terminal.kill();
    }, HEADLESS_TIMEOUT_MS);
    const snapshot = ensureSnapshotRecord(entry);
    const resolvedHeadlessCommand = await runTerminalCommandHooks(entry, normalizedStartupCommand, snapshot, { source: 'headless', shell: profile.shell });
    terminal.write(wrapHeadlessStartupCommand(resolvedHeadlessCommand, profile.shell));
  } else if (context?.headless) {
    sendHeadlessResult(entry, 0);
    terminal.kill();
  } else if (normalizedStartupCommand) {
    entry.pendingStartupCommand = {
      command: normalizedStartupCommand,
      timer: setTimeout(() => void flushPendingStartupCommand(entry), 3000),
    };
  }
  return session;
}

export function updateTerminalSession(id: string, patch: TerminalSessionUpdate): TerminalSession {
  const entry = terminals.get(id) ?? [...terminals.values()].find((candidate) => candidate.session.restoreId === id);
  if (!entry) throw new Error('Terminal not found');
  if (patch.name !== undefined) entry.session.name = patch.name.trim();
  if (patch.splitGroupId !== undefined) {
    if (patch.splitGroupId === null) delete entry.session.splitGroupId;
    else entry.session.splitGroupId = patch.splitGroupId;
  }
  if (patch.splitDirection !== undefined) {
    if (patch.splitDirection === null) delete entry.session.splitDirection;
    else entry.session.splitDirection = patch.splitDirection;
  }
  if (patch.splitGroupOrder !== undefined) {
    if (patch.splitGroupOrder === null) delete entry.session.splitGroupOrder;
    else entry.session.splitGroupOrder = patch.splitGroupOrder;
  }
  return entry.session;
}

export async function writeTerminal(id: string, data: string) {
  const entry = terminals.get(id);
  if (!entry) return;
  const priorQueue = entry.inputWriteQueue.catch(() => undefined);
  const nextQueue = priorQueue.then(async () => {
    if (data.includes('\r') || data.includes('\n')) await refreshTerminalIntegrations(entry);
    entry.terminal.write(await transformTerminalInput(entry, data, ensureSnapshotRecord(entry)));
  });
  entry.inputWriteQueue = nextQueue.catch(() => undefined);
  await nextQueue;
}

export async function resizeTerminal(id: string, cols: number, rows: number) {
  const entry = terminals.get(id);
  if (!entry) return;
  const safeCols = Math.max(2, cols);
  const safeRows = Math.max(1, rows);
  entry.terminal.resize(safeCols, safeRows);
  if (!entry.headlessDisposed) {
    entry.headless.resize(safeCols, safeRows);
    applyPendingRestoreBarrier(entry);
  }
}

export async function markTerminalReady(id: string) {
  const entry = terminals.get(id);
  if (entry) await flushPendingStartupCommand(entry);
}

export async function killTerminal(id: string, preserveSnapshot = false) {
  const headlessEntry = headlessProcesses.get(id);
  if (headlessEntry) {
    if (headlessEntry.timer) {
      clearTimeout(headlessEntry.timer);
      headlessEntry.timer = null;
    }
    headlessEntry.process?.kill();
    sendHeadlessProcessResult(headlessEntry, null);
    if (!preserveSnapshot) await forgetTerminalSnapshot(headlessEntry.session.restoreId ?? id);
    return;
  }
  const entry = terminals.get(id);
  const restoreId = entry?.session.restoreId ?? runtimeToRestore.get(id) ?? id;
  if (entry) {
    cancelPendingStartupCommand(entry);
    if (entry.headlessTimer) {
      clearTimeout(entry.headlessTimer);
      entry.headlessTimer = null;
    }
    if (preserveSnapshot) flushTerminalOutput(entry);
    else {
      entry.discardSnapshot = true;
      if (entry.flushTimer) clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
      entry.pendingData = [];
    }
    entry.terminal.kill();
  }
  terminals.delete(id);
  runtimeToRestore.delete(id);
  if (!preserveSnapshot) await forgetTerminalSnapshot(restoreId);
}

export async function getTerminalSnapshot(idOrRestoreId: string): Promise<TerminalSnapshot | null> {
  const restoreId = runtimeToRestore.get(idOrRestoreId) ?? idOrRestoreId;
  const entry = terminals.get(idOrRestoreId) ?? [...terminals.values()].find((candidate) => candidate.session.restoreId === restoreId);
  if (entry) {
    // Live session: serialize the headless buffer so the caller gets the
    // current rendered state rather than a stale or raw-stream snapshot.
    if (entry.pendingData.length) flushTerminalOutput(entry);
    const snapshot = ensureSnapshotRecord(entry);
    const output = await serializeEntrySnapshot(entry);
    if (output) {
      snapshot.output = trimSnapshotOutput(output, MAX_SNAPSHOT_BYTES);
      snapshot.updatedAt = new Date().toISOString();
    }
    hydrateSnapshotResumeState(snapshot, entry.terminalIntegrations);
    return snapshot;
  }
  const settings = await loadSettings().catch(() => getDefaultSettings());
  await ensureExtensionsLoaded(settings);
  const terminalIntegrations = getEnabledTerminalIntegrations(settings);
  const existing = snapshots.get(idOrRestoreId) ?? snapshots.get(restoreId);
  if (existing) {
    existing.output = sanitizeSnapshotReplay(existing.output ?? '');
    hydrateSnapshotResumeState(existing, terminalIntegrations);
    return existing;
  }
  try {
    const parsed = JSON.parse(await fsp.readFile(snapshotPath(restoreId), 'utf8')) as TerminalSnapshot;
    parsed.output = sanitizeSnapshotReplay(parsed.output ?? '');
    hydrateSnapshotResumeState(parsed, terminalIntegrations);
    snapshots.set(restoreId, parsed);
    if (parsed.id) snapshots.set(parsed.id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function forgetTerminalSnapshot(idOrRestoreId: string) {
  const restoreId = runtimeToRestore.get(idOrRestoreId) ?? idOrRestoreId;
  snapshots.delete(idOrRestoreId);
  snapshots.delete(restoreId);
  const timer = snapshotWriteTimers.get(restoreId);
  if (timer) clearTimeout(timer);
  snapshotWriteTimers.delete(restoreId);
  await fsp.unlink(snapshotPath(restoreId)).catch(() => undefined);
}
