import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { getVoiceInputModelPath, getVoiceInputModelStatus, transcribeVoiceInput } from '../extensions/builtin/voice-input/main/voiceInputService';

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
  it('requires explicit local executable and model paths before transcription', async () => {
    await expect(transcribeVoiceInput('audio', {})).rejects.toThrow('executablePath required');
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
});
