import type { ExtensionSettingsContext } from '../../../../src/extensions/extensionTypes';

export function SessionsSettings({ config, setConfig }: ExtensionSettingsContext) {
  return (
    <div className="extension-config-form">
      <label className="settings-toggle-row extension-config-toggle">
        <span>
          <b>Show empty sessions</b>
          <span className="muted code-font-note">Show workspaces even when they have no active terminal sessions.</span>
        </span>
        <input type="checkbox" checked={config.emptySessionsVisible === true} onChange={(event) => setConfig({ emptySessionsVisible: event.target.checked })} />
      </label>
      <label className="settings-toggle-row extension-config-toggle">
        <span>
          <b>Always show session directories</b>
          <span className="muted code-font-note">Show the current directory on every session card.</span>
        </span>
        <input type="checkbox" checked={config.showSessionCwdForAll === true} onChange={(event) => setConfig({ showSessionCwdForAll: event.target.checked })} />
      </label>
    </div>
  );
}
