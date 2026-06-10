import { FileTree } from '../../components/workspace/FileTree';
import type { NativeExtension } from '../extensionTypes';

export const explorerExtension: NativeExtension = {
  manifest: { id: 'stackdock.explorer', name: 'Explorer', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { views: [{ id: 'stackdock.explorer.view', extensionId: 'stackdock.explorer', title: 'Explorer', icon: 'folder', location: 'activity', order: 10, native: true }] } },
  renderView: (_contribution, ctx) => (
    <FileTree rootPath={ctx.workspace.path} gitFiles={ctx.git?.files ?? []} onOpenFile={ctx.actions.openFile} onOpenTerminalHere={ctx.actions.openTerminalHere} refreshToken={ctx.refreshToken} />
  ),
};
