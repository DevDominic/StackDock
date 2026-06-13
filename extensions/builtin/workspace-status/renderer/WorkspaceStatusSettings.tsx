import type { ExtensionSettingsContext } from '../../../../src/extensions/extensionTypes';

export function WorkspaceStatusSettings({ config, setConfig }: ExtensionSettingsContext) {
  return (
    <div className="extension-config-form">
      <label className="settings-toggle-row extension-config-toggle">
        <span>
          <b>Show workspace path</b>
          <span className="muted code-font-note">Show the current workspace path in the status bar.</span>
        </span>
        <input type="checkbox" checked={config.showPath !== false} onChange={(event) => setConfig({ showPath: event.target.checked })} />
      </label>
    </div>
  );
}
