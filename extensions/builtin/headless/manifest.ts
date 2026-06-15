import type { ExtensionManifest } from '../../../src/shared/types';

export const headlessExtensionManifest: ExtensionManifest = {
  id: 'stackdock.headless',
  name: 'Commands',
  version: '1.0.0',
  defaultEnabled: true,
  source: 'bundled',
  contributes: {
    views: [{ id: 'stackdock.headless.view', extensionId: 'stackdock.headless', title: 'Commands', icon: 'terminal', location: 'sessions', order: 10, native: true, when: 'headlessActive' }],
  },
};
