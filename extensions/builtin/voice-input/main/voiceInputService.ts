import { execFile } from 'child_process';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { getDataDir } from '../../../../electron/storage';

const execFileAsync = promisify(execFile);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const WHISPER_RELEASE_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest';
const WHISPER_CPP_CLI_PYPI_API = 'https://pypi.org/pypi/whisper.cpp-cli/json';

export type VoiceInputModelSize = 'tiny' | 'base';

export const VOICE_INPUT_MODELS: Record<VoiceInputModelSize, { label: string; fileName: string; url: string }> = {
  tiny: { label: 'Tiny', fileName: 'ggml-tiny.en-q5_1.bin', url: `${MODEL_BASE_URL}/ggml-tiny.en-q5_1.bin` },
  base: { label: 'Base', fileName: 'ggml-base.en-q5_1.bin', url: `${MODEL_BASE_URL}/ggml-base.en-q5_1.bin` },
};

export interface VoiceInputTranscribeOptions {
  executablePath?: string;
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
  downloading?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface VoiceInputRuntimeStatus {
  supported: boolean;
  installed: boolean;
  path?: string;
  downloading?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
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

function processFailureMessage(error: unknown, fallback: string) {
  const value = error as { message?: unknown; stderr?: unknown; stdout?: unknown; code?: unknown } | null;
  const stderr = typeof value?.stderr === 'string' ? value.stderr.trim() : '';
  const stdout = typeof value?.stdout === 'string' ? value.stdout.trim() : '';
  const detail = stderr || stdout || (typeof value?.message === 'string' ? value.message : '');
  const code = typeof value?.code === 'number' || typeof value?.code === 'string' ? ` (exit ${value.code})` : '';
  return detail ? `${fallback}${code}: ${detail}` : `${fallback}${code}`;
}

async function readDownloadTotalBytes(partialPath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(`${partialPath}.json`, 'utf8')) as { totalBytes?: unknown };
    return typeof parsed.totalBytes === 'number' && Number.isFinite(parsed.totalBytes) ? parsed.totalBytes : undefined;
  } catch {
    return undefined;
  }
}

export function getVoiceInputModelsDir(rootDir = getDataDir()) {
  return path.join(rootDir, 'voice-input', 'models');
}

export function getVoiceInputRuntimeDir(rootDir = getDataDir()) {
  return path.join(rootDir, 'voice-input', 'runtime');
}

function getRuntimeArchivePath(rootDir = getDataDir()) {
  return path.join(getVoiceInputRuntimeDir(rootDir), process.platform === 'linux' ? 'whisper.cpp.tar.gz' : 'whisper.cpp.zip');
}

function isZipRuntimeArchive(archivePath: string) {
  return /\.(zip|whl)$/i.test(archivePath);
}

function powerShellSingleQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function getVoiceInputModelPath(modelSize: VoiceInputModelSize, rootDir = getDataDir()) {
  return path.join(getVoiceInputModelsDir(rootDir), VOICE_INPUT_MODELS[modelSize].fileName);
}

export async function getVoiceInputModelStatus(rawModelSize: unknown, rootDir = getDataDir()): Promise<VoiceInputModelStatus> {
  const modelSize = modelSizeArg(rawModelSize);
  const model = VOICE_INPUT_MODELS[modelSize];
  const modelPath = getVoiceInputModelPath(modelSize, rootDir);
  const partialPath = `${modelPath}.partial`;
  try {
    const stat = await fs.stat(modelPath);
    return { modelSize, label: model.label, fileName: model.fileName, path: modelPath, installed: stat.isFile(), bytes: stat.size };
  } catch {
    try {
      const partialStat = await fs.stat(partialPath);
      return { modelSize, label: model.label, fileName: model.fileName, path: modelPath, installed: false, downloading: true, downloadedBytes: partialStat.size, totalBytes: await readDownloadTotalBytes(partialPath) };
    } catch {
      return { modelSize, label: model.label, fileName: model.fileName, path: modelPath, installed: false };
    }
  }
}

