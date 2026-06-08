import path from 'path';
import type { Workspace, WorkspaceLayout } from '../src/shared/types';

export function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be string`);
  return value;
}
export function assertNonEmptyString(value: unknown, name: string): string {
  const str = assertString(value, name);
  if (!str.trim()) throw new Error(`${name} required`);
  if (str.includes('\0')) throw new Error(`${name} contains null byte`);
  return str;
}
export function assertAbsolutePath(value: unknown, name: string): string {
  const str = assertNonEmptyString(value, name);
  if (!path.isAbsolute(str)) throw new Error(`${name} must be absolute path`);
  return str;
}
export function assertSafeFileName(value: unknown, name: string): string {
  const str = assertNonEmptyString(value, name);
  if (str.includes('/') || str.includes('\\')) throw new Error(`${name} cannot contain path separators`);
  return str;
}
export function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}
export function assertNumber(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} invalid`);
  return value;
}
export function assertWorkspaceLike(value: unknown): Workspace {
  const workspace = value as Workspace;
  assertNonEmptyString(workspace?.id, 'workspace.id');
  assertNonEmptyString(workspace?.name, 'workspace.name');
  assertAbsolutePath(workspace?.path, 'workspace.path');
  return workspace;
}
export function assertLayoutLike(value: unknown): WorkspaceLayout {
  const layout = value as WorkspaceLayout;
  assertNonEmptyString(layout?.workspaceId, 'layout.workspaceId');
  if (!layout.panels || !layout.editors || !Array.isArray(layout.terminals)) throw new Error('layout shape invalid');
  return layout;
}
