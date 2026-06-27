import { useEffect, useState } from 'react';
import { api } from '../../../../src/lib/api';
import { useVoiceInputRecorder, type VoiceInputConfig } from './voiceInputRecording';

interface Props {
  activeSessionId: string | null;
  config: VoiceInputConfig;
}

interface ModelStatus {
  modelSize: string;
  label: string;
  fileName: string;
  path: string;
  installed: boolean;
  bytes?: number;
}

function formatBytes(bytes: number | undefined) {
  if (!bytes) return '';
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

export function VoiceInputPanel({ activeSessionId, config }: Props) {
  const [transcript, setTranscript] = useState('');
  const recorder = useVoiceInputRecorder(config, (text) => setTranscript((current) => [current, text].filter(Boolean).join(current && text ? '\n' : '')));
  const [modelBusy, setModelBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const hasCustomModel = !!config.modelPath.trim();
  const modelReady = hasCustomModel || modelStatus?.installed === true;
  const configured = !!config.executablePath && modelReady;

  useEffect(() => {
    if (hasCustomModel) {
      setModelStatus(null);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'modelStatus', [config.modelSize]).then((result) => {
      if (active) setModelStatus(result as ModelStatus);
    }).catch((error) => {
      if (active) recorder.setStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [config.modelSize, hasCustomModel]);

  async function downloadModel() {
    setModelBusy(true);
    recorder.setStatus(`Downloading ${config.modelSize} model...`);
    try {
      const result = await api.extensions.invoke('stackdock.voiceInput', 'downloadModel', [config.modelSize]) as ModelStatus;
      setModelStatus(result);
      recorder.setStatus(`${result.label} model installed`);
    } catch (error) {
      recorder.setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setModelBusy(false);
    }
  }

  async function toggleRecording() {
    if (!configured) {
      recorder.setStatus('Set up Voice Input in Settings > Extensions.');
      return;
    }
    try {
      await recorder.toggleRecording();
    } catch (error) {
      recorder.setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function sendToTerminal() {
    if (!activeSessionId || !transcript.trim()) return;
    await api.terminal.write(activeSessionId, transcript.trim());
    recorder.setStatus('Sent to active terminal');
  }

  return (
    <aside className="panel voice-input-panel">
      <div className="panel-title voice-input-title">
        <span>Voice Input</span>
        <small>{recorder.recording ? 'recording' : recorder.busy ? 'busy' : 'local'}</small>
      </div>
      {!config.executablePath ? (
        <div className="banner voice-input-warning">
          Configure the whisper.cpp executable path in Settings &gt; Extensions before recording.
        </div>
      ) : null}
      <div className="voice-model-card">
        <div>
          <strong>{hasCustomModel ? 'Custom model' : `${modelStatus?.label ?? config.modelSize} model`}</strong>
          <span className="muted">{hasCustomModel ? config.modelPath : modelStatus?.installed ? `${formatBytes(modelStatus.bytes)} installed` : 'Not installed'}</span>
        </div>
        {!hasCustomModel && !modelStatus?.installed ? <button className="ghost" disabled={modelBusy || recorder.busy || recorder.recording} onClick={() => void downloadModel()}>{modelBusy ? 'Downloading' : 'Download'}</button> : null}
      </div>
      <button className={recorder.recording ? 'primary danger voice-record-button' : 'primary voice-record-button'} disabled={recorder.busy} onClick={() => void toggleRecording()}>
        {recorder.recording ? 'Stop and Transcribe' : 'Record'}
      </button>
      <div className="voice-input-status muted">{recorder.status}</div>
      <textarea className="voice-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Transcript" spellCheck />
      <div className="voice-input-actions">
        <button className="ghost" disabled={!transcript.trim() || !activeSessionId} onClick={() => void sendToTerminal()}>Send</button>
        <button className="ghost" disabled={!transcript.trim()} onClick={() => { navigator.clipboard.writeText(transcript); recorder.setStatus('Copied'); }}>Copy</button>
        <button className="ghost danger" disabled={!transcript} onClick={() => setTranscript('')}>Clear</button>
      </div>
    </aside>
  );
}
