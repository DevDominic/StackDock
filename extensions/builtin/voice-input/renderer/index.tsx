import { getExtensionConfig } from '../../../../src/extensions/configuration';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { voiceInputExtensionManifest } from '../manifest';
import { VoiceInputPanel } from './VoiceInputPanel';
import { VoiceInputTerminalButton } from './VoiceInputTerminalButton';
import './voiceInput.css';

const DEFAULTS = { executablePath: '', modelPath: '', modelSize: 'tiny', language: 'en' };

export const voiceInputExtension: NativeExtension = {
  manifest: voiceInputExtensionManifest,
  renderView: (_contribution, ctx) => {
    const config = getExtensionConfig(ctx.settings, voiceInputExtensionManifest.id, DEFAULTS);
    return <VoiceInputPanel activeSessionId={ctx.activeSessionId} config={{ executablePath: String(config.executablePath ?? ''), modelPath: String(config.modelPath ?? ''), modelSize: String(config.modelSize ?? 'tiny'), language: String(config.language ?? 'en') }} />;
  },
  renderTerminalOverlay: (ctx, session) => {
    const config = getExtensionConfig(ctx.settings, voiceInputExtensionManifest.id, DEFAULTS);
    return <VoiceInputTerminalButton activeSessionId={session.id} config={{ executablePath: String(config.executablePath ?? ''), modelPath: String(config.modelPath ?? ''), modelSize: String(config.modelSize ?? 'tiny'), language: String(config.language ?? 'en') }} />;
  },
  getCommands: (ctx) => [
    { id: 'stackdock.voiceInput.show', label: 'Show Voice Input', run: () => ctx.actions.openView('stackdock.voiceInput.view') },
  ],
};
