import type { NativeExtension } from './extensionTypes';
import { explorerExtension } from '../../extensions/builtin/explorer/renderer';
import { gitExtension } from '../../extensions/builtin/git/renderer';
import { sessionsExtension } from '../../extensions/builtin/sessions/renderer';
import { workspaceStatusExtension } from '../../extensions/builtin/workspace-status/renderer';
export { getEnabledStatusBarContributions, getEnabledViewContributions, resolveEnabledExtensions } from './enablement';

export function getNativeExtensions(): NativeExtension[] { return [explorerExtension, gitExtension, sessionsExtension, workspaceStatusExtension]; }
