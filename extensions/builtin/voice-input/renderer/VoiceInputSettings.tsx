import { useEffect, useState } from 'react';
import { api } from '../../../../src/lib/api';
import type { ExtensionConfigPrimitive } from '../../../../src/shared/types';
import type { VoiceInputConfig } from './voiceInputRecording';

interface Props {
  config: VoiceInputConfig;
  setConfig(patch: Record<string, ExtensionConfigPrimitive>): void;
}

interface ModelStatus {
  modelSize: string;
  label: string;
  installed: boolean;
  bytes?: number;
  downloading?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
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

export function VoiceInputSettings({ config, setConfig }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [status, setStatus] = useState('');
  const hasCustomRuntime = !!config.executablePath.trim();
  const hasCustomModel = !!config.modelPath.trim();

  useEffect(() => {
    let active = true;
    navigator.mediaDevices?.enumerateDevices().then((items) => {
      if (active) setDevices(items.filter((item) => item.kind === 'audioinput'));
    }).catch((error) => {
      if (active) setDeviceError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (hasCustomModel) {
      setModelStatus(null);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'modelStatus', [config.modelSize || 'base']).then((result) => {
      if (active) setModelStatus(result as ModelStatus);
    }).catch((error) => {
      if (active) setStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [config.modelSize, hasCustomModel]);

  useEffect(() => {
    if (hasCustomRuntime) {
      setRuntimeStatus(null);
      return;
    }
    let active = true;
    api.extensions.invoke('stackdock.voiceInput', 'runtimeStatus').then((result) => {
      if (active) setRuntimeStatus(result as RuntimeStatus);
    }).catch((error) => {
      if (active) setStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [hasCustomRuntime]);

  useEffect(() => {
    if (!modelBusy && !runtimeBusy) return;
    const timer = window.setInterval(() => {
      if (!hasCustomModel) void api.extensions.invoke('stackdock.voiceInput', 'modelStatus', [config.modelSize || 'base']).then((result) => setModelStatus(result as ModelStatus)).catch(() => undefined);
      if (!hasCustomRuntime) void api.extensions.invoke('stackdock.voiceInput', 'runtimeStatus').then((result) => setRuntimeStatus(result as RuntimeStatus)).catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  }, [modelBusy, runtimeBusy, hasCustomModel, hasCustomRuntime, config.modelSize]);

  async function downloadRuntime() {
    setRuntimeBusy(true);
    setStatus('Downloading whisper.cpp runtime...');
    try {
      const result = await api.extensions.invoke('stackdock.voiceInput', 'downloadRuntime') as RuntimeStatus;
      setRuntimeStatus(result);
      setStatus(result.installed ? 'whisper.cpp runtime installed' : result.message ?? 'Runtime setup did not complete');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function downloadModel() {
    setModelBusy(true);
    setStatus(`Downloading ${config.modelSize || 'base'} model...`);
    try {
      const result = await api.extensions.invoke('stackdock.voiceInput', 'downloadModel', [config.modelSize || 'base']) as ModelStatus;
      setModelStatus(result);
      setStatus(`${result.label} model installed`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setModelBusy(false);
    }
  }

  return (
    <div className="extension-config-form voice-settings-form">
      <label>Microphone
        <select value={config.microphoneDeviceId} onChange={(event) => setConfig({ microphoneDeviceId: event.target.value })}>
          <option value="">System default</option>
          {devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        </select>
        <span className="muted code-font-note">{deviceError ? `Could not list microphones: ${deviceError}` : 'Browser privacy may hide names until microphone permission is granted.'}</span>
      </label>
      <label>Managed model
        <select value={config.modelSize || 'base'} onChange={(event) => setConfig({ modelSize: event.target.value })}>
          <option value="base">Base (more accurate)</option>
          <option value="tiny">Tiny (fastest)</option>
        </select>
        <span className="muted code-font-note">Base is the default; Tiny remains available for faster transcription.</span>
      </label>
      <label>Language<input value={config.language} onChange={(event) => setConfig({ language: event.target.value })} /><span className="muted code-font-note">whisper.cpp language code. Use en for the managed English models.</span></label>
      <label>Custom whisper.cpp executable path<input value={config.executablePath} onChange={(event) => setConfig({ executablePath: event.target.value })} /><span className="muted code-font-note">Optional. Overrides the managed runtime below.</span></label>
      <label>Custom model path<input value={config.modelPath} onChange={(event) => setConfig({ modelPath: event.target.value })} /><span className="muted code-font-note">Optional. Overrides the managed model below.</span></label>
      <div className="voice-model-card">
        <div>
          <strong>{hasCustomRuntime ? 'Custom runtime' : 'whisper.cpp runtime'}</strong>
          <span className="muted">{hasCustomRuntime ? config.executablePath : runtimeStatus?.installed ? 'Installed' : runtimeStatus?.downloading ? progressText(runtimeStatus) : runtimeStatus?.message ?? 'Not installed'}</span>
        </div>
        {!hasCustomRuntime && runtimeStatus?.supported !== false && !runtimeStatus?.installed ? <button className="ghost" disabled={runtimeBusy || modelBusy} onClick={() => void downloadRuntime()}>{runtimeBusy || runtimeStatus?.downloading ? 'Downloading' : 'Install'}</button> : null}
      </div>
      <div className="voice-model-card">
        <div>
          <strong>{hasCustomModel ? 'Custom model' : `${modelStatus?.label ?? (config.modelSize || 'Base')} model`}</strong>
          <span className="muted">{hasCustomModel ? config.modelPath : modelStatus?.installed ? `${formatBytes(modelStatus.bytes)} installed` : modelStatus?.downloading ? progressText(modelStatus) : 'Not installed'}</span>
        </div>
        {!hasCustomModel && !modelStatus?.installed ? <button className="ghost" disabled={runtimeBusy || modelBusy} onClick={() => void downloadModel()}>{modelBusy || modelStatus?.downloading ? 'Downloading' : 'Download'}</button> : null}
      </div>
      {status ? <div className="voice-input-status muted">{status}</div> : null}
    </div>
  );
}
