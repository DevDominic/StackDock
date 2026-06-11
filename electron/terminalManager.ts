import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import * as pty from 'node-pty';
import { Terminal as HeadlessTerminal, type ITerminalAddon as HeadlessTerminalAddon } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { sanitizeSnapshotReplay, trimSnapshotOutput } from '../src/shared/terminalSnapshot';
import { resolveTerminalStartupCommand } from '../src/shared/terminalProfiles';
import type { TerminalPersistedState, TerminalPersistedTab, TerminalProfile, TerminalSession, TerminalSessionContext, TerminalSnapshot } from '../src/shared/types';
import { getDefaultSettings, loadSettings } from './configStore';
import { ensureDataDirs, getTerminalSnapshotsDir, getTerminalStatePath } from './storage';
import { getBridgeEnv } from './browserBridge';

interface RecordEntry {
  session: TerminalSession;
  context?: TerminalSessionContext;
  terminal: pty.IPty;
  pendingData: string[];
  flushTimer: NodeJS.Timeout | null;
  pendingStartupCommand: { command: string; timer: NodeJS.Timeout } | null;
  // Shadow terminal that interprets every pty byte so snapshots can persist the
  // *rendered* buffer instead of the raw stream. TUI apps (pi, claude, codex)
  // emit absolute-cursor repaint frames that only replay correctly into a
  // terminal with identical geometry and parser state; the serialized buffer
  // renders cleanly anywhere.
  headless: HeadlessTerminal;
  serializeAddon: SerializeAddon;
  recentOutput: string;
  headlessDisposed: boolean;
  discardSnapshot: boolean;
}

const terminals = new Map<string, RecordEntry>();
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
const PI_RESUME_PATTERN = /To resume this session:\s*(pi\s+--session\s+([A-Za-z0-9_-]{8,128}))/i;
const PI_COMMAND_PATTERN = /^\s*pi(?:\s|$)/i;
const PI_TRACKED_ARG_PATTERN = /(?:^|\s)(?:--name\b|--session\b|-r\b|--resume\b|--continue\b)/i;
const SHELL_META_PATTERN = /[|&;<>]/;

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
  const snapshot = snapshots.get(restoreId) ?? { id: session.id, restoreId, output: '', updatedAt: new Date().toISOString(), piSessionId: session.piSessionId, piResumeCommand: session.piResumeCommand };
  snapshot.id = session.id;
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