async function downloadFile(url: string, targetPath: string, partialPath: string): Promise<number | undefined> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const totalBytes = Number(response.headers.get('content-length') ?? '') || undefined;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(partialPath, { force: true });
  await fs.rm(`${partialPath}.json`, { force: true });
  if (totalBytes) await fs.writeFile(`${partialPath}.json`, JSON.stringify({ totalBytes }));
  const handle = await fs.open(partialPath, 'w');
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('Downloaded file was empty');
      await handle.write(bytes);
    } else {
      let wrote = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        const chunk = Buffer.from(value);
        await handle.write(chunk);
        wrote += chunk.length;
      }
      if (!wrote) throw new Error('Downloaded file was empty');
    }
  } finally {
    await handle.close();
  }
  await fs.rename(partialPath, targetPath);
  await fs.rm(`${partialPath}.json`, { force: true });
  return totalBytes;
}

export async function downloadVoiceInputModel(rawModelSize: unknown, rootDir = getDataDir()): Promise<VoiceInputModelStatus> {
  const modelSize = modelSizeArg(rawModelSize);
  const model = VOICE_INPUT_MODELS[modelSize];
  const modelPath = getVoiceInputModelPath(modelSize, rootDir);
  const partialPath = `${modelPath}.partial`;
  await downloadFile(model.url, modelPath, partialPath);
  return getVoiceInputModelStatus(modelSize, rootDir);
}

function runtimeExecutableNames() {
  return process.platform === 'win32'
    ? ['whisper-cli.exe', 'whisper.exe', 'main.exe', 'whisper-cpp.exe']
    : ['whisper-cli', 'whisper', 'main', 'whisper-cpp'];
}

async function findRuntimeExecutable(rootDir: string): Promise<string | undefined> {
  const wanted = runtimeExecutableNames();
  const priority = new Map(wanted.map((name, index) => [name, index]));
  async function walk(dir: string): Promise<string | undefined> {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    const executable = entries
      .filter((entry) => entry.isFile() && wanted.includes(entry.name))
      .sort((a, b) => (priority.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b.name) ?? Number.MAX_SAFE_INTEGER))[0];
    if (executable) return path.join(dir, executable.name);
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(target);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(rootDir);
}

function runtimeAssetPattern() {
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return /^whisper-bin-x64\.zip$/i;
    if (process.arch === 'ia32') return /^whisper-bin-Win32\.zip$/i;
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return /^whisper-bin-ubuntu-x64\.tar\.gz$/i;
    if (process.arch === 'arm64') return /^whisper-bin-ubuntu-arm64\.tar\.gz$/i;
  }
  return undefined;
}

function pypiWheelPattern() {
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') return /-macosx_\d+_\d+_arm64\.whl$/i;
    if (process.arch === 'x64') return /-macosx_\d+_\d+_x86_64\.whl$/i;
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return /-manylinux_.*_x86_64\..*\.whl$/i;
    if (process.arch === 'arm64') return /-manylinux_.*_aarch64\..*\.whl$/i;
    if (process.arch === 'ia32') return /-manylinux_.*_i686\..*\.whl$/i;
  }
  return undefined;
}

export async function getVoiceInputRuntimeStatus(rootDir = getDataDir()): Promise<VoiceInputRuntimeStatus> {
  const runtimeDir = getVoiceInputRuntimeDir(rootDir);
  const executablePath = await findRuntimeExecutable(runtimeDir);
  if (executablePath) return { supported: true, installed: true, path: executablePath };
  const pattern = runtimeAssetPattern() ?? pypiWheelPattern();
  if (!pattern) return { supported: false, installed: false, message: `Managed whisper.cpp runtime is not supported on ${process.platform}/${process.arch}. Configure a custom executable path.` };
  const partialPath = `${getRuntimeArchivePath(rootDir)}.partial`;
  try {
    const partialStat = await fs.stat(partialPath);
    return { supported: true, installed: false, downloading: true, downloadedBytes: partialStat.size, totalBytes: await readDownloadTotalBytes(partialPath) };
  } catch {
    return { supported: true, installed: false };
  }
}

