import './monacoEnvironment';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/css/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/html/monaco.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import { DEFAULT_THEME_ID, applyTheme, getThemes, parseVsCodeThemeJson as parseUnifiedVsCodeThemeJson, registerTheme as registerUnifiedTheme, registerThemes as registerUnifiedThemes } from './themeSupport';
import type { ImportedEditorTheme } from '../shared/types';

export const DEFAULT_EDITOR_THEME_ID = DEFAULT_THEME_ID;

type ThemeColors = Record<string, string>;

export interface StackDockEditorTheme {
  id: string;
  label: string;
  base: monaco.editor.BuiltinTheme;
  inherit: boolean;
  rules: monaco.editor.ITokenThemeRule[];
  colors?: ThemeColors;
}

let languagesRegistered = false;

export function languageFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'json' || ext === 'jsonc') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') return 'css';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'lua' || ext === 'luau') return 'lua';
  if (ext === 'toml') return 'toml';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  if (ext === 'xml' || ext === 'svg') return 'xml';
  if (ext === 'py') return 'python';
  if (ext === 'rs') return 'rust';
  if (ext === 'go') return 'go';
  if (ext === 'java') return 'java';
  if (ext === 'cs') return 'csharp';
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'h' || ext === 'hpp') return 'cpp';
  if (ext === 'c') return 'c';
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || ext === 'ps1') return 'shell';
  return 'plaintext';
}

export function registerEditorSupport(importedThemes: ImportedEditorTheme[] = []) {
  registerLanguages();
  registerUnifiedThemes(importedThemes);
}

export function registerEditorTheme(theme: StackDockEditorTheme) {
  registerUnifiedTheme(theme as ImportedEditorTheme);
}

export function getEditorThemes() {
  return getThemes() as StackDockEditorTheme[];
}

export function registerImportedEditorThemes(themes: ImportedEditorTheme[] = []) {
  registerUnifiedThemes(themes);
}

export function convertVsCodeThemeToMonacoTheme(source: unknown, preferredId?: string): ImportedEditorTheme {
  if (!source || typeof source !== 'object') throw new Error('Theme JSON must be an object');
  const input = source as {
    name?: unknown;
    type?: unknown;
    colors?: unknown;
    tokenColors?: unknown;
    semanticHighlighting?: unknown;
  };
  const label = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Imported VS Code Theme';
  const id = preferredId || `vscode-${slug(label)}`;
  const base = baseFromVsCodeType(input.type);
  const colors = isRecord(input.colors) ? normalizeColors(input.colors) : {};
  const rules = tokenColorsToRules(input.tokenColors);
  if (!Object.keys(colors).length && !rules.length) throw new Error('Theme JSON does not contain colors or tokenColors');
  return { id, label, base, inherit: true, rules, colors };
}

export function parseVsCodeThemeJson(content: string): ImportedEditorTheme {
  return parseUnifiedVsCodeThemeJson(content);
}

export function setEditorTheme(themeId = DEFAULT_EDITOR_THEME_ID) {
  applyTheme(themeId);
}

export function createThemeFromCss(id: string, label: string, overrides: Partial<StackDockEditorTheme> = {}): StackDockEditorTheme {
  const styles = getComputedStyle(document.documentElement);
  const css = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    id,
    label,
    base: overrides.base ?? 'vs-dark',
    inherit: overrides.inherit ?? true,
    rules: overrides.rules ?? stackDockTokenRules(),
    colors: {
      'editor.background': css('--editor-bg', css('--bg-panel', '#08090d')),
      'editor.foreground': css('--editor-fg', css('--text', '#e7e7e7')),
      'editorLineNumber.foreground': css('--editor-line-number', '#7b8494'),
      'editorLineNumber.activeForeground': css('--editor-active-line-number', '#c9d1d9'),
      'editorCursor.foreground': css('--editor-cursor', css('--primary', '#4f8cff')),
      'editor.selectionBackground': css('--editor-selection', 'rgba(255, 255, 255, 0.20)'),
      'editor.inactiveSelectionBackground': css('--editor-inactive-selection', 'rgba(255, 255, 255, 0.12)'),
      'editor.findMatchBackground': css('--editor-find-match', 'rgba(255, 255, 255, 0.24)'),
      'editor.findMatchHighlightBackground': css('--editor-find-match-highlight', 'rgba(255, 255, 255, 0.14)'),
      'editor.findRangeHighlightBackground': css('--editor-find-range', 'rgba(255, 255, 255, 0.08)'),
      'editor.rangeHighlightBackground': css('--editor-range-highlight', 'rgba(255, 255, 255, 0.08)'),
      'editor.wordHighlightBackground': css('--editor-word-highlight', 'rgba(255, 255, 255, 0.10)'),
      'editor.wordHighlightStrongBackground': css('--editor-word-highlight-strong', 'rgba(255, 255, 255, 0.16)'),
      'editor.lineHighlightBackground': css('--editor-line-highlight', 'rgba(255, 255, 255, 0.04)'),
      'editorIndentGuide.background1': css('--editor-indent', '#2b3342'),
      'editorIndentGuide.activeBackground1': css('--editor-indent-active', '#4f8cff'),
      'editorGutter.background': css('--editor-gutter-bg', css('--bg-panel', '#08090d')),
      'scrollbarSlider.background': css('--scrollbar-thumb', 'rgba(255,255,255,.22)'),
      'scrollbarSlider.hoverBackground': css('--scrollbar-thumb-hover', 'rgba(255,255,255,.34)'),
      'scrollbarSlider.activeBackground': css('--scrollbar-thumb-active', 'rgba(255,255,255,.46)'),
      'editorOverviewRuler.errorForeground': css('--editor-overview-error', 'rgba(255,255,255,.28)'),
      'editorOverviewRuler.warningForeground': css('--editor-overview-warning', 'rgba(255,255,255,.22)'),
      'editorOverviewRuler.findMatchForeground': css('--editor-overview-find-match', 'rgba(255,255,255,.28)'),
      'editorOverviewRuler.rangeHighlightForeground': css('--editor-overview-range', 'rgba(255,255,255,.20)'),
      'editorError.foreground': css('--editor-error-fg', '#aeb6c2'),
      'editorError.background': css('--editor-error-bg', 'rgba(255,255,255,.08)'),
      'editorBracketMatch.background': css('--editor-bracket-match-bg', 'rgba(255,255,255,.10)'),
      'editorBracketMatch.border': css('--editor-bracket-match-border', '#8a8a8a'),
      'editorBracketHighlight.unexpectedBracket.foreground': css('--editor-unexpected-bracket', '#c7c7c7'),
      ...overrides.colors,
    },
  };
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
  if (type === 'hc' || type === 'highcontrast') return 'hc-black';
  return 'vs-dark';
}

