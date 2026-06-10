import type { ExtensionManifest } from '../../../src/shared/types';

export const explorerExtensionManifest: ExtensionManifest = {
  id: 'stackdock.explorer',
  name: 'Explorer',
  version: '1.0.0',
  defaultEnabled: true,
  source: 'bundled',
  contributes: {
    views: [{ id: 'stackdock.explorer.view', extensionId: 'stackdock.explorer', title: 'Explorer', icon: 'folder', location: 'activity', order: 10, native: true }],
  },
};
