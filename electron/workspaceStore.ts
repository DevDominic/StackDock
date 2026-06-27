import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { AppRestoreState, Workspace, WorkspaceLayout } from '../src/shared/types';
import { ensureDataDirs, getLayoutsDir, getRestoreStatePath, getWorkspacesPath } from './storage';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace';
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await ensureDataDirs();
  const workspaces = await readJson<Workspace[]>(getWorkspacesPath(), []);
  return workspaces
    .map((workspace) => ({ ...workspace, trusted: workspace.trusted !== false }))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.name.localeCompare(b.name));
}

export async function createWorkspace(parentPath: string, name: string): Promise<Workspace> {
  if (!name.trim() || name.includes('/') || name.includes('\\')) throw new Error('Workspace name cannot contain path separators');
  const targetPath = path.join(parentPath, name.trim());
  await fs.mkdir(targetPath, { recursive: false });
  return addWorkspace(targetPath, true);
}

export async function addWorkspace(folderPath: string, trusted = false): Promise<Workspace> {
  const workspaces = await listWorkspaces();
  const name = path.basename(folderPath) || folderPath;
  const id = slugify(name);
  const workspace: Workspace = {
    id: workspaces.some((item) => item.id === id) ? `${id}-${Date.now().toString(36)}` : id,
    name,
    path: folderPath,
    createdAt: new Date().toISOString(),
    pinned: false,
    trusted,
    commands: [],
  };
  workspaces.unshift(workspace);
  await writeJson(getWorkspacesPath(), workspaces);
  return workspace;
}

export async function updateWorkspace(next: Workspace): Promise<Workspace> {
  const workspaces = await listWorkspaces();
  const updated = workspaces.map((item) => (item.id === next.id ? next : item));
  await writeJson(getWorkspacesPath(), updated);
  return next;
}

export async function removeWorkspace(id: string) {
  const workspaces = await listWorkspaces();
  await writeJson(getWorkspacesPath(), workspaces.filter((item) => item.id !== id));
}

export async function loadLayout(workspaceId: string): Promise<WorkspaceLayout | null> {
  await ensureDataDirs();
  return readJson<WorkspaceLayout | null>(path.join(getLayoutsDir(), `${workspaceId}.json`), null);
}

export async function resetLayout(workspaceId: string) {
  await ensureDataDirs();
  await fs.unlink(path.join(getLayoutsDir(), `${workspaceId}.json`)).catch(() => undefined);
}

export async function saveLayout(layout: WorkspaceLayout) {
  await ensureDataDirs();
  await writeJson(path.join(getLayoutsDir(), `${layout.workspaceId}.json`), layout);
}

export async function loadRestoreState(): Promise<AppRestoreState> {
  await ensureDataDirs();
  return readJson<AppRestoreState>(getRestoreStatePath(), {});
}

export async function saveRestoreState(state: AppRestoreState): Promise<AppRestoreState> {
  await ensureDataDirs();
  const next: AppRestoreState = {
    lastWorkspaceId: state.lastWorkspaceId,
    lastTerminalRestoreId: state.lastTerminalRestoreId,
    lastTerminalRuntimeId: state.lastTerminalRuntimeId,
  };
  await writeJson(getRestoreStatePath(), next);
  return next;
}

export async function getDefaultWorkspacePath() {
  return app.getPath('documents');
}
