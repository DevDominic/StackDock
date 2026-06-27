import type { ExtensionMainContext } from '../../../../electron/extensionHost';
import { downloadVoiceInputModel, downloadVoiceInputRuntime, getVoiceInputModelStatus, getVoiceInputRuntimeStatus, transcribeVoiceInput } from './voiceInputService';

export function activateMain(ctx: ExtensionMainContext) {
  ctx.rpc.handle('transcribe', (audioBase64, options) => transcribeVoiceInput(audioBase64, options));
  ctx.rpc.handle('modelStatus', (modelSize) => getVoiceInputModelStatus(modelSize));
  ctx.rpc.handle('downloadModel', (modelSize) => downloadVoiceInputModel(modelSize));
  ctx.rpc.handle('runtimeStatus', () => getVoiceInputRuntimeStatus());
  ctx.rpc.handle('downloadRuntime', () => downloadVoiceInputRuntime());
}
