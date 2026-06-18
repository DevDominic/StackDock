import './monacoEnvironment';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { EditorThemeRule, StackDockTheme } from '../shared/types';

export const DEFAULT_THEME_ID = 'stackdock-dark';
export const DEFAULT_EDITOR_THEME_ID = DEFAULT_THEME_ID;

type ThemeColors = Record<string, string>;

type BuiltinTheme = StackDockTheme & { colors: ThemeColors };

export interface StackDockResolvedTheme {
  id: string;
  label: string;
  base: monaco.editor.BuiltinTheme;
  inherit: boolean;
  rules: monaco.editor.ITokenThemeRule[];
  colors: ThemeColors;
}

const registeredThemes = new Map<string, StackDockResolvedTheme>();
let builtinsRegistered = false;

const STACKDOCK_DARK: BuiltinTheme = {
  id: 'stackdock-dark',
  label: 'StackDock Dark',
  base: 'vs-dark',
  inherit: true,
  rules: stackDockTokenRules(),
  colors: {
    'editor.background': '#08090d',
    'editor.foreground': '#e7e7e7',
    'sideBar.background': '#08090d',
    'panel.background': '#08090d',
    'activityBar.background': '#030305',
    'foreground': '#e7e7e7',
    'descriptionForeground': '#8a8a8a',
    'focusBorder': '#4f8cff',
    'button.background': '#4f8cff',
    'button.foreground': '#ffffff',
    'errorForeground': '#ff6b6b',
    'panel.border': '#1b1f2a',
    'editorGroup.border': '#1b1f2a',
    'editorCursor.foreground': '#4f8cff',
    'editor.selectionBackground': '#ffffff33',
    'terminal.background': '#000000',
    'terminal.foreground': '#e7e7e7',
    'terminalCursor.foreground': '#4f8cff',
  },
};

export function parseVsCodeThemeJson(content: string): StackDockTheme {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(content));
  } catch {
    throw new Error('Invalid JSON theme file');
  }
  return convertVsCodeThemeToMonacoTheme(parsed);
}

export function convertVsCodeThemeToMonacoTheme(source: unknown, preferredId?: string): StackDockTheme {
  if (!source || typeof source !== 'object') throw new Error('Theme JSON must be an object');
  const input = source as { name?: unknown; type?: unknown; colors?: unknown; tokenColors?: unknown };
  const label = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Imported VS Code Theme';
  const id = preferredId || `vscode-${slug(label)}`;
  const base = baseFromVsCodeType(input.type);
  const colors = isRecord(input.colors) ? normalizeColors(input.colors) : {};
  const rules = tokenColorsToRules(input.tokenColors);
  if (!Object.keys(colors).length && !rules.length) throw new Error('Theme JSON does not contain colors or tokenColors');
  return { id, label, base, inherit: true, rules, colors };
}

export function registerTheme(theme: StackDockTheme): void {
  const resolved = normalizeTheme(theme);
  registeredThemes.set(resolved.id, resolved);
  monaco.editor.defineTheme(resolved.id, {
    base: resolved.base,
    inherit: resolved.inherit,
    rules: resolved.rules,
    colors: resolved.colors,
  });
}

export function registerThemes(importedThemes: StackDockTheme[] = []): void {
  if (!builtinsRegistered) {
    builtinsRegistered = true;
    registerTheme(STACKDOCK_DARK);
  }
  for (const theme of importedThemes) registerTheme(theme);
}

export function getThemes(importedThemes: StackDockTheme[] = []): StackDockTheme[] {
  registerThemes(importedThemes);
  const themes = new Map<string, StackDockTheme>();
  for (const theme of registeredThemes.values()) themes.set(theme.id, toStackDockTheme(theme));
  for (const theme of importedThemes) themes.set(theme.id, theme);
  return [...themes.values()];
}

export function resolveTheme(themeId?: string, importedThemes: StackDockTheme[] = []): StackDockResolvedTheme {
  registerThemes(importedThemes);
  return registeredThemes.get(themeId || '') ?? registeredThemes.get(DEFAULT_THEME_ID)!;
}

