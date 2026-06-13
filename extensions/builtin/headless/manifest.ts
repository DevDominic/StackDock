import type { ExtensionManifest } from '../../../src/shared/types';

export const headlessExtensionManifest: ExtensionManifest = {
  id: 'stackdock.headless',
  name: 'Headless',
  version: '1.0.0',
  defaultEnabled: true,
  source: 'bundled',
  contributes: {
    views: [{ id: 'stackdock.headless.view', extensionId: 'stackdock.headless', title: 'Headless', icon: 'terminal', location: 'sessions', order: 10, native: true, when: 'headlessActive' }],
  },
};
