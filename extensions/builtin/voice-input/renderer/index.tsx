import { getExtensionConfig } from '../../../../src/extensions/configuration';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { voiceInputExtensionManifest } from '../manifest';
import { VoiceInputPanel } from './VoiceInputPanel';
import { VoiceInputTerminalButton } from './VoiceInputTerminalButton';
import { VoiceInputSettings } from './VoiceInputSettings';
import './voiceInput.css';

const DEFAULTS = { executablePath: '', modelPath: '', modelSize: 'base', language: 'en', microphoneDeviceId: '' };

export const voiceInputExtension: NativeExtension = {
  manifest: voiceInputExtensionManifest,
  renderView: (_contribution, ctx) => {
    const config = getExtensionConfig(ctx.settings, voiceInputExtensionManifest.id, DEFAULTS);
    return <VoiceInputPanel activeSessionId={ctx.activeSessionId} config={{ executablePath: String(config.executablePath ?? ''), modelPath: String(config.modelPath ?? ''), modelSize: String(config.modelSize ?? 'base'), language: String(config.language ?? 'en'), microphoneDeviceId: String(config.microphoneDeviceId ?? '') }} />;
  },
  renderTerminalOverlay: (ctx, session) => {
    const config = getExtensionConfig(ctx.settings, voiceInputExtensionManifest.id, DEFAULTS);
    return <VoiceInputTerminalButton activeSessionId={session.id} config={{ executablePath: String(config.executablePath ?? ''), modelPath: String(config.modelPath ?? ''), modelSize: String(config.modelSize ?? 'base'), language: String(config.language ?? 'en'), microphoneDeviceId: String(config.microphoneDeviceId ?? '') }} />;
  },
  renderTerminalSmartInputAction: (ctx, session, smartInput) => {
    const config = getExtensionConfig(ctx.settings, voiceInputExtensionManifest.id, DEFAULTS);
    return <VoiceInputTerminalButton activeSessionId={session.id} variant="embedded" onTranscript={smartInput.insertText} config={{ executablePath: String(config.executablePath ?? ''), modelPath: String(config.modelPath ?? ''), modelSize: String(config.modelSize ?? 'base'), language: String(config.language ?? 'en'), microphoneDeviceId: String(config.microphoneDeviceId ?? '') }} />;
  },
  renderSettings: (ctx) => {
    return <VoiceInputSettings config={{ executablePath: String(ctx.config.executablePath ?? ''), modelPath: String(ctx.config.modelPath ?? ''), modelSize: String(ctx.config.modelSize ?? 'base'), language: String(ctx.config.language ?? 'en'), microphoneDeviceId: String(ctx.config.microphoneDeviceId ?? '') }} setConfig={ctx.setConfig} />;
  },
  getCommands: (ctx) => [
    { id: 'stackdock.voiceInput.show', label: 'Show Voice Input', run: () => ctx.actions.openView('stackdock.voiceInput.view') },
  ],
};
