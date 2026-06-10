import type { NativeExtension } from '../extensionTypes';

export const workspaceStatusExtension: NativeExtension = {
  manifest: { id: 'stackdock.workspaceStatus', name: 'Workspace Status', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { statusBar: [{ id: 'stackdock.workspace.status', extensionId: 'stackdock.workspaceStatus', side: 'right', order: 10, native: true }] } },
  renderStatusBar: (_contribution, { workspace, actions }) => (
    <button className="statusbar-item" onClick={() => actions.revealFolder(workspace.path)} title={`${workspace.path} — reveal in file explorer`}>
      <span className="statusbar-icon" aria-hidden>📁</span>
      <span className="statusbar-ws-name">{workspace.name}</span>
      <span className="statusbar-ws-path muted">{workspace.path}</span>
    </button>
  ),
};
