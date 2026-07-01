import { app } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

function fallbackAppDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
}

function getSafeAppDataDir() {
  const appData = app.getPath('appData');
  // Electron should return a native absolute path, but inherited Windows-style
  // APPDATA values (or tests/mocks) are relative filenames on POSIX. Never let
  // `C:\Users\...` become a directory inside the current project on macOS/Linux.
  if (process.platform !== 'win32' && path.win32.isAbsolute(appData) && !path.isAbsolute(appData)) return fallbackAppDataDir();
  if (!path.isAbsolute(appData)) return fallbackAppDataDir();
  return appData;
}

export function getDataDir() {
  return path.join(getSafeAppDataDir(), 'StackDock');
}

export function getWorkspacesPath() {
  return path.join(getDataDir(), 'workspaces.json');
}

export function getConfigPath() {
  return path.join(getDataDir(), 'config.json');
}

export function getAutomationPath() {
  return path.join(getDataDir(), 'automation.json');
}

export function getLayoutsDir() {
  return path.join(getDataDir(), 'layouts');
}

export function getRestoreStatePath() {
  return path.join(getDataDir(), 'restore-state.json');
}

export function getTerminalSnapshotsDir() {
  return path.join(getDataDir(), 'terminal-snapshots');
}

export function getTerminalStatePath() {
  return path.join(getDataDir(), 'terminal-state.json');
}

export function getLogsDir() {
  return path.join(getDataDir(), 'logs');
}

export function getAttachmentCacheDir() {
  return path.join(getDataDir(), 'attachments');
}

export function getExtensionsDir() {
  return path.join(getDataDir(), 'extensions');
}

export function getLocalExtensionsDir() {
  return path.join(getExtensionsDir(), 'local');
}

export async function ensureDataDirs() {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.mkdir(getLayoutsDir(), { recursive: true });
  await fs.mkdir(getTerminalSnapshotsDir(), { recursive: true });
  await fs.mkdir(getLogsDir(), { recursive: true });
  await fs.mkdir(getAttachmentCacheDir(), { recursive: true });
  await fs.mkdir(getLocalExtensionsDir(), { recursive: true });
}
