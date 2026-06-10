import { getExtensionConfig } from '../../../../src/extensions/configuration';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { workspaceStatusExtensionManifest } from '../manifest';
import { WorkspaceStatusSettings } from './WorkspaceStatusSettings';
import './workspaceStatus.css';

export const workspaceStatusExtension: NativeExtension = {
  manifest: workspaceStatusExtensionManifest,
  renderStatusBar: (_contribution, { workspace, settings, actions }) => {
    const config = getExtensionConfig(settings, workspaceStatusExtensionManifest.id, { showPath: true });
    return (
      <button className="statusbar-item" onClick={() => actions.revealFolder(workspace.path)} title={`${workspace.path} — reveal in file explorer`}>
        <span className="statusbar-icon" aria-hidden>📁</span>
        <span className="statusbar-ws-name">{workspace.name}</span>
        {config.showPath !== false ? <span className="statusbar-ws-path muted">{workspace.path}</span> : null}
      </button>
    );
  },
  renderSettings: (ctx) => <WorkspaceStatusSettings {...ctx} />,
};