export function applyTheme(themeId?: string, importedThemes: StackDockTheme[] = []): StackDockResolvedTheme {
  const theme = resolveTheme(themeId, importedThemes);
  monaco.editor.setTheme(theme.id);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const vars = themeToCssVars(theme);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.dataset.theme = theme.id;
    root.dataset.themeBase = isHighContrastTheme(theme) ? 'hc' : isLightTheme(theme) ? 'light' : 'dark';
    root.style.colorScheme = isLightTheme(theme) ? 'light' : 'dark';
    const bridge = (window as unknown as {
      stackdock?: { app?: { setTitleBarOverlay?(options: { color: string; symbolColor: string; height: number }): Promise<void> } };
    }).stackdock;
    void bridge?.app?.setTitleBarOverlay?.({ color: vars['--titlebar-bg'], symbolColor: vars['--titlebar-fg'], height: 42 }).catch(() => undefined);
  }
  return theme;
}

export function getTerminalTheme(themeId?: string, importedThemes: StackDockTheme[] = []) {
  const theme = resolveTheme(themeId, importedThemes);
  const vars = themeToCssVars(theme);
  return {
    background: vars['--terminal-bg'],
    foreground: vars['--terminal-fg'],
    cursor: vars['--terminal-cursor'],
    selectionBackground: vars['--terminal-selection'],
    black: vars['--terminal-ansi-black'],
    red: vars['--terminal-ansi-red'],
    green: vars['--terminal-ansi-green'],
    yellow: vars['--terminal-ansi-yellow'],
    blue: vars['--terminal-ansi-blue'],
    magenta: vars['--terminal-ansi-magenta'],
    cyan: vars['--terminal-ansi-cyan'],
    white: vars['--terminal-ansi-white'],
    brightBlack: vars['--terminal-ansi-bright-black'],
    brightRed: vars['--terminal-ansi-bright-red'],
    brightGreen: vars['--terminal-ansi-bright-green'],
    brightYellow: vars['--terminal-ansi-bright-yellow'],
    brightBlue: vars['--terminal-ansi-bright-blue'],
    brightMagenta: vars['--terminal-ansi-bright-magenta'],
    brightCyan: vars['--terminal-ansi-bright-cyan'],
    brightWhite: vars['--terminal-ansi-bright-white'],
  };
}

