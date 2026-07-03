import fs from 'fs/promises';
import path from 'path';
import { shell } from 'electron';
import type { DirectoryEntry, ReadFileDataUrlResult, ReadFileResult, WorkspaceFileSearchOptions } from '../src/shared/types';

const noisyFolders = new Set(['node_modules', 'dist', 'build', 'target', '.cache']);
const searchIgnoredFolders = new Set([...noisyFolders, '.git', '.hg', '.svn', '.next', '.nuxt', '.turbo', '.vite', '.parcel-cache', '.pytest_cache', '__pycache__', 'coverage']);
const DEFAULT_SEARCH_MAX_RESULTS = 100;
const HARD_SEARCH_MAX_RESULTS = 500;
const DEFAULT_SEARCH_MAX_DEPTH = 10;

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

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

export async function readDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return [];
    throw error;
  }
  return entries
    .filter((entry) => !noisyFolders.has(entry.name))
    .sort(compareDirents)
    .map((entry) => directoryEntry(dirPath, entry));
}

function compareDirents(a: import('fs').Dirent, b: import('fs').Dirent) {
  return Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name);
}

function directoryEntry(parentPath: string, entry: import('fs').Dirent): DirectoryEntry {
  return {
    name: entry.name,
    path: path.join(parentPath, entry.name),
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
    hidden: entry.name.startsWith('.'),
  };
}

function normalizedRelativePath(rootPath: string, targetPath: string) {
  return path.relative(rootPath, targetPath).replace(/\\/g, '/');
}

function searchScore(entry: DirectoryEntry, relativePath: string, query: string) {
  if (!query) return 0;
  const name = entry.name.toLowerCase();
  const relative = relativePath.toLowerCase();
  if (name === query || relative === query) return 0;
  if (name.startsWith(query)) return 1;
  if (relative.startsWith(query)) return 2;
  const nameIndex = name.indexOf(query);
  if (nameIndex >= 0) return 3 + nameIndex / 1000;
  const relativeIndex = relative.indexOf(query);
  if (relativeIndex >= 0) return 4 + relativeIndex / 1000;
  return null;
}

export async function searchWorkspace(rootPath: string, options: WorkspaceFileSearchOptions = {}): Promise<DirectoryEntry[]> {
  const query = (options.query ?? '').trim().toLowerCase().replace(/\\/g, '/');
  const maxResults = Math.min(Math.max(Math.floor(options.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS), 1), HARD_SEARCH_MAX_RESULTS);
  const maxDepth = Math.min(Math.max(Math.floor(options.maxDepth ?? DEFAULT_SEARCH_MAX_DEPTH), 0), 25);
  const includeFiles = options.includeFiles !== false;
  const includeDirectories = options.includeDirectories !== false;

  if (!query) {
    const entries = await readDirectory(rootPath);
    return entries.filter((entry) => (entry.isDirectory ? includeDirectories : includeFiles)).slice(0, maxResults);
  }

  const candidates: Array<{ entry: DirectoryEntry; score: number; relativePath: string; depth: number }> = [];
  const queue: Array<{ folder: string; depth: number }> = [{ folder: rootPath, depth: 0 }];
  const candidateLimit = Math.min(maxResults * 4, HARD_SEARCH_MAX_RESULTS);
  let queueIndex = 0;

  while (queueIndex < queue.length && candidates.length < candidateLimit) {
    const current = queue[queueIndex++];
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(current.folder, { withFileTypes: true });
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT') || isNodeErrorWithCode(error, 'EACCES') || isNodeErrorWithCode(error, 'EPERM')) continue;
      throw error;
    }

    for (const dirent of entries.sort(compareDirents)) {
      if (dirent.isDirectory() && searchIgnoredFolders.has(dirent.name)) continue;
      const entry = directoryEntry(current.folder, dirent);
      const relativePath = normalizedRelativePath(rootPath, entry.path);
      const canInclude = entry.isDirectory ? includeDirectories : includeFiles;
      const score = canInclude ? searchScore(entry, relativePath, query) : null;
      if (score != null) candidates.push({ entry, score, relativePath, depth: current.depth });
      if (entry.isDirectory && current.depth < maxDepth) queue.push({ folder: entry.path, depth: current.depth + 1 });
      if (candidates.length >= candidateLimit) break;
    }
  }

  return candidates
    .sort((a, b) => a.score - b.score || a.depth - b.depth || Number(b.entry.isDirectory) - Number(a.entry.isDirectory) || a.relativePath.localeCompare(b.relativePath))
    .slice(0, maxResults)
    .map((candidate) => candidate.entry);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return false;
    throw error;
  }
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

async function uniqueCopyPath(sourcePath: string, folderPath: string) {
  const parsed = path.parse(sourcePath);
  let candidate = path.join(folderPath, `${parsed.name} copy${parsed.ext}`);
  let index = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(folderPath, `${parsed.name} copy ${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

export async function copyFileToFolder(sourcePath: string, folderPath: string) {
  const [sourceStat, folderStat] = await Promise.all([fs.stat(sourcePath), fs.stat(folderPath)]);
  if (!sourceStat.isFile()) throw new Error('Only files can be copied');
  if (!folderStat.isDirectory()) throw new Error('Paste destination must be a folder');
  const targetPath = await uniqueCopyPath(sourcePath, folderPath);
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
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
