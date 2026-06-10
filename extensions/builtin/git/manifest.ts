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
  },
};