export function themeToCssVars(theme: StackDockResolvedTheme): Record<string, string> {
  const c = theme.colors ?? {};
  const light = isLightTheme(theme);
  const bg = pick(c, ['editor.background', 'sideBar.background', 'panel.background'], light ? '#ffffff' : '#11111b');
  const text = pick(c, ['foreground', 'editor.foreground', 'sideBar.foreground'], light ? '#1f2328' : '#cdd6f4');
  const panel = pick(c, ['sideBar.background', 'editorGroupHeader.tabsBackground', 'panel.background'], bg);
  const elevated = pick(c, ['dropdown.background', 'input.background', 'menu.background'], mix(bg, light ? '#000000' : '#ffffff', 0.04));
  const surface = pick(c, ['quickInput.background', 'editorWidget.background', 'menu.background'], elevated);
  const primary = pick(c, ['focusBorder', 'activityBarBadge.background', 'button.background', 'textLink.foreground', 'editorCursor.foreground'], light ? '#0969da' : '#89b4fa');
  const primaryFg = pick(c, ['button.foreground', 'activityBarBadge.foreground'], readableTextOn(primary));
  const danger = pick(c, ['errorForeground', 'editorError.foreground', 'gitDecoration.deletedResourceForeground', 'charts.red'], light ? '#cf222e' : '#f38ba8');
  const gitModified = pick(c, ['gitDecoration.modifiedResourceForeground', 'charts.yellow'], light ? '#9a6700' : '#f9e2af');
  const gitAdded = pick(c, ['gitDecoration.addedResourceForeground', 'gitDecoration.untrackedResourceForeground', 'charts.green'], light ? '#1a7f37' : '#a6e3a1');
  const gitDeleted = pick(c, ['gitDecoration.deletedResourceForeground', 'charts.red'], danger);
  const border = pick(c, ['panel.border', 'sideBar.border', 'editorGroup.border', 'input.border', 'contrastBorder'], mix(bg, text, light ? 0.22 : 0.16));
  const separator = pick(c, ['button.separator', 'textSeparator.foreground', 'menu.separatorBackground'], border);
  const strongBorder = pick(c, ['focusBorder', 'contrastActiveBorder'], mix(border, text, 0.35));
  const muted = pick(c, ['descriptionForeground', 'disabledForeground', 'sideBar.foreground'], mix(text, bg, light ? 0.38 : 0.42));
  const hover = pick(c, ['list.hoverBackground', 'toolbar.hoverBackground'], withAlpha(light ? '#000000' : '#ffffff', 0.065));
  const active = pick(c, ['list.activeSelectionBackground', 'tab.activeBackground'], withAlpha(primary, 0.18));
  const accentSoft = pick(c, ['list.activeSelectionBackground'], withAlpha(primary, 0.18));
  const terminalBg = pick(c, ['terminal.background', 'editor.background'], bg);
  const terminalFg = ensureContrast(pick(c, ['terminal.foreground', 'editor.foreground'], text), terminalBg, light ? '#111111' : '#eeeeee');
  const terminalCursor = pick(c, ['terminalCursor.foreground', 'editorCursor.foreground'], primary);
  const terminalSelection = pick(c, ['terminal.selectionBackground', 'editor.selectionBackground'], withAlpha(primary, 0.28));
  const shadow = pick(c, ['widget.shadow'], light ? 'rgba(0,0,0,.16)' : 'rgba(0,0,0,.55)');
  const buttonBg = pick(c, ['button.secondaryBackground', 'dropdown.background', 'input.background'], mix(elevated, text, light ? 0.04 : 0.07));
  const buttonFg = ensureContrast(pick(c, ['button.secondaryForeground', 'foreground'], text), buttonBg, readableTextOn(buttonBg));
  const buttonBorder = pick(c, ['button.border', 'contrastBorder'], withAlpha(text, light ? 0.24 : 0.22));
  const buttonHoverBg = pick(c, ['button.secondaryHoverBackground', 'button.hoverBackground', 'toolbar.hoverBackground', 'list.hoverBackground'], mix(buttonBg, text, light ? 0.08 : 0.12));
  const buttonHoverBorder = pick(c, ['focusBorder', 'contrastActiveBorder'], withAlpha(primary, 0.72));
  const ghostBg = withAlpha(text, light ? 0.045 : 0.055);
  const ghostBorder = withAlpha(text, light ? 0.22 : 0.2);
  const titleBarBg = pick(c, ['titleBar.activeBackground', 'activityBar.background', 'editorGroupHeader.tabsBackground'], panel);
  const titleBarFg = ensureContrast(pick(c, ['titleBar.activeForeground', 'foreground', 'editor.foreground'], text), titleBarBg, readableTextOn(titleBarBg));
  const titleBarInactiveBg = pick(c, ['titleBar.inactiveBackground'], titleBarBg);
  const titleBarInactiveFg = pick(c, ['titleBar.inactiveForeground'], muted);
  const activityBarBg = pick(c, ['activityBar.background'], panel);
  const statusBarBg = pick(c, ['statusBar.background'], activityBarBg);
  const statusBarFg = ensureContrast(pick(c, ['statusBar.foreground', 'foreground'], text), statusBarBg, readableTextOn(statusBarBg));
  const statusBarBorder = pick(c, ['statusBar.border'], border);
  const tabBg = pick(c, ['tab.inactiveBackground', 'editorGroupHeader.tabsBackground'], panel);
  const tabFg = pick(c, ['tab.inactiveForeground'], muted);
  const tabActiveBg = pick(c, ['tab.activeBackground', 'editor.background'], bg);
  const tabActiveFg = ensureContrast(pick(c, ['tab.activeForeground', 'editor.foreground'], text), tabActiveBg, readableTextOn(tabActiveBg));
  const tabBorder = pick(c, ['tab.border', 'editorGroupHeader.tabsBorder'], border);
  const tabActiveBorder = pick(c, ['tab.activeBorderTop', 'tab.activeBorder', 'focusBorder'], primary);

  return {
    '--bg': bg,
    '--bg-panel': panel,
    '--bg-elevated': elevated,
    '--surface': surface,
    '--hover': hover,
    '--active': active,
    '--border': border,
    '--separator': separator,
    '--border-strong': strongBorder,
    '--text': ensureContrast(text, bg, light ? '#1f2328' : '#f8f8f2'),
    '--muted': ensureContrast(muted, bg, light ? '#57606a' : '#a6adc8', 3),
    '--primary': primary,
    '--primary-fg': primaryFg,
    '--accent-soft': accentSoft,
    '--danger': danger,
    '--button-bg': buttonBg,
    '--button-fg': buttonFg,
    '--button-border': buttonBorder,
    '--button-hover-bg': buttonHoverBg,
    '--button-hover-border': buttonHoverBorder,
    '--ghost-bg': ghostBg,
    '--ghost-border': ghostBorder,
    '--active-bg': active,
    '--active-fg': text,
    '--active-border': buttonHoverBorder,
    '--shadow': shadow,
    '--overlay': light ? 'rgba(31,35,40,.28)' : 'rgba(0,0,0,.65)',
    '--topbar-bg': panel,
    '--sidebar-bg': panel,
    '--titlebar-bg': titleBarBg,
    '--titlebar-fg': titleBarFg,
    '--titlebar-inactive-bg': titleBarInactiveBg,
    '--titlebar-inactive-fg': titleBarInactiveFg,
    '--activitybar-bg': activityBarBg,
    '--statusbar-bg': statusBarBg,
    '--statusbar-fg': statusBarFg,
    '--statusbar-border': statusBarBorder,
    '--tab-bg': tabBg,
    '--tab-fg': tabFg,
    '--tab-active-bg': tabActiveBg,
    '--tab-active-fg': tabActiveFg,
    '--tab-border': tabBorder,
    '--tab-active-border': tabActiveBorder,
    '--workspace-bg-gradient': `radial-gradient(circle at top, ${withAlpha(primary, light ? 0.14 : 0.18)} 0, ${bg} 280px)`,
    '--hero-glow': `radial-gradient(900px 420px at 50% -140px, ${withAlpha(primary, light ? 0.16 : 0.18)}, transparent 70%)`,
    '--brand-gradient': `linear-gradient(140deg, ${primary}, ${pick(c, ['charts.purple'], primary)})`,
    '--brand-title-gradient': `linear-gradient(90deg, ${text}, ${muted})`,
    '--avatar-gradient': `linear-gradient(140deg, ${primary}, ${pick(c, ['charts.purple', 'charts.blue'], primary)})`,
    '--brand-fg': primaryFg,
    '--primary-border-soft': withAlpha(primary, 0.45),
    '--danger-border-soft': withAlpha(danger, 0.45),
    '--error-bg': pick(c, ['inputValidation.errorBackground', 'editorError.background'], withAlpha(danger, 0.12)),
    '--error-fg': danger,
    '--error-border': pick(c, ['inputValidation.errorBorder'], withAlpha(danger, 0.45)),
    '--warning-bg': pick(c, ['inputValidation.warningBackground', 'editorWarning.background'], withAlpha(gitModified, 0.12)),
    '--warning-fg': pick(c, ['editorWarning.foreground'], gitModified),
    '--warning-border': pick(c, ['inputValidation.warningBorder'], withAlpha(gitModified, 0.45)),
    '--success-border': withAlpha(gitAdded, 0.55),

    '--editor-bg': pick(c, ['editor.background'], bg),
    '--editor-fg': pick(c, ['editor.foreground'], text),
    '--editor-gutter-bg': pick(c, ['editorGutter.background', 'editor.background'], bg),
    '--editor-line-number': pick(c, ['editorLineNumber.foreground'], muted),
    '--editor-active-line-number': pick(c, ['editorLineNumber.activeForeground'], text),
    '--editor-cursor': pick(c, ['editorCursor.foreground'], primary),
    '--editor-selection': pick(c, ['editor.selectionBackground'], withAlpha(primary, 0.28)),
    '--editor-inactive-selection': pick(c, ['editor.inactiveSelectionBackground'], withAlpha(primary, 0.18)),
    '--editor-find-match': pick(c, ['editor.findMatchBackground'], withAlpha(gitModified, 0.3)),
    '--editor-find-match-highlight': pick(c, ['editor.findMatchHighlightBackground'], withAlpha(gitModified, 0.18)),
    '--editor-find-range': pick(c, ['editor.findRangeHighlightBackground'], withAlpha(primary, 0.1)),
    '--editor-range-highlight': pick(c, ['editor.rangeHighlightBackground'], withAlpha(primary, 0.1)),
    '--editor-word-highlight': pick(c, ['editor.wordHighlightBackground'], withAlpha(text, 0.1)),
    '--editor-word-highlight-strong': pick(c, ['editor.wordHighlightStrongBackground'], withAlpha(text, 0.16)),
    '--editor-line-highlight': pick(c, ['editor.lineHighlightBackground'], withAlpha(text, 0.05)),
    '--editor-indent': pick(c, ['editorIndentGuide.background1'], border),
    '--editor-indent-active': pick(c, ['editorIndentGuide.activeBackground1'], primary),
    '--editor-overview-error': pick(c, ['editorOverviewRuler.errorForeground'], withAlpha(danger, 0.35)),
    '--editor-overview-warning': pick(c, ['editorOverviewRuler.warningForeground'], withAlpha(gitModified, 0.35)),
    '--editor-overview-find-match': pick(c, ['editorOverviewRuler.findMatchForeground'], withAlpha(gitModified, 0.35)),
    '--editor-overview-range': pick(c, ['editorOverviewRuler.rangeHighlightForeground'], withAlpha(primary, 0.25)),
    '--editor-error-fg': pick(c, ['editorError.foreground'], danger),
    '--editor-error-bg': pick(c, ['editorError.background'], withAlpha(danger, 0.1)),
    '--editor-bracket-match-bg': pick(c, ['editorBracketMatch.background'], withAlpha(text, 0.1)),
    '--editor-bracket-match-border': pick(c, ['editorBracketMatch.border'], border),
    '--editor-unexpected-bracket': pick(c, ['editorBracketHighlight.unexpectedBracket.foreground'], danger),

    '--scrollbar-thumb': pick(c, ['scrollbarSlider.background'], withAlpha(text, light ? 0.28 : 0.24)),
    '--scrollbar-thumb-hover': pick(c, ['scrollbarSlider.hoverBackground'], withAlpha(text, light ? 0.38 : 0.34)),
    '--scrollbar-thumb-active': pick(c, ['scrollbarSlider.activeBackground'], withAlpha(text, light ? 0.48 : 0.46)),

    '--terminal-bg': terminalBg,
    '--terminal-fg': terminalFg,
    '--terminal-cursor': terminalCursor,
    '--terminal-selection': terminalSelection,
    '--terminal-border': border,
    '--terminal-ansi-black': pick(c, ['terminal.ansiBlack'], light ? '#000000' : '#000000'),
    '--terminal-ansi-red': pick(c, ['terminal.ansiRed'], '#cd3131'),
    '--terminal-ansi-green': pick(c, ['terminal.ansiGreen'], '#0dbc79'),
    '--terminal-ansi-yellow': pick(c, ['terminal.ansiYellow'], '#e5e510'),
    '--terminal-ansi-blue': pick(c, ['terminal.ansiBlue'], '#2472c8'),
    '--terminal-ansi-magenta': pick(c, ['terminal.ansiMagenta'], '#bc3fbc'),
    '--terminal-ansi-cyan': pick(c, ['terminal.ansiCyan'], '#11a8cd'),
    '--terminal-ansi-white': pick(c, ['terminal.ansiWhite'], '#e5e5e5'),
    '--terminal-ansi-bright-black': pick(c, ['terminal.ansiBrightBlack'], '#666666'),
    '--terminal-ansi-bright-red': pick(c, ['terminal.ansiBrightRed'], '#f14c4c'),
    '--terminal-ansi-bright-green': pick(c, ['terminal.ansiBrightGreen'], '#23d18b'),
    '--terminal-ansi-bright-yellow': pick(c, ['terminal.ansiBrightYellow'], '#f5f543'),
    '--terminal-ansi-bright-blue': pick(c, ['terminal.ansiBrightBlue'], '#3b8eea'),
    '--terminal-ansi-bright-magenta': pick(c, ['terminal.ansiBrightMagenta'], '#d670d6'),
    '--terminal-ansi-bright-cyan': pick(c, ['terminal.ansiBrightCyan'], '#29b8db'),
    '--terminal-ansi-bright-white': pick(c, ['terminal.ansiBrightWhite'], '#e5e5e5'),

    '--git-modified': gitModified,
    '--git-untracked': gitAdded,
    '--git-added': gitAdded,
    '--git-deleted': gitDeleted,
    '--diff-add-fg': gitAdded,
    '--diff-add-bg': pick(c, ['diffEditor.insertedTextBackground'], withAlpha(gitAdded, 0.14)),
    '--diff-remove-fg': gitDeleted,
    '--diff-remove-bg': pick(c, ['diffEditor.removedTextBackground'], withAlpha(gitDeleted, 0.16)),
    '--diff-hunk-fg': pick(c, ['editorInfo.foreground', 'charts.blue'], primary),
    '--diff-hunk-bg': pick(c, ['editorInfo.background'], withAlpha(primary, 0.14)),

    '--icon-folder': pick(c, ['charts.yellow'], gitModified),
    '--icon-lua': pick(c, ['charts.purple'], primary),
    '--icon-ts': pick(c, ['charts.blue'], primary),
    '--icon-js': pick(c, ['charts.yellow'], gitModified),
    '--icon-py': pick(c, ['charts.blue'], primary),
    '--icon-rust': pick(c, ['charts.orange'], gitModified),
    '--icon-go': pick(c, ['charts.blue'], primary),
    '--icon-cpp': pick(c, ['charts.blue'], primary),
    '--icon-csharp': pick(c, ['charts.purple'], primary),
    '--icon-ruby': pick(c, ['charts.red'], danger),
    '--icon-php': pick(c, ['charts.purple'], primary),
    '--icon-java': pick(c, ['charts.orange'], gitModified),
    '--icon-kotlin': pick(c, ['charts.purple'], primary),
    '--icon-swift': pick(c, ['charts.orange'], gitModified),
    '--icon-html': pick(c, ['charts.orange'], gitModified),
    '--icon-css': pick(c, ['charts.purple'], primary),
    '--icon-vue': pick(c, ['charts.green'], gitAdded),
    '--icon-md': muted,
    '--icon-data': pick(c, ['charts.yellow'], gitModified),
    '--icon-image': pick(c, ['charts.blue'], primary),
    '--icon-pdf': danger,
    '--icon-config': gitAdded,
    '--icon-node': gitAdded,
    '--icon-docker': pick(c, ['charts.blue'], primary),
    '--icon-git': pick(c, ['charts.orange'], gitModified),
  };
}

