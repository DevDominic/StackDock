import { useRef, useState } from 'react';
import { api } from '../../../../src/lib/api';

export interface VoiceInputConfig {
  executablePath: string;
  modelPath: string;
  modelSize: string;
  language: string;
}

interface RecorderHandle {
  context: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  chunks: Float32Array[];
  sampleRate: number;
}

function mergeChunks(chunks: Float32Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsample(samples: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const length = Math.floor(samples.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += samples[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const targetRate = 16000;
  const pcm = downsample(samples, sampleRate, targetRate);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (const sample of pcm) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function useVoiceInputRecorder(config: VoiceInputConfig, onText: (text: string) => void | Promise<void>) {
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');

  async function startRecording() {
    setStatus('Requesting microphone...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      event.outputBuffer.getChannelData(0).fill(0);
    };
    source.connect(processor);
    processor.connect(context.destination);
    recorderRef.current = { context, processor, source, stream, chunks, sampleRate: context.sampleRate };
    setRecording(true);
    setStatus('Recording');
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    recorder.processor.disconnect();
    recorder.source.disconnect();
    recorder.stream.getTracks().forEach((track) => track.stop());
    await recorder.context.close();
    setRecording(false);
    setBusy(true);
    setStatus('Transcribing locally...');
    try {
      const wav = encodeWav(mergeChunks(recorder.chunks), recorder.sampleRate);
      const result = await api.extensions.invoke('stackdock.voiceInput', 'transcribe', [bytesToBase64(wav), config]) as { text?: unknown };
      const text = typeof result.text === 'string' ? result.text : '';
      if (text) await onText(text);
      setStatus(text ? 'Transcribed' : 'No speech detected');
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) return stopRecording();
    await startRecording();
    return undefined;
  }

  return { recording, busy, status, setStatus, toggleRecording };
}
