import fs from 'fs/promises';
import type { ExtensionConfigPrimitive, StackDockSettings, TerminalProfile } from '../src/shared/types';
import { DEFAULT_KEYBINDS } from '../src/shared/defaultKeybinds';
import { normalizeKeybind } from '../src/shared/keybinds';
import { ensureDataDirs, getConfigPath } from './storage';
import { getBundledTerminalProfiles } from '../extensions/mainRegistry';
import { getBundledExtensionManifests } from './extensionService';

const UI_FONT_FAMILY = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const CODE_FONT_FAMILY = '"Cascadia Code", Consolas, monospace';
const LEGACY_DEFAULT_UI_FONTS = new Set([
  '"Inter Variable", "Inter", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
]);
const LEGACY_DEFAULT_CODE_FONTS = new Set(['Consolas, monospace', '"Consolas", monospace', '"Monaspace Neon", "Cascadia Code", Consolas, monospace']);
const DEFAULT_THEME_ID = 'stackdock-dark';
const LEGACY_BUILTIN_THEME_IDS = new Set(['catppuccin-noctis-mocha']);

function normalizeKeybindSettings(raw: unknown, defaults: Record<string, string>) {
  const result: Record<string, string> = { ...defaults };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const normalized = normalizeKeybind(value);
    result[key] = normalized ?? '';
  }
  return result;
}

function migrateUiFont(fontFamily?: string) {
  const value = fontFamily?.trim();
  if (!value || LEGACY_DEFAULT_UI_FONTS.has(value)) return UI_FONT_FAMILY;
  return value;
}

function migrateCodeFont(fontFamily?: string) {
  const value = fontFamily?.trim();
  if (!value || LEGACY_DEFAULT_CODE_FONTS.has(value)) return CODE_FONT_FAMILY;
  return value;
}

function normalizeTerminalProfiles(profiles: TerminalProfile[] | undefined, fallback: TerminalProfile[]) {
  if (!profiles?.length) return fallback;
  return profiles.map((profile) => {
    const startupCommand = profile.startupCommand?.trim();
    return {
      ...profile,
      args: Array.isArray(profile.args) ? profile.args : [],
      startupCommand: startupCommand || undefined,
    };
  });
}