function normalizeTheme(theme: StackDockTheme): StackDockResolvedTheme {
  return {
    id: theme.id,
    label: theme.label,
    base: theme.base,
    inherit: theme.inherit,
    rules: theme.rules as monaco.editor.ITokenThemeRule[],
    colors: theme.colors ?? {},
  };
}

function toStackDockTheme(theme: StackDockResolvedTheme): StackDockTheme {
  return { id: theme.id, label: theme.label, base: theme.base, inherit: theme.inherit, rules: theme.rules as EditorThemeRule[], colors: theme.colors };
}

function pick(colors: ThemeColors, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = normalizeCssColor(colors[key]);
    if (value) return value;
  }
  return fallback;
}

export function normalizeCssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^rgba?\(/i.test(trimmed)) return trimmed;
  return undefined;
}

function ensureContrast(color: string, background: string, fallback: string, min = 4.5) {
  return contrastRatio(color, background) >= min ? color : fallback;
}

export function hexToRgb(color: string): { r: number; g: number; b: number; a: number } | null {
  const normalized = normalizeCssColor(color);
  if (!normalized?.startsWith('#')) return null;
  let hex = normalized.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((char) => char + char).join('');
  const hasAlpha = hex.length === 8;
  const int = Number.parseInt(hex, 16);
  if (Number.isNaN(int)) return null;
  return {
    r: (int >> (hasAlpha ? 24 : 16)) & 255,
    g: (int >> (hasAlpha ? 16 : 8)) & 255,
    b: (int >> (hasAlpha ? 8 : 0)) & 255,
    a: hasAlpha ? (int & 255) / 255 : 1,
  };
}

