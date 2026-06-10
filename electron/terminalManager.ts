import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import * as pty from 'node-pty';
import { sanitizeSnapshotReplay, trimSnapshotOutput } from '../src/shared/terminalSnapshot';
import { resolveTerminalStartupCommand } from '../src/shared/terminalProfiles';
import type { TerminalPersistedState, TerminalPersistedTab, TerminalProfile, TerminalSession, TerminalSessionContext, TerminalSnapshot } from '../src/shared/types';
import { getDefaultSettings, loadSettings } from './configStore';
import { ensureDataDirs, getTerminalSnapshotsDir, getTerminalStatePath } from './storage';

interface RecordEntry {
  session: TerminalSession;
  context?: TerminalSessionContext;
  terminal: pty.IPty;
  pendingData: string[];
  flushTimer: NodeJS.Timeout | null;
}

const terminals = new Map<string, RecordEntry>();
const runtimeToRestore = new Map<string, string>();
const snapshots = new Map<string, TerminalSnapshot>();
const snapshotWriteTimers = new Map<string, NodeJS.Timeout>();
let visibleTerminalIds = new Set<string>();
let mainWindow: Electron.BrowserWindow | null = null;

const MAX_SNAPSHOT_BYTES = 512 * 1024;
const VISIBLE_TERMINAL_OUTPUT_FLUSH_MS = 16;
const HIDDEN_TERMINAL_OUTPUT_FLUSH_MS = 250;
const PI_RESUME_PATTERN = /To resume this session:\s*(pi\s+--session\s+([A-Za-z0-9_-]{8,128}))/i;
const PI_COMMAND_PATTERN = /^\s*pi(?:\s|$)/i;
const PI_TRACKED_ARG_PATTERN = /(?:^|\s)(?:--name\b|--session\b|-r\b|--resume\b|--continue\b)/i;
const SHELL_META_PATTERN = /[|&;<>]/;

function snapshotPath(restoreId: string) {
  return path.join(getTerminalSnapshotsDir(), `${restoreId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}


function scheduleSnapshotWrite(snapshot: TerminalSnapshot) {
  if (!snapshot.restoreId) return;
  const existing = snapshotWriteTimers.get(snapshot.restoreId);
  if (existing) clearTimeout(existing);
  snapshotWriteTimers.set(snapshot.restoreId, setTimeout(() => {
    snapshotWriteTimers.delete(snapshot.restoreId!);
    void ensureDataDirs().then(() => fsp.writeFile(snapshotPath(snapshot.restoreId!), JSON.stringify(snapshot, null, 2), 'utf8')).catch(() => undefined);
  }, 250));
}

export async function flushTerminalSnapshots() {
  for (const entry of terminals.values()) {
    if (entry.pendingData.length) flushTerminalOutput(entry);
  }
  for (const timer of snapshotWriteTimers.values()) clearTimeout(timer);
  snapshotWriteTimers.clear();
  const uniqueSnapshots = new Map<string, TerminalSnapshot>();
  for (const snapshot of snapshots.values()) {
    if (snapshot.restoreId) uniqueSnapshots.set(snapshot.restoreId, snapshot);
  }
  if (!uniqueSnapshots.size) return;
  await ensureDataDirs();
  await Promise.all([...uniqueSnapshots.values()].map((snapshot) => fsp.writeFile(snapshotPath(snapshot.restoreId!), JSON.stringify(snapshot, null, 2), 'utf8')));
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

function updateSnapshot(session: TerminalSession, data: string) {
  const restoreId = session.restoreId ?? session.id;
  const current = snapshots.get(restoreId)?.output ?? '';
  const previous = snapshots.get(restoreId);
  const snapshot: TerminalSnapshot = { id: session.id, restoreId, output: trimSnapshotOutput(current + data, MAX_SNAPSHOT_BYTES), updatedAt: new Date().toISOString(), piSessionId: previous?.piSessionId ?? session.piSessionId, piResumeCommand: previous?.piResumeCommand ?? session.piResumeCommand };
  const match = data.match(PI_RESUME_PATTERN) ?? snapshot.output.slice(-4096).match(PI_RESUME_PATTERN);
  if (match?.[1] && match[2]) {
    session.piSessionId = match[2];
    session.piResumeCommand = match[1].replace(/\s+/g, ' ').trim();
    snapshot.piSessionId = session.piSessionId;
    snapshot.piResumeCommand = session.piResumeCommand;
  }
  snapshots.set(restoreId, snapshot);
  snapshots.set(session.id, snapshot);
  scheduleSnapshotWrite(snapshot);
}

function isTerminalVisible(entry: RecordEntry) {
  return visibleTerminalIds.has(entry.session.id);
}

function flushTerminalOutput(entry: RecordEntry) {
  if (entry.flushTimer) {
    clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
  }
  if (!entry.pendingData.length) return;
  const data = entry.pendingData.join('');
  entry.pendingData = [];
  updateSnapshot(entry.session, data);
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

  const terminal = pty.spawn(profile.shell, profile.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env: { ...(process.env as Record<string, string>), STACKDOCK: '1', STACKDOCK_TERMINAL: '1' },
    // Avoid node-pty's Windows kill-path helper (`conpty_console_list_agent`),
    // which can print noisy "AttachConsole failed" errors when Electron exits.
    ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
  });

  runtimeToRestore.set(session.id, session.restoreId!);
  await getTerminalSnapshot(session.restoreId!).catch(() => null);
  const entry: RecordEntry = { session, context, terminal, pendingData: [], flushTimer: null };
  terminal.onData((data) => queueTerminalOutput(entry, data));
  terminal.onExit(({ exitCode }) => {
    flushTerminalOutput(entry);
    mainWindow?.webContents.send('terminal:exit', { id: session.id, exitCode });
    terminals.delete(session.id);
    runtimeToRestore.delete(session.id);
  });

  terminals.set(session.id, entry);
  if (normalizedStartupCommand) terminal.write(`${normalizedStartupCommand}\r`);
  return session;
}

export async function writeTerminal(id: string, data: string) {
  terminals.get(id)?.terminal.write(data);
}

export async function resizeTerminal(id: string, cols: number, rows: number) {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.terminal.resize(Math.max(2, cols), Math.max(1, rows));
}

export async function killTerminal(id: string, preserveSnapshot = false) {
  const entry = terminals.get(id);
  const restoreId = entry?.session.restoreId ?? runtimeToRestore.get(id) ?? id;
  if (entry) {
    if (preserveSnapshot) flushTerminalOutput(entry);
    else {
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
  if (entry?.pendingData.length) flushTerminalOutput(entry);
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
