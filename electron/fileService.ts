import fs from 'fs/promises';
import path from 'path';
import { shell } from 'electron';
import type { DirectoryEntry, ReadFileResult } from '../src/shared/types';

const hiddenFolders = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.cache', '.vscode']);

export async function readDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => !hiddenFolders.has(entry.name))
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
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function revealInExplorer(targetPath: string) {
  await shell.showItemInFolder(targetPath);
}
