import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { ExtensionListResult, ExtensionLoadError, ExtensionManifest, ExtensionSource, ExtensionTerminalCommandHookContribution, StackDockSettings, TerminalCommandHookSource } from '../src/shared/types';

const MANIFEST_FILE = 'stackdock.extension.json';
const TERMINAL_COMMAND_HOOK_CAPABILITY = 'terminal-command-hook';
const MAX_HOOK_PATTERN_LENGTH = 256;
const MAX_HOOK_APPEND_LENGTH = 512;
const ALLOWED_HOOK_SOURCES = new Set<TerminalCommandHookSource>(['interactive', 'startup', 'resume', 'headless', 'programmatic']);
const ALLOWED_HOOK_TEMPLATE_VARS = new Set(['command', 'restoreId', 'cwd', 'name']);
const packageRoots = new Map<string, string>();
let loadedExtensionsCache: ExtensionManifest[] = getBundledExtensionManifests();
let loadedExtensionPathKey: string | null = null;

export function getBundledExtensionRoots(): string[] {
  const roots = [path.resolve(__dirname, '../extensions/builtin'), path.resolve(process.cwd(), 'extensions/builtin')];
  const extensionRoots: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!fsSync.existsSync(root)) continue;
    for (const item of fsSync.readdirSync(root, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const extensionRoot = path.join(root, item.name);
      if (!fsSync.existsSync(path.join(extensionRoot, MANIFEST_FILE))) continue;
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      extensionRoots.push(extensionRoot);
    }
  }
  return extensionRoots;
}

export function getBundledExtensionManifests(): ExtensionManifest[] {
  const manifests: ExtensionManifest[] = [];
  for (const root of getBundledExtensionRoots()) {
    try {
      const raw = JSON.parse(fsSync.readFileSync(path.join(root, MANIFEST_FILE), 'utf8')) as unknown;
      manifests.push(normalizeManifest(raw, root, 'bundled'));
    } catch {
      // Bundled manifest errors surface during async load where error collection exists.
    }
  }
  return manifests;
}

