import fs from 'fs/promises';
import path from 'path';
import type { ExtensionListResult, ExtensionLoadError, ExtensionManifest, StackDockSettings } from '../src/shared/types';
import { gitExtensionManifest } from '../extensions/builtin/git/manifest';

const MANIFEST_FILE = 'stackdock.extension.json';
const packageRoots = new Map<string, string>();

export function getBundledExtensionManifests(): ExtensionManifest[] {
  return [
    { id: 'stackdock.explorer', name: 'Explorer', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { views: [{ id: 'stackdock.explorer.view', extensionId: 'stackdock.explorer', title: 'Explorer', icon: 'folder', location: 'activity', order: 10, native: true }] } },
    gitExtensionManifest,
    { id: 'stackdock.sessions', name: 'Sessions', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { views: [{ id: 'stackdock.sessions.view', extensionId: 'stackdock.sessions', title: 'Sessions', icon: 'sessions', location: 'sessions', order: 5, native: true }] } },
    { id: 'stackdock.workspaceStatus', name: 'Workspace Status', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { statusBar: [{ id: 'stackdock.workspace.status', extensionId: 'stackdock.workspaceStatus', side: 'right', order: 10, native: true }] } },
  ];
}

function validId(id: string) { return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id); }
function asString(value: unknown, name: string) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`); return value.trim(); }

function normalizeManifest(raw: unknown, root: string): ExtensionManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Manifest must be object');
  const source = raw as ExtensionManifest;
  const id = asString(source.id, 'id');
  if (!validId(id)) throw new Error(`Invalid extension id ${id}`);
  const manifest: ExtensionManifest = {
    id,
    name: asString(source.name, 'name'),
    version: asString(source.version, 'version'),
    description: typeof source.description === 'string' ? source.description : undefined,
    defaultEnabled: source.defaultEnabled === true,
    source: 'local',
    packagePath: root,
    capabilities: Array.isArray(source.capabilities) ? source.capabilities.filter((item): item is string => typeof item === 'string') : undefined,
    contributes: { views: [], statusBar: [] },
  };
  const seen = new Set<string>();
  for (const view of source.contributes?.views ?? []) {
    const viewId = asString(view.id, 'view.id');
    if (seen.has(viewId)) throw new Error(`Duplicate contribution id ${viewId}`);
    seen.add(viewId);
    if (view.entry) validateEntry(root, view.entry);
    manifest.contributes!.views!.push({ ...view, id: viewId, extensionId: id, native: false, location: view.location ?? 'activity' });
  }
  for (const item of source.contributes?.statusBar ?? []) {
    const itemId = asString(item.id, 'statusBar.id');
    if (seen.has(itemId)) throw new Error(`Duplicate contribution id ${itemId}`);
    seen.add(itemId);
    if (item.entry) validateEntry(root, item.entry);
    manifest.contributes!.statusBar!.push({ ...item, id: itemId, extensionId: id, native: false, side: item.side ?? 'left' });
  }
  return manifest;
}

function validateEntry(root: string, entry: string) {
  if (path.isAbsolute(entry) || entry.includes('\0')) throw new Error(`Invalid extension entry ${entry}`);
  const resolved = path.resolve(root, entry);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Extension entry escapes package: ${entry}`);
}

export async function loadExtensions(settings: StackDockSettings): Promise<ExtensionListResult> {
  packageRoots.clear();
  const errors: ExtensionLoadError[] = [];
  const extensions = [...getBundledExtensionManifests()];
  const seenIds = new Set(extensions.map((item) => item.id));
  for (const packagePath of settings.extensions.localPackagePaths) {
    try {
      const root = path.resolve(packagePath);
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) throw new Error('Extension package path must be a directory');
      const raw = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILE), 'utf8')) as unknown;
      const manifest = normalizeManifest(raw, root);
      if (seenIds.has(manifest.id)) throw new Error(`Duplicate extension id ${manifest.id}`);
      seenIds.add(manifest.id);
      packageRoots.set(manifest.id, root);
      extensions.push(manifest);
    } catch (error) {
      errors.push({ packagePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { extensions, errors };
}

export function resolveExtensionAsset(extensionId: string, assetPath: string): string | null {
  const root = packageRoots.get(extensionId);
  if (!root) return null;
  const clean = decodeURIComponent(assetPath).replace(/^\/+/, '');
  const resolved = path.resolve(root, clean || 'index.html');
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}
