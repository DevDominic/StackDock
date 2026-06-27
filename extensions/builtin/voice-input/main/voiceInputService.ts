import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { getDataDir } from '../../../../electron/storage';

const execFileAsync = promisify(execFile);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export type VoiceInputModelSize = 'tiny' | 'base';

export const VOICE_INPUT_MODELS: Record<VoiceInputModelSize, { label: string; fileName: string; url: string }> = {
  tiny: { label: 'Tiny', fileName: 'ggml-tiny.en-q5_1.bin', url: `${MODEL_BASE_URL}/ggml-tiny.en-q5_1.bin` },
  base: { label: 'Base', fileName: 'ggml-base.en-q5_1.bin', url: `${MODEL_BASE_URL}/ggml-base.en-q5_1.bin` },
};

export interface VoiceInputTranscribeOptions {
  executablePath: string;
  modelPath?: string;
  modelSize?: VoiceInputModelSize;
  language?: string;
}

export interface VoiceInputTranscription {
  text: string;
}

export interface VoiceInputModelStatus {
  modelSize: VoiceInputModelSize;
  label: string;
  fileName: string;
  path: string;
  installed: boolean;
  bytes?: number;
}

function stringArg(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`);
  return value.trim();
}

function absolutePathArg(value: unknown, name: string) {
  const targetPath = stringArg(value, name);
  if (!path.isAbsolute(targetPath)) throw new Error(`${name} must be an absolute path`);
  return targetPath;
}

function optionalAbsolutePathArg(value: unknown, name: string) {
  if (value == null || value === '') return undefined;
  return absolutePathArg(value, name);
}

function languageArg(value: unknown) {
  const language = typeof value === 'string' && value.trim() ? value.trim() : 'en';
  if (!/^[a-zA-Z-]{2,12}$/.test(language)) throw new Error('language must be a whisper.cpp language code');
  return language;
}

function modelSizeArg(value: unknown): VoiceInputModelSize {
  const modelSize = typeof value === 'string' && value.trim() ? value.trim() : 'tiny';
  if (modelSize !== 'tiny' && modelSize !== 'base') throw new Error('modelSize must be tiny or base');
  return modelSize;
}

function decodeAudioBase64(value: unknown) {
  const audioBase64 = stringArg(value, 'audioBase64');
  const bytes = Buffer.from(audioBase64, 'base64');
  if (!bytes.length) throw new Error('audioBase64 decoded to an empty file');
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error(`audioBase64 exceeds ${MAX_AUDIO_BYTES} bytes`);
  return bytes;
}

function cleanWhisperText(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, '').trim()).filter(Boolean).join(' ').trim();
}

export function getVoiceInputModelsDir(rootDir = getDataDir()) {
  return path.join(rootDir, 'voice-input', 'models');
}

export function getVoiceInputModelPath(modelSize: VoiceInputModelSize, rootDir = getDataDir()) {
  return path.join(getVoiceInputModelsDir(rootDir), VOICE_INPUT_MODELS[modelSize].fileName);
}

export async function getVoiceInputModelStatus(rawModelSize: unknown, rootDir = getDataDir()): Promise<VoiceInputModelStatus> {
  const modelSize = modelSizeArg(rawModelSize);
  const model = VOICE_INPUT_MODELS[modelSize];
  const modelPath = getVoiceInputModelPath(modelSize, rootDir);
  try {
    const stat = await fs.stat(modelPath);
    return { modelSize, label: model.label, fileName: model.fileName, path: modelPath, installed: stat.isFile(), bytes: stat.size };
  } catch {
    return { modelSize, label: model.label, fileName: model.fileName, path: modelPath, installed: false };
  }
}

export async function downloadVoiceInputModel(rawModelSize: unknown, rootDir = getDataDir()): Promise<VoiceInputModelStatus> {
  const modelSize = modelSizeArg(rawModelSize);
  const model = VOICE_INPUT_MODELS[modelSize];
  const modelPath = getVoiceInputModelPath(modelSize, rootDir);
  const partialPath = `${modelPath}.partial`;
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`Could not download ${model.label} model: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Downloaded ${model.label} model was empty`);
  await fs.writeFile(partialPath, bytes);
  await fs.rename(partialPath, modelPath);
  return getVoiceInputModelStatus(modelSize, rootDir);
}

export async function transcribeVoiceInput(audioBase64: unknown, rawOptions: unknown): Promise<VoiceInputTranscription> {
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions as Partial<VoiceInputTranscribeOptions> : {};
  const executablePath = absolutePathArg(options.executablePath, 'executablePath');
  const modelSize = modelSizeArg(options.modelSize);
  const customModelPath = optionalAbsolutePathArg(options.modelPath, 'modelPath');
  const modelPath = customModelPath ?? getVoiceInputModelPath(modelSize);
  const language = languageArg(options.language);
  const audioBytes = decodeAudioBase64(audioBase64);
  try {
    const stat = await fs.stat(modelPath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(customModelPath ? `Voice model file does not exist: ${modelPath}` : `Voice model ${modelSize} is not installed. Download it first or configure a custom model path.`);
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-voice-'));
  const wavPath = path.join(tmpDir, 'input.wav');
  const outputBase = path.join(tmpDir, 'transcript');
  const outputPath = `${outputBase}.txt`;

  try {
    await fs.writeFile(wavPath, audioBytes);
    const args = ['-m', modelPath, '-f', wavPath, '-l', language, '-otxt', '-of', outputBase, '-nt'];
    const result = await execFileAsync(executablePath, args, { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 * 4 });
    let transcript = '';
    try {
      transcript = await fs.readFile(outputPath, 'utf8');
    } catch {
      transcript = result.stdout;
    }
    return { text: cleanWhisperText(transcript) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