function validId(id: string) { return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id); }
function asString(value: unknown, name: string) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`); return value.trim(); }
function settingsPathKey(settings: StackDockSettings) { return settings.extensions.localPackagePaths.map((item) => path.resolve(item)).join('\0'); }

function validateTerminalCommandHook(raw: unknown, capabilities: string[] | undefined): ExtensionTerminalCommandHookContribution {
  if (!capabilities?.includes(TERMINAL_COMMAND_HOOK_CAPABILITY)) throw new Error(`terminalCommandHooks require ${TERMINAL_COMMAND_HOOK_CAPABILITY} capability`);
  if (!raw || typeof raw !== 'object') throw new Error('terminalCommandHook must be object');
  const source = raw as ExtensionTerminalCommandHookContribution;
  const id = asString(source.id, 'terminalCommandHook.id');
  if (!validId(id)) throw new Error(`Invalid terminalCommandHook id ${id}`);
  const match = asString(source.match, 'terminalCommandHook.match');
  const appendArgs = asString(source.appendArgs, 'terminalCommandHook.appendArgs');
  if (match.length > MAX_HOOK_PATTERN_LENGTH) throw new Error(`terminalCommandHook.match exceeds ${MAX_HOOK_PATTERN_LENGTH} characters`);
  if (appendArgs.length > MAX_HOOK_APPEND_LENGTH) throw new Error(`terminalCommandHook.appendArgs exceeds ${MAX_HOOK_APPEND_LENGTH} characters`);
  try { new RegExp(match); } catch (error) { throw new Error(`Invalid terminalCommandHook.match regex: ${error instanceof Error ? error.message : String(error)}`); }
  const sources = Array.isArray(source.sources) ? source.sources.map((item) => asString(item, 'terminalCommandHook.sources')) : undefined;
  for (const item of sources ?? []) if (!ALLOWED_HOOK_SOURCES.has(item as TerminalCommandHookSource)) throw new Error(`Unknown terminalCommandHook source ${item}`);
  for (const [, name] of appendArgs.matchAll(/\$\{([^}]+)\}/g)) if (!ALLOWED_HOOK_TEMPLATE_VARS.has(name)) throw new Error(`Unsupported terminalCommandHook template variable ${name}`);
  return { id, match, appendArgs, sources: sources as TerminalCommandHookSource[] | undefined, description: typeof source.description === 'string' ? source.description.trim() : undefined };
}

function normalizeManifest(raw: unknown, root: string, sourceType: ExtensionSource = 'local'): ExtensionManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Manifest must be object');
  const source = raw as ExtensionManifest;
  const id = asString(source.id, 'id');
  if (!validId(id)) throw new Error(`Invalid extension id ${id}`);
  if (source.main) validateEntry(root, source.main);
  if (source.renderer) validateEntry(root, source.renderer);
  const manifest: ExtensionManifest = {
    id,
    name: asString(source.name, 'name'),
    version: asString(source.version, 'version'),
    description: typeof source.description === 'string' ? source.description : undefined,
    defaultEnabled: source.defaultEnabled === true,
    source: sourceType,
    packagePath: root,
    capabilities: Array.isArray(source.capabilities) ? source.capabilities.filter((item): item is string => typeof item === 'string') : undefined,
    main: typeof source.main === 'string' ? source.main : undefined,
    renderer: typeof source.renderer === 'string' ? source.renderer : undefined,
    contributes: { views: [], statusBar: [], configuration: source.contributes?.configuration, terminalCommandHooks: [] },
  };
  const seen = new Set<string>();
  for (const view of source.contributes?.views ?? []) {
    const viewId = asString(view.id, 'view.id');
    if (seen.has(viewId)) throw new Error(`Duplicate contribution id ${viewId}`);
    seen.add(viewId);
    if (view.entry) validateEntry(root, view.entry);
    manifest.contributes!.views!.push({ ...view, id: viewId, extensionId: id, native: sourceType === 'bundled' ? view.native !== false : false, location: view.location ?? 'activity' });
  }
  for (const item of source.contributes?.statusBar ?? []) {
    const itemId = asString(item.id, 'statusBar.id');
    if (seen.has(itemId)) throw new Error(`Duplicate contribution id ${itemId}`);
    seen.add(itemId);
    if (item.entry) validateEntry(root, item.entry);
    manifest.contributes!.statusBar!.push({ ...item, id: itemId, extensionId: id, native: sourceType === 'bundled' ? item.native !== false : false, side: item.side ?? 'left' });
  }
  for (const item of source.contributes?.terminalCommandHooks ?? []) {
    const hook = validateTerminalCommandHook(item, manifest.capabilities);
    if (seen.has(hook.id)) throw new Error(`Duplicate contribution id ${hook.id}`);
    seen.add(hook.id);
    manifest.contributes!.terminalCommandHooks!.push(hook);
  }
  packageRoots.set(id, root);
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
  const extensions: ExtensionManifest[] = [];
  for (const root of getBundledExtensionRoots()) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILE), 'utf8')) as unknown;
      extensions.push(normalizeManifest(raw, root, 'bundled'));
    } catch (error) {
      errors.push({ packagePath: root, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const seenIds = new Set(extensions.map((item) => item.id));
  for (const packagePath of settings.extensions.localPackagePaths) {
    try {
      const root = path.resolve(packagePath);
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) throw new Error('Extension package path must be a directory');
      const raw = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILE), 'utf8')) as unknown;
      const manifest = normalizeManifest(raw, root, 'local');
      if (seenIds.has(manifest.id)) throw new Error(`Duplicate extension id ${manifest.id}`);
      seenIds.add(manifest.id);
      packageRoots.set(manifest.id, root);
      extensions.push(manifest);
    } catch (error) {
      errors.push({ packagePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  loadedExtensionsCache = extensions;
  loadedExtensionPathKey = settingsPathKey(settings);
  return { extensions, errors };
}

export async function ensureExtensionsLoaded(settings: StackDockSettings): Promise<ExtensionManifest[]> {
  if (loadedExtensionPathKey !== settingsPathKey(settings)) await loadExtensions(settings);
  return loadedExtensionsCache;
}

export function getLoadedExtensionManifests(): ExtensionManifest[] {
  return loadedExtensionsCache;
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
