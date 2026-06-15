import fs from 'fs/promises';
import path from 'path';
import { shell } from 'electron';
import type { DirectoryEntry, ReadFileDataUrlResult, ReadFileResult } from '../src/shared/types';

const noisyFolders = new Set(['node_modules', 'dist', 'build', 'target', '.cache']);

const mimeByExtension: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

function mimeTypeFor(filePath: string) {
  return mimeByExtension[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export async function readDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => !noisyFolders.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      hidden: entry.name.startsWith('.'),
    }));
}

export async function readFile(filePath: string): Promise<ReadFileResult> {
  return { path: filePath, content: await fs.readFile(filePath, 'utf8') };
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export async function readFileDataUrl(filePath: string): Promise<ReadFileDataUrlResult> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_MEDIA_BYTES) throw new Error(`File too large to preview (${Math.round(stat.size / 1024 / 1024)} MB). Maximum is 50 MB.`);
  const buffer = await fs.readFile(filePath);
  const mimeType = mimeTypeFor(filePath);
  return { path: filePath, mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` };
}

export async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

export async function createFile(filePath: string) {
  await writeFile(filePath, '');
}

export async function createFolder(folderPath: string) {
  await fs.mkdir(folderPath, { recursive: true });
}

export async function renamePath(oldPath: string, newPath: string) {
  await fs.rename(oldPath, newPath);
}

export async function deletePath(targetPath: string) {
  try {
    await shell.trashItem(targetPath);
  } catch {
    await fs.rm(targetPath, { recursive: true, force: false });
  }
}

export async function revealInExplorer(targetPath: string) {
  await shell.showItemInFolder(targetPath);
}