function normalizeColor(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/^#/, '') : undefined;
}

function normalizeColors(colors: Record<string, unknown>): ThemeColors {
  const out: ThemeColors = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
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

function registerLanguages() {
  if (languagesRegistered) return;
  languagesRegistered = true;

  monaco.languages.register({ id: 'lua', extensions: ['.lua', '.luau'], aliases: ['Lua', 'Luau', 'lua'] });
  monaco.languages.setMonarchTokensProvider('lua', luaLanguage);
  monaco.languages.setLanguageConfiguration('lua', {
    comments: { lineComment: '--', blockComment: ['--[[', ']]'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  monaco.languages.register({ id: 'toml', extensions: ['.toml'], aliases: ['TOML', 'toml'] });
  monaco.languages.setMonarchTokensProvider('toml', tomlLanguage);
  monaco.languages.setLanguageConfiguration('toml', {
    comments: { lineComment: '#' },
    brackets: [['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
    ],
  });
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

const luaLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.lua',
  keywords: [
    'and', 'break', 'continue', 'do', 'else', 'elseif', 'end', 'export', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'type', 'until', 'while',
  ],
  controlKeywords: ['if', 'then', 'else', 'elseif', 'for', 'while', 'repeat', 'until', 'do', 'end', 'break', 'continue', 'return'],
  builtins: [
    '_G', '_VERSION', 'assert', 'collectgarbage', 'coroutine', 'debug', 'error', 'getfenv', 'getmetatable', 'ipairs', 'loadstring', 'math', 'next', 'os', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'require', 'select', 'setfenv', 'setmetatable', 'string', 'table', 'tonumber', 'tostring', 'type', 'unpack', 'utf8', 'xpcall', 'typeof', 'task', 'wait', 'spawn', 'delay', 'tick', 'time', 'warn',
  ],
  roblox: [
    'game', 'workspace', 'script', 'Instance', 'Vector2', 'Vector3', 'CFrame', 'Color3', 'ColorSequence', 'ColorSequenceKeypoint', 'NumberRange', 'NumberSequence', 'NumberSequenceKeypoint', 'UDim', 'UDim2', 'BrickColor', 'Enum', 'Ray', 'RaycastParams', 'Region3', 'TweenInfo', 'Axes', 'Faces', 'DateTime', 'Random', 'OverlapParams', 'PathWaypoint', 'PhysicalProperties',
  ],
  operators: ['+', '-', '*', '/', '%', '^', '#', '==', '~=', '<=', '>=', '<', '>', '=', '(', ')', '{', '}', '[', ']', ';', ':', ',', '.', '..', '...', 'and', 'or', 'not'],
  symbols: /[=><!~?:&|+\-*\/\^%#.,;]+/,
  escapes: /\\(?:[abfnrtv\\"']|\d{1,3})/,
  tokenizer: {
    root: [
      [/--\[\[/, 'comment', '@comment'],
      [/--.*$/, 'comment'],
      [/[a-zA-Z_]\w*/, { cases: { '@controlKeywords': 'keyword.control', '@keywords': 'keyword', '@builtins': 'identifier.builtin', '@roblox': 'identifier.roblox', '@default': 'identifier' } }],
      [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+/, 'number'],
      [/[{}()[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': 'delimiter' } }],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
      [/\s+/, 'white'],
    ],
    comment: [
      [/[^\]]+/, 'comment'],
      [/\]\]/, 'comment', '@pop'],
      [/./, 'comment'],
    ],
    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],
    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],
  },
};

const tomlLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.toml',
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/\s+/, 'white'],
      [/\[\[.*\]\]/, 'tag'],
      [/\[.*\]/, 'tag'],
      [/^[\w.-]+(?=\s*=)/, 'attribute.name'],
      [/=|,|\.|\{|\}|\[|\]/, 'delimiter'],
      [/true|false/, 'keyword'],
      [/\d{4}-\d{2}-\d{2}([Tt ][\d:.+-]+)?/, 'number'],
      [/[+-]?\d+\.\d+/, 'number.float'],
      [/[+-]?\d+/, 'number'],
      [/"""/, 'string', '@triple_double'],
      [/'''/, 'string', '@triple_single'],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
    ],
    triple_double: [[/"""/, 'string', '@pop'], [/./, 'string']],
    triple_single: [[/'''/, 'string', '@pop'], [/./, 'string']],
    string_double: [[/[^\\"]+/, 'string'], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
    string_single: [[/[^']+/, 'string'], [/'/, 'string', '@pop']],
  },
};
