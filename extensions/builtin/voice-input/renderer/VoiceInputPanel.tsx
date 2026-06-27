import { useEffect, useState } from 'react';
import { api } from '../../../../src/lib/api';
import { setExtensionConfig } from '../../../../src/extensions/configuration';
import { voiceInputExtensionManifest } from '../manifest';
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
  downloading?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
}

interface RuntimeStatus {
  supported: boolean;
  installed: boolean;
  path?: string;
  downloading?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

function formatBytes(bytes: number | undefined) {
  if (!bytes) return '';
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function progressText(status: { downloading?: boolean; downloadedBytes?: number; totalBytes?: number }) {
  if (!status.downloading) return '';
  const downloaded = formatBytes(status.downloadedBytes);
  if (!status.totalBytes) return downloaded ? `${downloaded} downloaded` : 'Downloading';
  const percent = Math.min(99, Math.floor(((status.downloadedBytes ?? 0) / status.totalBytes) * 100));
  return `${percent}% (${downloaded} / ${formatBytes(status.totalBytes)})`;
}

export function VoiceInputPanel({ activeSessionId, config }: Props) {
  const [transcript, setTranscript] = useState('');
  const [modelSize, setModelSize] = useState(config.modelSize || 'tiny');
  const effectiveConfig = { ...config, modelSize };
  const recorder = useVoiceInputRecorder(effectiveConfig, (text) => setTranscript((current) => [current, text].filter(Boolean).join(current && text ? '\n' : '')));
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const hasCustomModel = !!config.modelPath.trim();
  const modelReady = hasCustomModel || modelStatus?.installed === true;
  const runtimeReady = !!config.executablePath.trim() || runtimeStatus?.installed === true;
  const configured = runtimeReady && modelReady;

  useEffect(() => setModelSize(config.modelSize || 'tiny'), [config.modelSize]);

  useEffect(() => {
    if (hasCustomModel) {
      setModelStatus(null);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'modelStatus', [modelSize]).then((result) => {
      if (active) setModelStatus(result as ModelStatus);
    }).catch((error) => {
      if (active) recorder.setStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [modelSize, hasCustomModel]);

  useEffect(() => {
    if (config.executablePath.trim()) {
      setRuntimeStatus(null);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'runtimeStatus').then((result) => {
      if (active) setRuntimeStatus(result as RuntimeStatus);
    }).catch((error) => {
      if (active) recorder.setStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [config.executablePath]);

  useEffect(() => {
    if (!modelBusy && !runtimeBusy) return;
    const timer = window.setInterval(() => {
      if (!hasCustomModel) void api.extensions.invoke('stackdock.voiceInput', 'modelStatus', [modelSize]).then((result) => setModelStatus(result as ModelStatus)).catch(() => undefined);
      if (!config.executablePath.trim()) void api.extensions.invoke('stackdock.voiceInput', 'runtimeStatus').then((result) => setRuntimeStatus(result as RuntimeStatus)).catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  }, [modelBusy, runtimeBusy, hasCustomModel, modelSize, config.executablePath]);

  async function updateModelSize(next: string) {
    setModelSize(next);
    try {
      const settings = await api.settings.load();
      await api.settings.save(setExtensionConfig(settings, voiceInputExtensionManifest.id, { modelSize: next }));
    } catch (error) {
      recorder.setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadRuntime() {
    setRuntimeBusy(true);
    recorder.setStatus('Downloading whisper.cpp runtime...');
    try {
      const result = await api.extensions.invoke('stackdock.voiceInput', 'downloadRuntime') as RuntimeStatus;
      setRuntimeStatus(result);
      recorder.setStatus(result.installed ? 'whisper.cpp runtime installed' : result.message ?? 'Runtime setup did not complete');
    } catch (error) {
      recorder.setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function downloadModel() {
    setModelBusy(true);
    recorder.setStatus(`Downloading ${modelSize} model...`);
    try {
      const result = await api.extensions.invoke('stackdock.voiceInput', 'downloadModel', [modelSize]) as ModelStatus;
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
      <div className="voice-field">
        <label htmlFor="voice-model-size">Model</label>
        <select id="voice-model-size" value={modelSize} disabled={modelBusy || recorder.recording || recorder.busy} onChange={(event) => void updateModelSize(event.target.value)}>
          <option value="tiny">Tiny</option>
          <option value="base">Base</option>
        </select>
      </div>
      <div className="voice-model-card">
        <div>
          <strong>{config.executablePath.trim() ? 'Custom runtime' : 'whisper.cpp runtime'}</strong>
          <span className="muted">{config.executablePath.trim() ? config.executablePath : runtimeStatus?.installed ? 'Installed' : runtimeStatus?.downloading ? progressText(runtimeStatus) : runtimeStatus?.message ?? 'Not installed'}</span>
        </div>
        {!config.executablePath.trim() && runtimeStatus?.supported !== false && !runtimeStatus?.installed ? <button className="ghost" disabled={runtimeBusy || modelBusy || recorder.busy || recorder.recording} onClick={() => void downloadRuntime()}>{runtimeBusy || runtimeStatus?.downloading ? 'Downloading' : 'Install'}</button> : null}
      </div>
      <div className="voice-model-card">
        <div>
          <strong>{hasCustomModel ? 'Custom model' : `${modelStatus?.label ?? modelSize} model`}</strong>
          <span className="muted">{hasCustomModel ? config.modelPath : modelStatus?.installed ? `${formatBytes(modelStatus.bytes)} installed` : modelStatus?.downloading ? progressText(modelStatus) : 'Not installed'}</span>
        </div>
        {!hasCustomModel && !modelStatus?.installed ? <button className="ghost" disabled={modelBusy || runtimeBusy || recorder.busy || recorder.recording} onClick={() => void downloadModel()}>{modelBusy || modelStatus?.downloading ? 'Downloading' : 'Download'}</button> : null}
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
