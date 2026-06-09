import fs from 'fs/promises';
import type { StackDockSettings } from '../src/shared/types';
import { ensureDataDirs, getConfigPath } from './storage';

const UI_FONT_FAMILY = '"Inter Variable", "Inter", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const CODE_FONT_FAMILY = '"Monaspace Neon", "Cascadia Code", Consolas, monospace';
const LEGACY_DEFAULT_CODE_FONTS = new Set(['Consolas, monospace', '"Consolas", monospace']);

function migrateCodeFont(fontFamily?: string) {
  const value = fontFamily?.trim();
  if (!value || LEGACY_DEFAULT_CODE_FONTS.has(value)) return CODE_FONT_FAMILY;
  return value;
}

export function getDefaultSettings(): StackDockSettings {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  return {
    theme: 'dark',
    themeId: 'catppuccin-noctis-mocha',
    importedThemes: [],
    defaultTerminalProfileId: 'powershell',
    confirmBeforeDiscard: true,
    showHiddenFiles: false,
    emptySessionsVisible: false,
    showSessionCwdForAll: false,
    gitRefreshIntervalSeconds: 0,
    autoSave: true,
    autoSaveDelayMs: 1000,
    openLinksExternally: false,
    ui: { fontFamily: UI_FONT_FAMILY, fontSize: 13 },
    code: { ligatures: true },
    editor: { fontSize: 13, fontFamily: CODE_FONT_FAMILY, tabSize: 2, wordWrap: 'off' },
    terminal: { fontSize: 14, fontFamily: CODE_FONT_FAMILY, cursorBlink: true },
    terminalProfiles: [
      { id: 'powershell', name: 'PowerShell', shell: 'powershell.exe', args: ['-NoLogo', '-NoExit'] },
      { id: 'cmd', name: 'Command Prompt', shell: 'cmd.exe', args: [] },
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
    const themeId = typeof raw.themeId === 'string' && raw.themeId.trim()
      ? raw.themeId
      : typeof rawEditor.themeId === 'string' && rawEditor.themeId.trim()
        ? rawEditor.themeId
        : defaults.themeId;
    return {
      ...defaults,
      ...raw,
      themeId,
      importedThemes,
      ui: {
        ...defaults.ui,
        ...rawUi,
        fontFamily: rawUi.fontFamily?.trim() || defaults.ui.fontFamily,
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
      terminal: { ...defaults.terminal, ...rawTerminal, fontFamily: migrateCodeFont(rawTerminal.fontFamily) },
      terminalProfiles: raw.terminalProfiles?.length ? raw.terminalProfiles : defaults.terminalProfiles,
    };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: StackDockSettings): Promise<StackDockSettings> {
  if (settings.terminalProfiles.some((profile) => !profile.name.trim() || !profile.shell.trim())) throw new Error('Terminal profiles need name and shell');
  await ensureDataDirs();
  await fs.writeFile(getConfigPath(), JSON.stringify(settings, null, 2), 'utf8');
  return loadSettings();
}
