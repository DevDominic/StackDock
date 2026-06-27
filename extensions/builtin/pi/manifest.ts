import type { ExtensionManifest } from '../../../src/shared/types';

export const piExtensionManifest: ExtensionManifest = {
  id: 'stackdock.pi',
  name: 'Pi Sessions',
  version: '1.0.0',
  description: 'Adds stable Pi session IDs and StackDock-managed Pi session storage for terminal profiles that start Pi.',
  defaultEnabled: true,
  source: 'bundled',
  capabilities: ['terminal-session-resume'],
  contributes: {
    configuration: {
      title: 'Pi session integration',
      fields: [
        { key: 'resumeRestoredTerminals', label: 'Resume restored terminals', type: 'boolean', default: true, description: 'When StackDock restores a Pi terminal, automatically relaunch Pi into the previous session if the snapshot still shows Pi running. Turning this off also prevents StackDock from injecting stable session IDs.' },
        { key: 'stableSessionIds', label: 'Use stable session IDs', type: 'boolean', default: true, description: 'Pass --session-id so each StackDock terminal can reopen the same Pi session without using the resume picker.' },
        { key: 'useStackDockSessionDir', label: 'Store sessions under StackDock', type: 'boolean', default: false, description: 'Opt in to passing --session-dir so StackDock-managed Pi sessions live under StackDock app data instead of the default Pi sessions folder.' }
      ],
    },
  },
};
