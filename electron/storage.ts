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

export function getLogsDir() {
  return path.join(getDataDir(), 'logs');
}

export async function ensureDataDirs() {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.mkdir(getLayoutsDir(), { recursive: true });
  await fs.mkdir(getLogsDir(), { recursive: true });
}
