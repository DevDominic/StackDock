import type { NativeExtension } from './extensionTypes';
import { explorerExtension } from './builtin/explorer';
import { gitExtension } from '../../extensions/builtin/git/renderer';
import { sessionsExtension } from './builtin/sessions';
import { workspaceStatusExtension } from './builtin/workspaceStatus';
export { getEnabledStatusBarContributions, getEnabledViewContributions, resolveEnabledExtensions } from './enablement';

export function getNativeExtensions(): NativeExtension[] { return [explorerExtension, gitExtension, sessionsExtension, workspaceStatusExtension]; }
