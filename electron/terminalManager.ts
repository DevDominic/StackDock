import fs from 'fs';
import * as pty from 'node-pty';
import type { TerminalProfile, TerminalSession } from '../src/shared/types';
import { getDefaultSettings, loadSettings } from './configStore';

interface RecordEntry {
  session: TerminalSession;
  terminal: pty.IPty;
}

const terminals = new Map<string, RecordEntry>();
let mainWindow: Electron.BrowserWindow | null = null;

export function setTerminalWindow(window: Electron.BrowserWindow | null) {
  mainWindow = window;
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

export async function createTerminal(profileId: string, cwd: string, name?: string, startupCommand?: string): Promise<TerminalSession> {
  const profile = await resolveShell(profileId);
  const resolvedCwd = resolveCwd(cwd);
  const session: TerminalSession = {
    id: `term_${crypto.randomUUID()}`,
    name: name || profile.name,
    profileId: profile.id,
    cwd: resolvedCwd,
    startupCommand,
    createdAt: new Date().toISOString(),
  };

  const terminal = pty.spawn(profile.shell, profile.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env: process.env as Record<string, string>,
  });

  terminal.onData((data) => {
    mainWindow?.webContents.send('terminal:data', { id: session.id, data });
  });
  terminal.onExit(({ exitCode }) => {
    mainWindow?.webContents.send('terminal:exit', { id: session.id, exitCode });
    terminals.delete(session.id);
  });

  terminals.set(session.id, { session, terminal });
  if (startupCommand) terminal.write(`${startupCommand}\r`);
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

export async function killTerminal(id: string) {
  terminals.get(id)?.terminal.kill();
  terminals.delete(id);
}
