import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

export function getDataDir() {
  return path.join(app.getPath('appData'), 'StackDock');
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
