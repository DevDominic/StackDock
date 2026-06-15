import { FileTree } from './FileTree';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { explorerExtensionManifest } from '../manifest';
import './explorer.css';

export const explorerExtension: NativeExtension = {
  manifest: explorerExtensionManifest,
  renderView: (_contribution, ctx) => (
    <FileTree rootPath={ctx.workspace.path} gitFiles={ctx.git?.files ?? []} canAddToContext={!!ctx.activeSessionId} onOpenFile={ctx.actions.openFile} onPreviewFile={ctx.actions.previewFile} onOpenTerminalHere={ctx.actions.openTerminalHere} onAddPathToContext={ctx.actions.addPathToContext} onDeletedPath={ctx.actions.closeDeletedPath} refreshToken={ctx.refreshToken} />
  ),
  getCommands: (ctx) => [
    { id: 'stackdock.explorer.toggleSidebar', label: 'Toggle Sidebar', run: () => ctx.actions.toggleView('stackdock.explorer.view') },
    { id: 'stackdock.explorer.showExplorer', label: 'Show Explorer', run: () => ctx.actions.openView('stackdock.explorer.view') },
  ],
};
