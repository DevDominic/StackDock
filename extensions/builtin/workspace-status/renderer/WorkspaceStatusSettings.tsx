import type { ExtensionSettingsContext } from '../../../../src/extensions/extensionTypes';

export function WorkspaceStatusSettings({ config, setConfig }: ExtensionSettingsContext) {
  return (
    <div className="extension-config-form">
      <label className="checkbox-field"><input type="checkbox" checked={config.showPath !== false} onChange={(event) => setConfig({ showPath: event.target.checked })} /> Show workspace path</label>
    </div>
  );
}
