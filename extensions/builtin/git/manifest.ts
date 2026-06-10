import type { ExtensionManifest } from '../../../src/shared/types';

export const gitExtensionManifest: ExtensionManifest = {
  id: 'stackdock.git',
  name: 'Source Control',
  version: '1.0.0',
  defaultEnabled: true,
  source: 'bundled',
  contributes: {
    views: [{ id: 'stackdock.git.view', extensionId: 'stackdock.git', title: 'Source Control', icon: 'git', location: 'activity', order: 20, native: true, when: 'gitRepo' }],
    statusBar: [{ id: 'stackdock.git.status', extensionId: 'stackdock.git', side: 'left', order: 10, native: true, when: 'gitRepo' }],
    configuration: {
      title: 'Source Control settings',
      fields: [
        { key: 'confirmBeforeDiscard', label: 'Confirm before discard', type: 'boolean', default: true },
        { key: 'refreshIntervalSeconds', label: 'Refresh interval (seconds)', type: 'number', default: 1, min: 1, step: 1 },
      ],
    },
  },
};