export function rgbToHex({ r, g, b, a = 1 }: { r: number; g: number; b: number; a?: number }) {
  const part = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  const alpha = a < 1 ? part(a * 255) : '';
  return `#${part(r)}${part(g)}${part(b)}${alpha}`;
}

export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp(alpha, 0, 1).toFixed(3)})`;
}

export function relativeLuminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0.5;
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

export function readableTextOn(background: string, preferredLight = '#ffffff', preferredDark = '#000000'): string {
  return contrastRatio(preferredLight, background) >= contrastRatio(preferredDark, background) ? preferredLight : preferredDark;
}

export function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const t = clamp(amount, 0, 1);
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t, a: ca.a + (cb.a - ca.a) * t });
}

export function isLightTheme(theme: StackDockResolvedTheme | StackDockTheme): boolean {
  if (theme.base === 'vs' || theme.base === 'hc-light') return true;
  const bg = theme.colors?.['editor.background'];
  return bg ? relativeLuminance(bg) > 0.55 : false;
}

function isHighContrastTheme(theme: StackDockResolvedTheme | StackDockTheme): boolean {
  return theme.base === 'hc-black' || theme.base === 'hc-light';
}

function stripJsonComments(content: string) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && next === '/') {
      while (i < content.length && content[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += char;
  }
  return removeTrailingJsonCommas(out);
}

function removeTrailingJsonCommas(content: string) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === ',') {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) j++;
      if (content[j] === '}' || content[j] === ']') continue;
    }
    out += char;
  }
  return out;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function baseFromVsCodeType(value: unknown): monaco.editor.BuiltinTheme {
  const type = typeof value === 'string' ? value.toLowerCase() : 'dark';
  if (type === 'light') return 'vs';
  if (type === 'hc-light' || type === 'highcontrastlight') return 'hc-light';
  if (type === 'hc' || type === 'highcontrast') return 'hc-black';
  return 'vs-dark';
}

function normalizeColor(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/^#/, '') : undefined;
}

function normalizeColors(colors: Record<string, unknown>): ThemeColors {
  const out: ThemeColors = {};
  for (const [key, value] of Object.entries(colors)) {
    const normalized = normalizeCssColor(value);
    if (normalized) out[key] = normalized;
  }
  return out;
}

function tokenColorsToRules(tokenColors: unknown): monaco.editor.ITokenThemeRule[] {
  if (!Array.isArray(tokenColors)) return [];
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (const entry of tokenColors) {
    if (!isRecord(entry) || !isRecord(entry.settings)) continue;
    const foreground = normalizeColor(entry.settings.foreground);
    const background = normalizeColor(entry.settings.background);
    const fontStyle = typeof entry.settings.fontStyle === 'string' ? entry.settings.fontStyle : undefined;
    if (!foreground && !background && fontStyle == null) continue;
    const rawScopes = entry.scope;
    const scopes = Array.isArray(rawScopes) ? rawScopes : typeof rawScopes === 'string' ? rawScopes.split(',') : [''];
    for (const scope of scopes) {
      if (typeof scope !== 'string') continue;
      const token = scope.trim();
      rules.push({ token, foreground, background, fontStyle });
    }
  }
  return rules;
}

function stackDockTokenRules(): monaco.editor.ITokenThemeRule[] {
  return [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'keyword.control', foreground: 'c586c0' },
    { token: 'keyword.local', foreground: '569cd6' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'identifier.builtin', foreground: '4fc1ff' },
    { token: 'identifier.roblox', foreground: '7aa2ff' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'operator', foreground: 'd4d4d4' },
    { token: 'delimiter', foreground: '8a8a8a' },
    { token: 'tag', foreground: '569cd6' },
    { token: 'attribute.name', foreground: '9cdcfe' },
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
