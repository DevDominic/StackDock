import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { getVoiceInputModelPath, getVoiceInputModelStatus, getVoiceInputRuntimeDir, getVoiceInputRuntimeStatus, transcribeVoiceInput } from '../extensions/builtin/voice-input/main/voiceInputService';

const validOptions = {
  executablePath: path.join(process.cwd(), process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
  modelPath: path.join(process.cwd(), 'ggml-tiny.en-q5_1.bin'),
  language: 'en',
};

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('voiceInputService', () => {
  it('validates custom executable and model paths before transcription', async () => {
    await expect(transcribeVoiceInput('audio', { executablePath: 'whisper-cli', modelPath: validOptions.modelPath })).rejects.toThrow('executablePath must be an absolute path');
    await expect(transcribeVoiceInput('audio', { executablePath: validOptions.executablePath, modelPath: 'model.bin' })).rejects.toThrow('modelPath must be an absolute path');
  });

  it('rejects invalid language values before running a local process', async () => {
    await expect(transcribeVoiceInput('audio', { ...validOptions, language: '../en' })).rejects.toThrow('language must be a whisper.cpp language code');
  });

  it('rejects invalid managed model selections before running a local process', async () => {
    await expect(transcribeVoiceInput('audio', { ...validOptions, modelPath: '', modelSize: 'large' })).rejects.toThrow('modelSize must be tiny or base');
  });

  it('rejects empty microphone payloads before running a local process', async () => {
    await expect(transcribeVoiceInput('', validOptions)).rejects.toThrow('audioBase64 required');
    await expect(transcribeVoiceInput('====', validOptions)).rejects.toThrow('audioBase64 decoded to an empty file');
  });

  it('reports managed model install state from the StackDock model directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-voice-test-'));
    tempDirs.push(root);
    await expect(getVoiceInputModelStatus('tiny', root)).resolves.toMatchObject({ modelSize: 'tiny', installed: false });
    const modelPath = getVoiceInputModelPath('tiny', root);
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(modelPath, 'model');
    await expect(getVoiceInputModelStatus('tiny', root)).resolves.toMatchObject({ modelSize: 'tiny', installed: true, bytes: 5 });
  });

  it('reports managed model download progress from partial files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-voice-test-'));
    tempDirs.push(root);
    const modelPath = getVoiceInputModelPath('base', root);
    const partialPath = `${modelPath}.partial`;
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(partialPath, 'partial');
    await fs.writeFile(`${partialPath}.json`, JSON.stringify({ totalBytes: 14 }));
    await expect(getVoiceInputModelStatus('base', root)).resolves.toMatchObject({ modelSize: 'base', installed: false, downloading: true, downloadedBytes: 7, totalBytes: 14 });
  });

  it('prefers whisper-cli over deprecated main when both runtime binaries are installed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stackdock-voice-test-'));
    tempDirs.push(root);
    const releaseDir = path.join(getVoiceInputRuntimeDir(root), 'Release');
    const cliName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const mainName = process.platform === 'win32' ? 'main.exe' : 'main';
    await fs.mkdir(releaseDir, { recursive: true });
    await fs.writeFile(path.join(releaseDir, mainName), '');
    await fs.writeFile(path.join(releaseDir, cliName), '');

    await expect(getVoiceInputRuntimeStatus(root)).resolves.toMatchObject({
      installed: true,
      path: path.join(releaseDir, cliName),
    });
  });
});
