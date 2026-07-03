import { api } from '../../../../src/lib/api';
import { useToast } from '../../../../src/components/common/ToastProvider';
import { MicrophoneIcon } from '../../../../src/components/icons';
import { useVoiceInputRecorder, type VoiceInputConfig } from './voiceInputRecording';

interface Props {
  activeSessionId: string | null;
  config: VoiceInputConfig;
  variant?: 'floating' | 'embedded';
  onTranscript?(text: string): void;
}

export function VoiceInputTerminalButton({ activeSessionId, config, variant = 'floating', onTranscript }: Props) {
  const { showToast } = useToast();
  const recorder = useVoiceInputRecorder(config, async (text) => {
    if (onTranscript) {
      onTranscript(text);
      showToast('Voice text inserted into Smart Input', 'success');
      return;
    }
    if (!activeSessionId) return;
    await api.terminal.write(activeSessionId, text);
    showToast('Voice text pasted into terminal', 'success');
  });

  async function onClick() {
    if (!activeSessionId) {
      showToast('Open a terminal before recording voice input.', 'info');
      return;
    }
    try {
      await recorder.toggleRecording();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  return (
    <button
      className={`voice-terminal-button${variant === 'embedded' ? ' embedded icon-btn ghost' : ''}${recorder.recording ? ' recording' : ''}`}
      disabled={recorder.busy}
      title={recorder.recording ? 'Stop and paste voice input' : 'Record voice input'}
      aria-label={recorder.recording ? 'Stop and paste voice input' : 'Record voice input'}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => void onClick()}
    >
      {recorder.recording ? <span aria-hidden className="voice-stop-icon" /> : <MicrophoneIcon />}
    </button>
  );
}
