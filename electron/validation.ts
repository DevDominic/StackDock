import path from 'path';
import type { AppRestoreState, ExtensionSettings, TerminalAttachmentOptions, TerminalAttachmentSource, TerminalSessionContext, Workspace, WorkspaceLayout } from '../src/shared/types';

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
export function assertExtensionId(value: unknown, name: string): string {
  const str = assertNonEmptyString(value, name);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(str)) throw new Error(`${name} invalid`);
  return str;
}
function stringArray(value: unknown, name: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be array`);
  return value.map((item, index) => assertExtensionId(item, `${name}[${index}]`));
}
export function assertExtensionSettingsLike(value: unknown): ExtensionSettings {
  if (value == null || typeof value !== 'object') throw new Error('extension settings invalid');
  const settings = value as ExtensionSettings;
  if (!Array.isArray(settings.localPackagePaths)) throw new Error('extension localPackagePaths must be array');
  return { localPackagePaths: settings.localPackagePaths.map((item, index) => assertAbsolutePath(item, `localPackagePaths[${index}]`)), enabled: stringArray(settings.enabled, 'enabled'), disabled: stringArray(settings.disabled, 'disabled'), config: settings.config && typeof settings.config === 'object' ? settings.config : {} };
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
export function assertRestoreStateLike(value: unknown): AppRestoreState {
  if (value == null || typeof value !== 'object') throw new Error('restore state invalid');
  const state = value as AppRestoreState;
  return {
    lastWorkspaceId: state.lastWorkspaceId == null ? undefined : assertNonEmptyString(state.lastWorkspaceId, 'lastWorkspaceId'),
    lastTerminalRestoreId: state.lastTerminalRestoreId == null ? undefined : assertNonEmptyString(state.lastTerminalRestoreId, 'lastTerminalRestoreId'),
    lastTerminalRuntimeId: state.lastTerminalRuntimeId == null ? undefined : assertNonEmptyString(state.lastTerminalRuntimeId, 'lastTerminalRuntimeId'),
  };
}

export function assertLayoutLike(value: unknown): WorkspaceLayout {
  const layout = value as WorkspaceLayout;
  assertNonEmptyString(layout?.workspaceId, 'layout.workspaceId');
  if (!layout.panels || !layout.editors || !Array.isArray(layout.terminals)) throw new Error('layout shape invalid');
  if (layout.extensions) {
    if (layout.extensions.enabled) stringArray(layout.extensions.enabled, 'layout.extensions.enabled');
    if (layout.extensions.disabled) stringArray(layout.extensions.disabled, 'layout.extensions.disabled');
  }
  return layout;
}
export function assertTerminalSessionContext(value: unknown): TerminalSessionContext | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object') throw new Error('terminal context invalid');
  const context = value as TerminalSessionContext;
  return {
    workspaceId: context.workspaceId == null ? undefined : assertNonEmptyString(context.workspaceId, 'context.workspaceId'),
    workspaceName: context.workspaceName == null ? undefined : assertNonEmptyString(context.workspaceName, 'context.workspaceName'),
    workspacePath: context.workspacePath == null ? undefined : assertAbsolutePath(context.workspacePath, 'context.workspacePath'),
    headless: context.headless === true ? true : undefined,
    commandLabel: context.commandLabel == null ? undefined : assertNonEmptyString(context.commandLabel, 'context.commandLabel'),
  };
}
export function assertTerminalAttachmentSource(value: unknown, name: string): TerminalAttachmentSource {
  const source = assertNonEmptyString(value, name);
  if (source !== 'drop' && source !== 'paste-file' && source !== 'paste-image') throw new Error(`${name} invalid`);
  return source;
}
export function assertTerminalAttachmentOptions(value: unknown): TerminalAttachmentOptions | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object') throw new Error('attachment options invalid');
  const options = value as TerminalAttachmentOptions;
  if (options.largeFileThresholdBytes == null) return {};
  return { largeFileThresholdBytes: assertNumber(options.largeFileThresholdBytes, 'largeFileThresholdBytes', 1, 1024 * 1024 * 1024) };
}
