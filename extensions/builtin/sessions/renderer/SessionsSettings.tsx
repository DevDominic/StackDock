import type { ExtensionSettingsContext } from '../../../../src/extensions/extensionTypes';

export function SessionsSettings({ config, setConfig }: ExtensionSettingsContext) {
  return (
    <div className="extension-config-form">
      <label className="checkbox-field"><input type="checkbox" checked={config.emptySessionsVisible === true} onChange={(event) => setConfig({ emptySessionsVisible: event.target.checked })} /> Show empty sessions</label>
      <label className="checkbox-field"><input type="checkbox" checked={config.showSessionCwdForAll === true} onChange={(event) => setConfig({ showSessionCwdForAll: event.target.checked })} /> Always show session directories</label>
    </div>
  );
}