function quoteArg(value: string) {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function stackDockPiSessionName(restoreId: string) {
  return `stackdock-${restoreId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function piCommandHasStableTarget(command: string) {
  return PI_TRACKED_ARG_PATTERN.test(command);
}

function normalizePiStartupCommand(command: string | undefined, restoreId: string) {
  const trimmed = command?.trim();
  if (!trimmed || !PI_COMMAND_PATTERN.test(trimmed) || SHELL_META_PATTERN.test(trimmed) || piCommandHasStableTarget(trimmed)) return command;
  return `${trimmed} --name ${quoteArg(stackDockPiSessionName(restoreId))}`;
}

function buildPiResumeCommand(session: TerminalSession, snapshot?: TerminalSnapshot | null) {
  const piResumeCommand = session.piResumeCommand ?? snapshot?.piResumeCommand;
  if (piResumeCommand) return piResumeCommand;
  const piSessionId = session.piSessionId ?? snapshot?.piSessionId;
  if (piSessionId) return `pi --session ${piSessionId}`;
  if (session.startupCommand && PI_COMMAND_PATTERN.test(session.startupCommand)) {
    if (piCommandHasStableTarget(session.startupCommand)) return session.startupCommand;
    return 'pi -r';
  }
  return undefined;
}

function terminalPersistedTab(entry: RecordEntry): TerminalPersistedTab {
  const restoreId = entry.session.restoreId ?? entry.session.id;
  const snapshot = snapshots.get(restoreId);
  const resumeStartupCommand = buildPiResumeCommand(entry.session, snapshot);
  return {
    ...entry.session,
    ...entry.context,
    piSessionId: entry.session.piSessionId ?? snapshot?.piSessionId,
    piResumeCommand: entry.session.piResumeCommand ?? snapshot?.piResumeCommand,
    resumeStartupCommand,
    lastActiveAt: new Date().toISOString(),
  };
}

export async function saveOpenTerminalState(): Promise<TerminalPersistedState> {
  await flushTerminalSnapshots();
  const state: TerminalPersistedState = { version: 1, savedAt: new Date().toISOString(), tabs: [...terminals.values()].map(terminalPersistedTab) };
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
  // Rolling raw tail so the resume-hint pattern still matches across chunk
  // boundaries even though the snapshot itself is now the serialized buffer.
  entry.recentOutput = (entry.recentOutput + data).slice(-4096);
  const snapshot = ensureSnapshotRecord(entry);
  const match = data.match(PI_RESUME_PATTERN) ?? entry.recentOutput.match(PI_RESUME_PATTERN);
  if (match?.[1] && match[2]) {
    session.piSessionId = match[2];
    session.piResumeCommand = match[1].replace(/\s+/g, ' ').trim();
    snapshot.piSessionId = session.piSessionId;
    snapshot.piResumeCommand = session.piResumeCommand;
  }
  snapshot.updatedAt = new Date().toISOString();
  scheduleSnapshotWrite(entry);
}

function isTerminalVisible(entry: RecordEntry) {
  return visibleTerminalIds.has(entry.session.id);
}

// Startup commands are held until the renderer attaches and sizes the pty
// (or a fallback timeout for tabs restored in the background). TUI apps like
// pi paint their first frame immediately; launching them against the spawn-time
// 120x30 placeholder mangles the layout until the next real resize repaints.
function flushPendingStartupCommand(entry: RecordEntry) {
  const pending = entry.pendingStartupCommand;
  if (!pending) return;
  entry.pendingStartupCommand = null;
  clearTimeout(pending.timer);
  if (terminals.has(entry.session.id)) entry.terminal.write(`${pending.command}\r`);
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
  if (!isTerminalVisible(entry)) return;
  mainWindow?.webContents.send('terminal:data', { id: entry.session.id, data });
}

function queueTerminalOutput(entry: RecordEntry, data: string) {
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

export async function createTerminal(profileId: string, cwd: string, name?: string, startupCommand?: string, restoreId?: string, context?: TerminalSessionContext): Promise<TerminalSession> {
  const profile = await resolveShell(profileId);
  const resolvedCwd = resolveCwd(cwd);
  const stableRestoreId = restoreId || `restore_${crypto.randomUUID()}`;
  const effectiveStartupCommand = resolveTerminalStartupCommand({ explicitStartupCommand: startupCommand, profileStartupCommand: profile.startupCommand });
  const normalizedStartupCommand = normalizePiStartupCommand(effectiveStartupCommand, stableRestoreId);
  const session: TerminalSession = {
    id: `term_${crypto.randomUUID()}`,
    restoreId: stableRestoreId,
    name: name || profile.name,
    profileId: profile.id,
    cwd: resolvedCwd,
    startupCommand: normalizedStartupCommand,
    piResumeCommand: normalizedStartupCommand && PI_COMMAND_PATTERN.test(normalizedStartupCommand) && piCommandHasStableTarget(normalizedStartupCommand) ? normalizedStartupCommand : undefined,
    restoredFromSnapshot: Boolean(restoreId),
    createdAt: new Date().toISOString(),
  };

  const settings = await loadSettings().catch(() => getDefaultSettings());
  const bridgeEnv = settings.captureTerminalBrowserOpens ? getBridgeEnv(session.id) : {};

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
  if (session.restoredFromSnapshot && priorSnapshot?.output) {
    // Seed the previous session's buffer, then push it fully into scrollback
    // and home the cursor: a fresh ConPTY repaints with absolute cursor moves
    // rooted at the viewport top (CUP 1;1), which would otherwise overwrite the
    // restored lines in place. The renderer replays this same serialized state,
    // so screen and snapshot stay in lockstep.
    const resumeNotice = normalizedStartupCommand && PI_COMMAND_PATTERN.test(normalizedStartupCommand)
      ? `\x1b[2m[resuming Pi session with: ${normalizedStartupCommand}]\x1b[0m\r\n`
      : '';
    headless.write(`${priorSnapshot.output}\x1b[0m\r\n\x1b[2m──── restored scrollback; live output follows ────\x1b[0m\r\n${resumeNotice}${'\r\n'.repeat(headless.rows)}\x1b[H`);
  }
  const entry: RecordEntry = { session, context, terminal, pendingData: [], flushTimer: null, pendingStartupCommand: null, headless, serializeAddon, recentOutput: '', headlessDisposed: false, discardSnapshot: false };
  terminal.onData((data) => queueTerminalOutput(entry, data));
  terminal.onExit(({ exitCode }) => {
    cancelPendingStartupCommand(entry);
    flushTerminalOutput(entry);
    mainWindow?.webContents.send('terminal:exit', { id: session.id, exitCode });
    terminals.delete(session.id);
    runtimeToRestore.delete(session.id);
    void persistEntrySnapshot(entry).finally(() => {
      entry.headlessDisposed = true;
      entry.headless.dispose();
    });
  });

  terminals.set(session.id, entry);
  if (normalizedStartupCommand) {
    entry.pendingStartupCommand = {
      command: normalizedStartupCommand,
      timer: setTimeout(() => flushPendingStartupCommand(entry), 3000),
    };
  }
  return session;
}

export async function writeTerminal(id: string, data: string) {
  terminals.get(id)?.terminal.write(data);
}

export async function resizeTerminal(id: string, cols: number, rows: number) {
  const entry = terminals.get(id);
  if (!entry) return;
  const safeCols = Math.max(2, cols);
  const safeRows = Math.max(1, rows);
  entry.terminal.resize(safeCols, safeRows);
  if (!entry.headlessDisposed) entry.headless.resize(safeCols, safeRows);
  flushPendingStartupCommand(entry);
}

export async function killTerminal(id: string, preserveSnapshot = false) {
  const entry = terminals.get(id);
  const restoreId = entry?.session.restoreId ?? runtimeToRestore.get(id) ?? id;
  if (entry) {
    cancelPendingStartupCommand(entry);
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
    return snapshot;
  }
  const existing = snapshots.get(idOrRestoreId) ?? snapshots.get(restoreId);
  if (existing) {
    existing.output = sanitizeSnapshotReplay(existing.output ?? '');
    return existing;
  }
  try {
    const parsed = JSON.parse(await fsp.readFile(snapshotPath(restoreId), 'utf8')) as TerminalSnapshot;
    parsed.output = sanitizeSnapshotReplay(parsed.output ?? '');
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
