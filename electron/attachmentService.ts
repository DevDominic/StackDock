import fs from 'fs/promises';
import path from 'path';
import type { TerminalAttachment, TerminalAttachmentOptions, TerminalAttachmentSource } from '../src/shared/types';
import { getAttachmentCacheDir } from './storage';

const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MAX_PASTED_IMAGE_BYTES = 50 * 1024 * 1024;

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif']);

function threshold(options?: TerminalAttachmentOptions) {
  const value = options?.largeFileThresholdBytes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_LARGE_FILE_THRESHOLD_BYTES;
}

function mimeTypeFor(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.svg': return 'image/svg+xml';
    case '.avif': return 'image/avif';
    case '.heic': return 'image/heic';
    case '.heif': return 'image/heif';
    default: return undefined;
  }
}

async function attachmentFromPath(filePath: string, source: TerminalAttachmentSource, options?: TerminalAttachmentOptions, originalPath?: string): Promise<TerminalAttachment> {
  const stat = await fs.stat(filePath);
  const isDirectory = stat.isDirectory();
  const isLarge = stat.isFile() && stat.size > threshold(options);
  const referencePath = filePath;
  const isImage = !isDirectory && imageExtensions.has(path.extname(filePath).toLowerCase());
  return {
    id: `att_${crypto.randomUUID()}`,
    source,
    path: filePath,
    referencePath,
    name: path.basename(filePath) || filePath,
    mimeType: isImage ? mimeTypeFor(filePath) : undefined,
    sizeBytes: isDirectory ? undefined : stat.size,
    isDirectory,
    isImage,
    isLarge,
    originalPath,
  };
}

export async function inspectAttachmentPath(filePath: string, source: TerminalAttachmentSource, options?: TerminalAttachmentOptions): Promise<TerminalAttachment> {
  return attachmentFromPath(filePath, source, options);
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Invalid pasted image data');
  const mimeType = match[1] || 'image/png';
  const encoded = match[3];
  const bytes = match[2] ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded), 'utf8');
  return { mimeType, bytes };
}

function extensionForMime(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg': return '.jpg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/bmp': return '.bmp';
    case 'image/svg+xml': return '.svg';
    case 'image/avif': return '.avif';
    default: return '.png';
  }
}

function safeBaseName(name: string | undefined, fallback: string) {
  const cleaned = (name ?? '').replace(/[\\/:*?"<>|\0]+/g, '-').trim();
  return cleaned || fallback;
}

export async function savePastedImageAttachment(dataUrl: string, name?: string, options?: TerminalAttachmentOptions): Promise<TerminalAttachment> {
  const { mimeType, bytes } = parseDataUrl(dataUrl);
  if (!mimeType.toLowerCase().startsWith('image/')) throw new Error('Pasted data is not an image');
  if (bytes.byteLength > MAX_PASTED_IMAGE_BYTES) throw new Error('Pasted image is too large');
  const dir = getAttachmentCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const ext = extensionForMime(mimeType);
  const base = safeBaseName(name, `pasted-image-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const filePath = path.join(dir, `${base.endsWith(ext) ? base.slice(0, -ext.length) : base}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  await fs.writeFile(filePath, bytes);
  const attachment = await attachmentFromPath(filePath, 'paste-image', options);
  return { ...attachment, mimeType };
}
