import type { ExtensionManifest } from '../../../src/shared/types';

export const voiceInputExtensionManifest: ExtensionManifest = {
  id: 'stackdock.voiceInput',
  name: 'Voice Input',
  version: '1.0.0',
  description: 'Record microphone audio and transcribe it with a local whisper.cpp model.',
  defaultEnabled: false,
  source: 'bundled',
  capabilities: ['voice-input'],
  main: './main/index',
  renderer: './renderer/index',
  contributes: {
    views: [{ id: 'stackdock.voiceInput.view', extensionId: 'stackdock.voiceInput', title: 'Voice Input', icon: 'mic', location: 'activity', order: 70, native: true }],
    configuration: {
      title: 'Voice Input settings',
      fields: [
        { key: 'executablePath', label: 'Custom whisper.cpp executable path', type: 'text', default: '', description: 'Optional. Overrides the managed whisper.cpp runtime installed from the Voice Input panel.' },
        { key: 'modelSize', label: 'Managed model', type: 'select', default: 'tiny', options: [{ label: 'Tiny (fastest)', value: 'tiny' }, { label: 'Base (more accurate)', value: 'base' }], description: 'StackDock can download and use this model automatically.' },
        { key: 'modelPath', label: 'Custom model path', type: 'text', default: '', description: 'Optional. Overrides the managed model when set.' },
        { key: 'language', label: 'Language', type: 'text', default: 'en', description: 'whisper.cpp language code. Use en for tiny.en models.' },
      ],
    },
  },
};
