import { useEffect, useState } from 'react';
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

interface ModelStatus {
  installed: boolean;
}

interface RuntimeStatus {
  installed: boolean;
}

export function VoiceInputTerminalButton({ activeSessionId, config, variant = 'floating', onTranscript }: Props) {
  const { showToast } = useToast();
  const [modelInstalled, setModelInstalled] = useState(false);
  const [runtimeInstalled, setRuntimeInstalled] = useState(false);
  const hasCustomModel = !!config.modelPath.trim();
  const hasCustomRuntime = !!config.executablePath.trim();
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
  const configured = !!activeSessionId && (hasCustomRuntime || runtimeInstalled) && (hasCustomModel || modelInstalled);

  useEffect(() => {
    if (hasCustomModel) {
      setModelInstalled(true);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'modelStatus', [config.modelSize]).then((result) => {
      if (active) setModelInstalled((result as ModelStatus).installed === true);
    }).catch(() => {
      if (active) setModelInstalled(false);
    });
    return () => { active = false; };
  }, [config.modelSize, hasCustomModel]);

  useEffect(() => {
    if (hasCustomRuntime) {
      setRuntimeInstalled(true);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'runtimeStatus').then((result) => {
      if (active) setRuntimeInstalled((result as RuntimeStatus).installed === true);
    }).catch(() => {
      if (active) setRuntimeInstalled(false);
    });
    return () => { active = false; };
  }, [hasCustomRuntime]);

  async function onClick() {
    if (!configured) {
      showToast('Set up Voice Input from the Voice Input panel before recording.', 'info');
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
