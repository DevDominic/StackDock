import fs from 'fs';
import path from 'path';
import * as pty from 'node-pty';
import type { TerminalProfile, TerminalSession } from '../src/shared/types';

interface RecordEntry {
  session: TerminalSession;
  terminal: pty.IPty;
}

const terminals = new Map<string, RecordEntry>();
let mainWindow: Electron.BrowserWindow | null = null;

export function setTerminalWindow(window: Electron.BrowserWindow | null) {
  mainWindow = window;
}

export function getTerminalProfiles(): TerminalProfile[] {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  return [
    { id: 'powershell', name: 'PowerShell', shell: 'powershell.exe', args: ['-NoLogo', '-NoExit'] },
    { id: 'cmd', name: 'Command Prompt', shell: 'cmd.exe', args: [] },
    { id: 'git-bash', name: 'Git Bash', shell: path.join(programFiles, 'Git', 'bin', 'bash.exe'), args: ['--login', '-i'] },
    { id: 'wsl', name: 'WSL', shell: 'wsl.exe', args: [] },
  ];
}

function resolveShell(profileId: string) {
  return getTerminalProfiles().find((profile) => profile.id === profileId) ?? getTerminalProfiles()[0];
}

function resolveCwd(cwd: string) {
  try {
    return fs.existsSync(cwd) ? cwd : process.cwd();
  } catch {
    return process.cwd();
  }
}

export async function createTerminal(profileId: string, cwd: string, name?: string, startupCommand?: string): Promise<TerminalSession> {
  const profile = resolveShell(profileId);
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