async function getPypiRuntimeWheelUrl() {
  const pattern = pypiWheelPattern();
  if (!pattern) return undefined;
  const response = await fetch(WHISPER_CPP_CLI_PYPI_API, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Could not fetch whisper.cpp-cli package metadata: HTTP ${response.status}`);
  const metadata = await response.json() as { info?: { version?: unknown }; releases?: Record<string, Array<{ filename?: unknown; url?: unknown }>> };
  const version = typeof metadata.info?.version === 'string' ? metadata.info.version : undefined;
  const files = version ? metadata.releases?.[version] ?? [] : [];
  const wheel = files.find((item) => typeof item.filename === 'string' && pattern.test(item.filename));
  return typeof wheel?.url === 'string' ? wheel.url : undefined;
}

async function getLatestRuntimeAssetUrl() {
  const pattern = runtimeAssetPattern();
  if (pattern) {
    const response = await fetch(WHISPER_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Could not fetch whisper.cpp release metadata: HTTP ${response.status}`);
    const release = await response.json() as { assets?: Array<{ name?: unknown; browser_download_url?: unknown }> };
    const asset = (release.assets ?? []).find((item) => typeof item.name === 'string' && pattern.test(item.name));
    if (typeof asset?.browser_download_url === 'string') return asset.browser_download_url;
  }
  const wheelUrl = await getPypiRuntimeWheelUrl();
  if (wheelUrl) return wheelUrl;
  throw new Error(`Managed whisper.cpp runtime is not supported on ${process.platform}/${process.arch}. Configure a custom executable path.`);
}

export async function downloadVoiceInputRuntime(rootDir = getDataDir()): Promise<VoiceInputRuntimeStatus> {
  const runtimeDir = getVoiceInputRuntimeDir(rootDir);
  const archivePath = getRuntimeArchivePath(rootDir);
  const partialPath = `${archivePath}.partial`;
  await fs.mkdir(runtimeDir, { recursive: true });
  const assetUrl = await getLatestRuntimeAssetUrl();
  await downloadFile(assetUrl, archivePath, partialPath);
  if (process.platform === 'win32') {
    const expandCommand = `Expand-Archive -LiteralPath ${powerShellSingleQuoted(archivePath)} -DestinationPath ${powerShellSingleQuoted(runtimeDir)} -Force`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', expandCommand], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  } else if (process.platform === 'linux' && !isZipRuntimeArchive(assetUrl)) {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', runtimeDir], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } else if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-x', '-k', archivePath, runtimeDir], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } else if (process.platform === 'linux') {
    await execFileAsync('unzip', ['-o', archivePath, '-d', runtimeDir], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } else {
    throw new Error(`Managed whisper.cpp runtime extraction is not supported on ${process.platform}. Configure a custom executable path.`);
  }
  const executablePath = await findRuntimeExecutable(runtimeDir);
  if (executablePath) await fs.chmod(executablePath, 0o755).catch(() => undefined);
  return getVoiceInputRuntimeStatus(rootDir);
}

export async function transcribeVoiceInput(audioBase64: unknown, rawOptions: unknown): Promise<VoiceInputTranscription> {
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions as Partial<VoiceInputTranscribeOptions> : {};
  const customExecutablePath = optionalAbsolutePathArg(options.executablePath, 'executablePath');
  const runtimeStatus = customExecutablePath ? null : await getVoiceInputRuntimeStatus();
  const executablePath = customExecutablePath ?? runtimeStatus?.path;
  if (!executablePath) throw new Error('Voice runtime is not installed. Install whisper.cpp from the Voice Input panel or configure a custom executable path.');
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
    let result: { stdout: string; stderr: string };
    try {
      result = await execFileAsync(executablePath, args, { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 * 4 });
    } catch (error) {
      throw new Error(processFailureMessage(error, 'whisper.cpp transcription failed'));
    }
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
