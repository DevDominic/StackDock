import { FileTree } from './FileTree';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { explorerExtensionManifest } from '../manifest';
import './explorer.css';

export const explorerExtension: NativeExtension = {
  manifest: explorerExtensionManifest,
  renderView: (_contribution, ctx) => (
    <FileTree rootPath={ctx.workspace.path} gitFiles={ctx.git?.files ?? []} onOpenFile={ctx.actions.openFile} onPreviewFile={ctx.actions.previewFile} onOpenTerminalHere={ctx.actions.openTerminalHere} refreshToken={ctx.refreshToken} />
  ),
};
