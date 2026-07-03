import { useState } from 'react';
import { api } from '../../../../src/lib/api';
import { useVoiceInputRecorder, type VoiceInputConfig } from './voiceInputRecording';

interface Props {
  activeSessionId: string | null;
  config: VoiceInputConfig;
}

export function VoiceInputPanel({ activeSessionId, config }: Props) {
  const [transcript, setTranscript] = useState('');
  const recorder = useVoiceInputRecorder(config, (text) => setTranscript((current) => [current, text].filter(Boolean).join(current && text ? '\n' : '')));

  async function toggleRecording() {
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
