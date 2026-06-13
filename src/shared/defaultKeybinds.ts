export const DEFAULT_KEYBINDS: Record<string, string> = {
  'stackdock.commandPalette.open': 'Mod+Shift+P',
  'stackdock.sessions.switcher.open': 'Mod+P',
  'stackdock.terminal.new': 'Mod+Shift+T',
  'stackdock.view.toggleTerminal': 'Mod+`',
  'stackdock.view.toggleSidebar': 'Mod+B',
  'stackdock.tab.closeActive': 'Mod+W',
  'stackdock.settings.open': 'Mod+,',
  'stackdock.settings.open.general': '',
  'stackdock.settings.open.appearance': '',
  'stackdock.settings.open.terminal': '',
  'stackdock.settings.open.extensions': '',
  'stackdock.settings.open.workspace': '',
  'stackdock.settings.open.keybinds': '',
  'show-git': 'Mod+Shift+G',
};

export const BUILTIN_KEYBIND_COMMANDS = [
  ['stackdock.commandPalette.open', 'Open Command Palette'],
  ['stackdock.sessions.switcher.open', 'Open Session Switcher'],
  ['stackdock.terminal.new', 'New Terminal'],
  ['stackdock.view.toggleTerminal', 'Toggle Terminal/Main View'],
  ['stackdock.view.toggleSidebar', 'Toggle Sidebar'],
  ['stackdock.tab.closeActive', 'Close Active Tab'],
  ['stackdock.settings.open', 'Open Settings'],
  ['stackdock.settings.open.general', 'Open Settings: General'],
  ['stackdock.settings.open.appearance', 'Open Settings: Appearance'],
  ['stackdock.settings.open.terminal', 'Open Settings: Terminal profiles'],
  ['stackdock.settings.open.extensions', 'Open Settings: Extensions'],
  ['stackdock.settings.open.workspace', 'Open Settings: Workspace'],
  ['stackdock.settings.open.keybinds', 'Open Settings: Keybinds'],
] as const;

export const EXTENSION_KEYBIND_COMMANDS: Record<string, readonly (readonly [string, string])[]> = {
  'stackdock.git': [['show-git', 'Show Source Control']],
};
