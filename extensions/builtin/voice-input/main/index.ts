import type { ExtensionMainContext } from '../../../../electron/extensionHost';
import { downloadVoiceInputModel, getVoiceInputModelStatus, transcribeVoiceInput } from './voiceInputService';

export function activateMain(ctx: ExtensionMainContext) {
  ctx.rpc.handle('transcribe', (audioBase64, options) => transcribeVoiceInput(audioBase64, options));
  ctx.rpc.handle('modelStatus', (modelSize) => getVoiceInputModelStatus(modelSize));
  ctx.rpc.handle('downloadModel', (modelSize) => downloadVoiceInputModel(modelSize));
}
