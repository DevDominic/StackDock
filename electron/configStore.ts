import fs from 'fs/promises';
import type { StackDockSettings } from '../src/shared/types';
import { ensureDataDirs, getConfigPath } from './storage';

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
    editor: { fontSize: 13, fontFamily: 'Consolas, monospace', tabSize: 2, wordWrap: 'off' },
    terminal: { fontSize: 14, fontFamily: 'Consolas, monospace', cursorBlink: true },
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
    const rawEditor: Partial<StackDockSettings['editor']> = raw.editor ?? {};
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
      editor: {
        ...defaults.editor,
        ...rawEditor,
        themeId: undefined,
        importedThemes: undefined,
      },
      terminal: { ...defaults.terminal, ...raw.terminal },
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