function isConfigPrimitive(value: unknown): value is ExtensionConfigPrimitive {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizeExtensionConfig(rawConfig: unknown): Record<string, Record<string, ExtensionConfigPrimitive>> {
  const normalized: Record<string, Record<string, ExtensionConfigPrimitive>> = {};
  if (!rawConfig || typeof rawConfig !== 'object') return normalized;
  for (const [extensionId, value] of Object.entries(rawConfig)) {
    if (!value || typeof value !== 'object') continue;
    const config: Record<string, ExtensionConfigPrimitive> = {};
    for (const [key, entry] of Object.entries(value)) if (isConfigPrimitive(entry)) config[key] = entry;
    normalized[extensionId] = config;
  }
  return normalized;
}

function getBundledExtensionConfigDefaults(): Record<string, Record<string, ExtensionConfigPrimitive>> {
  const defaults: Record<string, Record<string, ExtensionConfigPrimitive>> = {};
  for (const manifest of getBundledExtensionManifests()) {
    const fields = manifest.contributes?.configuration?.fields ?? [];
    const config: Record<string, ExtensionConfigPrimitive> = {};
    for (const field of fields) if (field.default !== undefined) config[field.key] = field.default;
    if (Object.keys(config).length) defaults[manifest.id] = config;
  }
  return defaults;
}

export function getDefaultSettings(): StackDockSettings {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  return {
    theme: 'dark',
    themeId: DEFAULT_THEME_ID,
    importedThemes: [],
    defaultTerminalProfileId: 'powershell',
    confirmBeforeDiscard: true,
    emptySessionsVisible: false,
    showSessionCwdForAll: false,
    gitRefreshIntervalSeconds: 1,
    autoSave: true,
    autoSaveDelayMs: 1000,
    openLinksExternally: false,
    captureTerminalBrowserOpens: true,
    capturedLinkOpenMode: 'tab' as const,
    ui: { fontFamily: UI_FONT_FAMILY, fontSize: 13 },
    code: { ligatures: true },
    editor: { fontSize: 13, fontFamily: CODE_FONT_FAMILY, tabSize: 2, wordWrap: 'off' },
    terminal: { fontSize: 14, fontFamily: CODE_FONT_FAMILY, cursorBlink: true, startAtBottom: false, markdownFormatting: true },
    keybinds: DEFAULT_KEYBINDS,
    extensions: {
      localPackagePaths: [],
      disabled: [],
      enabled: [],
      config: {
        ...getBundledExtensionConfigDefaults(),
        'stackdock.sessions': { emptySessionsVisible: false, showSessionCwdForAll: false },
        'stackdock.git': { confirmBeforeDiscard: true, confirmBeforeRemoteActions: true, refreshIntervalSeconds: 1 },
        'stackdock.workspaceStatus': { showPath: true },
      },
    },
    terminalProfiles: [
      { id: 'powershell', name: 'PowerShell', shell: 'powershell.exe', args: ['-NoLogo', '-NoExit'] },
      { id: 'cmd', name: 'Command Prompt', shell: 'cmd.exe', args: [] },
      ...getBundledTerminalProfiles(),
      { id: 'git-bash', name: 'Git Bash', shell: `${programFiles}\\Git\\bin\\bash.exe`, args: ['--login', '-i'] },
      { id: 'wsl', name: 'WSL', shell: 'wsl.exe', args: [] },
    ],
  };
}

export async function loadSettings(): Promise<StackDockSettings> {
  await ensureDataDirs();
  const defaults = getDefaultSettings();
  try {
    const raw = JSON.parse(await fs.readFile(getConfigPath(), 'utf8')) as Partial<StackDockSettings>;
    const rawUi: Partial<StackDockSettings['ui']> = raw.ui ?? {};
    const rawCode: Partial<StackDockSettings['code']> = raw.code ?? {};
    const rawEditor: Partial<StackDockSettings['editor']> = raw.editor ?? {};
    const rawTerminal: Partial<StackDockSettings['terminal']> = raw.terminal ?? {};
    const importedThemes = Array.isArray(raw.importedThemes)
      ? raw.importedThemes
      : Array.isArray(rawEditor.importedThemes)
        ? rawEditor.importedThemes
        : defaults.importedThemes;
    const rawThemeId = typeof raw.themeId === 'string' && raw.themeId.trim()
      ? raw.themeId
      : typeof rawEditor.themeId === 'string' && rawEditor.themeId.trim()
        ? rawEditor.themeId
        : defaults.themeId;
    const themeId = LEGACY_BUILTIN_THEME_IDS.has(rawThemeId) ? defaults.themeId : rawThemeId;
    const rawExtensionConfig = normalizeExtensionConfig(raw.extensions?.config);
    const extensionsConfig = {
      ...defaults.extensions.config,
      ...rawExtensionConfig,
      'stackdock.sessions': {
        ...defaults.extensions.config['stackdock.sessions'],
        emptySessionsVisible: raw.emptySessionsVisible ?? rawExtensionConfig['stackdock.sessions']?.emptySessionsVisible ?? defaults.emptySessionsVisible,
        showSessionCwdForAll: raw.showSessionCwdForAll ?? rawExtensionConfig['stackdock.sessions']?.showSessionCwdForAll ?? defaults.showSessionCwdForAll,
      },
      'stackdock.git': {
        ...defaults.extensions.config['stackdock.git'],
        confirmBeforeDiscard: raw.confirmBeforeDiscard ?? rawExtensionConfig['stackdock.git']?.confirmBeforeDiscard ?? defaults.confirmBeforeDiscard,
        confirmBeforeRemoteActions: rawExtensionConfig['stackdock.git']?.confirmBeforeRemoteActions ?? defaults.extensions.config['stackdock.git']?.confirmBeforeRemoteActions ?? true,
        refreshIntervalSeconds: raw.gitRefreshIntervalSeconds ?? rawExtensionConfig['stackdock.git']?.refreshIntervalSeconds ?? defaults.gitRefreshIntervalSeconds,
      },
      'stackdock.workspaceStatus': {
        ...defaults.extensions.config['stackdock.workspaceStatus'],
        ...rawExtensionConfig['stackdock.workspaceStatus'],
      },
    };
    return {
      ...defaults,
      ...raw,
      themeId,
      importedThemes,
      ui: {
        ...defaults.ui,
        ...rawUi,
        fontFamily: migrateUiFont(rawUi.fontFamily),
        fontSize: Math.max(10, Number(rawUi.fontSize) || defaults.ui.fontSize),
      },
      code: { ...defaults.code, ...rawCode, ligatures: rawCode.ligatures !== false },
      editor: {
        ...defaults.editor,
        ...rawEditor,
        fontFamily: migrateCodeFont(rawEditor.fontFamily),
        themeId: undefined,
        importedThemes: undefined,
      },
      terminal: { ...defaults.terminal, ...rawTerminal, fontFamily: migrateCodeFont(rawTerminal.fontFamily), startAtBottom: rawTerminal.startAtBottom === true, markdownFormatting: rawTerminal.markdownFormatting !== false },
      confirmBeforeDiscard: extensionsConfig['stackdock.git'].confirmBeforeDiscard !== false,
      emptySessionsVisible: extensionsConfig['stackdock.sessions'].emptySessionsVisible === true,
      showSessionCwdForAll: extensionsConfig['stackdock.sessions'].showSessionCwdForAll === true,
      gitRefreshIntervalSeconds: Math.max(1, Number(extensionsConfig['stackdock.git'].refreshIntervalSeconds) || defaults.gitRefreshIntervalSeconds),
      terminalProfiles: normalizeTerminalProfiles(raw.terminalProfiles, defaults.terminalProfiles),
      keybinds: normalizeKeybindSettings(raw.keybinds, defaults.keybinds),
      extensions: {
        localPackagePaths: Array.isArray(raw.extensions?.localPackagePaths) ? raw.extensions.localPackagePaths.filter((item): item is string => typeof item === 'string') : defaults.extensions.localPackagePaths,
        disabled: Array.isArray(raw.extensions?.disabled) ? raw.extensions.disabled.filter((item): item is string => typeof item === 'string') : defaults.extensions.disabled,
        enabled: Array.isArray(raw.extensions?.enabled) ? raw.extensions.enabled.filter((item): item is string => typeof item === 'string') : defaults.extensions.enabled,
        config: extensionsConfig,
      },
    };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: StackDockSettings): Promise<StackDockSettings> {
  if (settings.terminalProfiles.some((profile) => !profile.name.trim() || !profile.shell.trim())) throw new Error('Terminal profiles need name and shell');
  await ensureDataDirs();
  const gitConfig = settings.extensions.config?.['stackdock.git'] ?? {};
  const sessionsConfig = settings.extensions.config?.['stackdock.sessions'] ?? {};
  const persisted: StackDockSettings = {
    ...settings,
    confirmBeforeDiscard: gitConfig.confirmBeforeDiscard !== false,
    gitRefreshIntervalSeconds: Math.max(1, Number(gitConfig.refreshIntervalSeconds) || settings.gitRefreshIntervalSeconds),
    emptySessionsVisible: sessionsConfig.emptySessionsVisible === true,
    showSessionCwdForAll: sessionsConfig.showSessionCwdForAll === true,
    extensions: { ...settings.extensions, config: normalizeExtensionConfig(settings.extensions.config) },
    keybinds: normalizeKeybindSettings(settings.keybinds, DEFAULT_KEYBINDS),
    terminalProfiles: normalizeTerminalProfiles(settings.terminalProfiles, []),
  };
  await fs.writeFile(getConfigPath(), JSON.stringify(persisted, null, 2), 'utf8');
  return loadSettings();
}
