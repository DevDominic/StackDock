# Unified VS Code Theme System Plan

## Context

StackDock currently has two separate theme concepts:

1. `settings.theme` (`dark` / `system`) for the app shell.
2. `settings.editor.themeId` + `settings.editor.importedThemes` for Monaco editor themes.

The desired design is one unified theme setting: users import/select a VS Code theme once, and that same theme drives:

- Monaco editor token colors and editor workbench colors.
- StackDock app shell CSS variables.
- Dashboard, workspace shell, sidebars, panels, buttons, inputs, modals, toast, git/diff colors.
- Terminal background/foreground/cursor/selection.

This plan is intentionally explicit so a low-thinking implementation pass can follow it mechanically.

## Recommended architecture

Create a unified theme layer in `src/lib/themeSupport.ts` and let `src/lib/editorSupport.ts` either be folded into it or become a small re-export wrapper.

The unified theme layer should own:

- VS Code JSON/JSONC parsing.
- Conversion to Monaco theme format.
- Conversion to StackDock CSS variables.
- Built-in theme registration.
- Imported theme registration.
- Applying the selected theme to both Monaco and `document.documentElement`.

Use VS Code theme JSON as the source of truth. Do **not** create a separate app-theme format in the UI.

## Data model

### Current model

```ts
interface StackDockSettings {
  theme: 'dark' | 'system';
  editor: {
    themeId: string;
    importedThemes: ImportedEditorTheme[];
    // editor font options...
  };
}
```

### Target model

Keep backward compatibility but make the unified theme explicit:

```ts
export interface StackDockTheme {
  id: string;
  label: string;
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: EditorThemeRule[];
  colors?: Record<string, string>; // raw VS Code workbench colors
}

export interface StackDockSettings {
  /** Unified app + Monaco theme id. */
  themeId: string;

  /** User-imported VS Code themes. */
  importedThemes: StackDockTheme[];

  /** @deprecated migrate from old settings.theme */
  theme?: 'dark' | 'system';

  editor: {
    fontSize: number;
    fontFamily: string;
    tabSize: number;
    wordWrap: 'on' | 'off';

    /** @deprecated migrate from old editor.themeId */
    themeId?: string;

    /** @deprecated migrate from old editor.importedThemes */
    importedThemes?: StackDockTheme[];
  };

  terminal: { fontSize: number; fontFamily: string; cursorBlink: boolean };
  // other existing fields unchanged
}
```

Migration rules in `electron/configStore.ts`:

1. Defaults:
   - `themeId: 'catppuccin-noctis-mocha'`
   - `importedThemes: []`
2. If an old config has `raw.themeId`, use it.
3. Else if old config has `raw.editor?.themeId`, use that.
4. Imported themes should be merged from:
   - `raw.importedThemes` if present.
   - else `raw.editor?.importedThemes` if present.
5. Keep writing the new shape on save.
6. During the transition, keep old optional fields in TypeScript so existing config files do not break loading.

## Files to modify

### Required

- `src/shared/types.ts`
- `electron/configStore.ts`
- `src/lib/editorSupport.ts`
- New: `src/lib/themeSupport.ts`
- `src/App.tsx`
- `src/components/dashboard/WorkspaceDashboard.tsx`
- `src/components/workspace/WorkspaceShell.tsx`
- `src/components/workspace/EditorPanel.tsx`
- `src/components/workspace/SettingsModal.tsx`
- `src/components/workspace/TerminalPanel.tsx`
- `src/styles.css`
- `README.md`

### Existing assets to reuse

- `src/lib/themes/catppuccin-noctis-mocha-color-theme.json`
- `third-party/catppuccin-noctis/LICENSE.md`

## Reuse

Reuse from `src/lib/editorSupport.ts`:

- `DEFAULT_EDITOR_THEME_ID`
- Catppuccin Noctis raw JSON import.
- JSONC parsing helpers:
  - comment stripping
  - trailing comma removal
- `convertVsCodeThemeToMonacoTheme()`
- `parseVsCodeThemeJson()`
- `registerEditorTheme()`
- `setEditorTheme()`
- `languageFor()` and language registration.

Rename only where helpful. Do not rewrite language support.

## Unified theme helper API

Create `src/lib/themeSupport.ts` with this public API:

```ts
export const DEFAULT_THEME_ID = 'catppuccin-noctis-mocha';

export interface StackDockResolvedTheme {
  id: string;
  label: string;
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: monaco.editor.ITokenThemeRule[];
  colors: Record<string, string>;
}

export function parseVsCodeThemeJson(content: string): StackDockTheme;
export function registerTheme(theme: StackDockTheme): void;
export function registerThemes(importedThemes?: StackDockTheme[]): void;
export function getThemes(importedThemes?: StackDockTheme[]): StackDockTheme[];
export function resolveTheme(themeId: string | undefined, importedThemes?: StackDockTheme[]): StackDockResolvedTheme;
export function applyTheme(themeId: string | undefined, importedThemes?: StackDockTheme[]): StackDockResolvedTheme;
export function getTerminalTheme(themeId: string | undefined, importedThemes?: StackDockTheme[]): {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
};
```

Implementation notes:

- `applyTheme()` must:
  1. call `registerThemes(importedThemes)`;
  2. resolve fallback to Catppuccin Noctis if missing;
  3. call `monaco.editor.setTheme(resolved.id)` if Monaco is available/imported;
  4. set CSS variables on `document.documentElement.style`;
  5. set `document.documentElement.dataset.theme = resolved.id`;
  6. set `document.documentElement.dataset.themeBase = 'light' | 'dark' | 'hc'`.
- `registerThemes()` must register both built-ins:
  - `catppuccin-noctis-mocha`
  - `stackdock-dark`
- `getThemes()` should return built-ins plus imported themes, with duplicate ids de-duped by last item winning or imported theme renamed before save.

## CSS variable mapping

Implement a deterministic mapper:

```ts
function themeToCssVars(theme: StackDockResolvedTheme): Record<string, string>
```

Use VS Code workbench colors in this priority order.

### Core surfaces

```txt
--bg                  <= editor.background OR sideBar.background OR panel.background
--bg-panel            <= sideBar.background OR editorGroupHeader.tabsBackground OR panel.background OR --bg
--bg-elevated         <= dropdown.background OR input.background OR menu.background OR --bg-panel
--surface             <= quickInput.background OR editorWidget.background OR menu.background OR --bg-elevated
--hover               <= list.hoverBackground OR toolbar.hoverBackground OR computed subtle overlay
--active              <= list.activeSelectionBackground OR tab.activeBackground OR computed stronger overlay
```

### Text

```txt
--text                <= foreground OR editor.foreground OR sideBar.foreground
--muted               <= descriptionForeground OR disabledForeground OR sideBar.foreground with opacity/mix
--primary             <= focusBorder OR activityBarBadge.background OR button.background OR textLink.foreground OR editorCursor.foreground
--primary-fg          <= button.foreground OR activityBarBadge.foreground OR contrast color against --primary
--accent-soft         <= list.activeSelectionBackground OR primary with 18% alpha
--danger              <= errorForeground OR editorError.foreground OR gitDecoration.deletedResourceForeground
```

### Borders/shadows

```txt
--border              <= panel.border OR sideBar.border OR editorGroup.border OR input.border OR contrastBorder OR derived subtle border
--border-strong       <= focusBorder OR contrastActiveBorder OR derived stronger border
--shadow              <= widget.shadow OR rgba black/white based on base theme
--overlay             <= modal/backdrop color based on base theme
```

### Editor variables

```txt
--editor-bg                         <= editor.background
--editor-fg                         <= editor.foreground
--editor-gutter-bg                  <= editorGutter.background OR editor.background
--editor-line-number                <= editorLineNumber.foreground
--editor-active-line-number         <= editorLineNumber.activeForeground
--editor-cursor                     <= editorCursor.foreground OR --primary
--editor-selection                  <= editor.selectionBackground
--editor-inactive-selection         <= editor.inactiveSelectionBackground
--editor-find-match                 <= editor.findMatchBackground
--editor-find-match-highlight       <= editor.findMatchHighlightBackground
--editor-find-range                 <= editor.findRangeHighlightBackground
--editor-range-highlight            <= editor.rangeHighlightBackground
--editor-word-highlight             <= editor.wordHighlightBackground
--editor-word-highlight-strong      <= editor.wordHighlightStrongBackground
--editor-line-highlight             <= editor.lineHighlightBackground
--editor-indent                     <= editorIndentGuide.background1
--editor-indent-active              <= editorIndentGuide.activeBackground1
--editor-error-fg                   <= editorError.foreground OR --danger
--editor-error-bg                   <= editorError.background OR derived danger transparent
--editor-bracket-match-bg           <= editorBracketMatch.background
--editor-bracket-match-border       <= editorBracketMatch.border
--editor-unexpected-bracket         <= editorBracketHighlight.unexpectedBracket.foreground OR --danger
```

### Scrollbars

```txt
--scrollbar-thumb       <= scrollbarSlider.background
--scrollbar-thumb-hover <= scrollbarSlider.hoverBackground
--scrollbar-thumb-active<= scrollbarSlider.activeBackground
```

### Terminal variables

```txt
--terminal-bg           <= terminal.background OR editor.background OR --bg
--terminal-fg           <= terminal.foreground OR editor.foreground OR --text
--terminal-cursor       <= terminalCursor.foreground OR editorCursor.foreground OR --primary
--terminal-selection    <= terminal.selectionBackground OR editor.selectionBackground OR --accent-soft
--terminal-border       <= panel.border OR --border
```

### Git/diff variables

```txt
--git-modified          <= gitDecoration.modifiedResourceForeground OR charts.yellow
--git-untracked         <= gitDecoration.untrackedResourceForeground OR charts.green
--git-added             <= gitDecoration.addedResourceForeground OR charts.green
--git-deleted           <= gitDecoration.deletedResourceForeground OR charts.red OR --danger
--diff-add-fg           <= diffEditor.insertedTextBackground-derived readable green OR charts.green
--diff-add-bg           <= diffEditor.insertedTextBackground OR green alpha
--diff-remove-fg        <= diffEditor.removedTextBackground-derived readable red OR charts.red
--diff-remove-bg        <= diffEditor.removedTextBackground OR red alpha
--diff-hunk-fg          <= editorInfo.foreground OR charts.blue OR --primary
--diff-hunk-bg          <= editorInfo.background OR primary alpha
```

### Icons/brand variables

Map these with fallbacks from chart/accent colors:

```txt
--icon-folder, --icon-lua, --icon-ts, --icon-js, --icon-py, --icon-rust,
--icon-go, --icon-cpp, --icon-csharp, --icon-ruby, --icon-php,
--icon-java, --icon-kotlin, --icon-swift, --icon-html, --icon-css,
--icon-vue, --icon-md, --icon-data, --icon-image, --icon-pdf,
--icon-config, --icon-node, --icon-docker, --icon-git
```

Use sensible fallbacks. These do not need exact VS Code fidelity.

## Color utility requirements

Add small color helpers in `themeSupport.ts` or `src/lib/color.ts`.

Required helpers:

```ts
normalizeCssColor(value: unknown): string | undefined
hexToRgb(color: string): { r: number; g: number; b: number; a: number }
rgbToHex(rgb): string
withAlpha(color: string, alpha: number): string
relativeLuminance(color: string): number
contrastRatio(a: string, b: string): number
readableTextOn(background: string, preferredLight?: string, preferredDark?: string): string
mix(a: string, b: string, amount: number): string
isLightTheme(theme): boolean
```

Support these input forms at minimum:

- `#rgb`
- `#rgba`
- `#rrggbb`
- `#rrggbbaa`

If parsing fails, return the fallback instead of throwing.

Important: VS Code often uses 8-digit hex with alpha, e.g. `#b4befe8a`. Preserve alpha when setting CSS vars.

## Light theme support requirements

Full light theme support means:

- Do not assume white overlay colors.
- Do not assume black shadows everywhere.
- Do not hardcode terminal background to black.
- Do not hardcode modal backdrop too dark if the theme is light; use `--overlay`.
- Use contrast helpers for button text, primary foreground, banner text, and terminal text.
- CSS should read variables instead of fixed dark colors.

For derived overlays:

- Dark theme hover: `rgba(255,255,255,0.06)` or lightened surface.
- Light theme hover: `rgba(0,0,0,0.06)` or darkened surface.
- Dark theme shadow: `rgba(0,0,0,0.55)`.
- Light theme shadow: `rgba(0,0,0,0.16)`.
- High-contrast theme: prefer explicit VS Code contrast colors and stronger borders.

## CSS cleanup checklist

Update `src/styles.css` so hardcoded theme colors are variables. The following current hardcoded areas must be migrated:

- `.banner.error`
  - use `--error-border`, `--error-fg`, `--error-bg`
- `.dashboard::before`
  - use `--hero-glow`
- `.brand-mark`
  - use `--brand-gradient`, `--brand-fg`, `--shadow`
- `.brand-text h1`
  - use `--brand-title-gradient`
- `.ws-card:hover`
  - use `--shadow`
- `.ws-card.pinned`
  - use `--primary-border-soft`
- `.ws-avatar`
  - use `--avatar-gradient`, `--brand-fg`
- `.icon-btn.danger:hover`
  - use `--danger-border-soft`
- `.workspace-terminal-mode`
  - use `--workspace-bg-gradient`
- `.compact-topbar`
  - use `--topbar-bg`
- `.global-sessions-sidebar`
  - use `--sidebar-bg`
- `.global-session-card.active`
  - use `--primary-border-soft`
- `.new-terminal-popover, .session-create-menu`
  - use `--shadow`
- `.terminal-shell`
  - use `--terminal-bg`
- `.terminal-shell.focused`
  - use `--primary-border-soft`
- `.terminal-mount .xterm-viewport::-webkit-scrollbar-thumb`
  - use scrollbar vars and terminal bg for border
- `.web-frame`
  - leave white if web content requires it, or set to `--bg`; prefer `--bg` for placeholder background before page load
- `.diff-add`, `.diff-remove`, `.diff-hunk`
  - use diff variables
- `.modal-backdrop`
  - use `--overlay`
- `.launcher`, `.toast`, command popup shadows
  - use `--shadow`
- `.toast.success`, `.toast.error`
  - use success/error border vars
- `.settings-warning`
  - use warning vars

Add these root fallback variables to `:root`:

```css
--shadow: rgba(0,0,0,.55);
--overlay: rgba(0,0,0,.65);
--topbar-bg: rgba(8, 9, 13, 0.92);
--sidebar-bg: linear-gradient(180deg, var(--bg-panel), var(--bg));
--workspace-bg-gradient: radial-gradient(circle at top, var(--accent-soft) 0, var(--bg) 280px);
--hero-glow: radial-gradient(900px 420px at 50% -140px, var(--accent-soft), transparent 70%);
--brand-gradient: linear-gradient(140deg, var(--primary), var(--primary));
--brand-title-gradient: linear-gradient(90deg, var(--text), var(--muted));
--avatar-gradient: var(--brand-gradient);
--brand-fg: var(--primary-fg);
--primary-border-soft: color-mix(in srgb, var(--primary) 45%, transparent);
--danger-border-soft: color-mix(in srgb, var(--danger) 45%, transparent);
--error-bg: color-mix(in srgb, var(--danger) 12%, transparent);
--error-fg: var(--danger);
--error-border: color-mix(in srgb, var(--danger) 45%, transparent);
--warning-bg: color-mix(in srgb, var(--git-modified) 12%, transparent);
--warning-fg: var(--git-modified);
--warning-border: color-mix(in srgb, var(--git-modified) 45%, transparent);
--success-border: color-mix(in srgb, var(--git-added) 55%, transparent);
```

If Electron/Chromium target supports `color-mix`, this is okay. If not, compute these in TypeScript and set them directly.

## Component implementation steps

### 1. `src/shared/types.ts`

- Rename `ImportedEditorTheme` to `StackDockTheme` or alias it:

```ts
export type StackDockTheme = ImportedEditorTheme;
```

- Add top-level `themeId` and `importedThemes`.
- Make old fields optional/deprecated instead of immediately deleting them.

### 2. `electron/configStore.ts`

- Set default `themeId` to Catppuccin Noctis.
- Move default imported themes to top-level `importedThemes: []`.
- Load/migrate old configs as described above.
- Preserve editor font settings.

Pseudo-code:

```ts
const oldEditor = raw.editor ?? {};
const importedThemes = Array.isArray(raw.importedThemes)
  ? raw.importedThemes
  : Array.isArray(oldEditor.importedThemes)
    ? oldEditor.importedThemes
    : [];

const themeId = typeof raw.themeId === 'string' && raw.themeId
  ? raw.themeId
  : typeof oldEditor.themeId === 'string' && oldEditor.themeId
    ? oldEditor.themeId
    : defaults.themeId;
```

### 3. `src/lib/themeSupport.ts`

- Move/copy theme parsing and conversion from `editorSupport.ts`.
- Add CSS var mapping.
- Add color helpers.
- Add `applyTheme()`.
- Keep this module safe to call before editor creation.

### 4. `src/lib/editorSupport.ts`

Keep language functions here or re-export theme functions from `themeSupport.ts`.

Simplest low-risk structure:

- `editorSupport.ts` keeps `languageFor()` and language registration.
- Theme-specific functions move to `themeSupport.ts`.
- `registerEditorSupport(importedThemes)` calls:
  - `registerLanguages()`
  - `registerThemes(importedThemes)` from `themeSupport.ts`.

### 5. `src/App.tsx`

Load settings at app startup so the dashboard gets themed before workspace opens.

Add state:

```ts
const [settings, setSettings] = useState<StackDockSettings | null>(null);
```

On mount:

```ts
api.settings.load().then((loaded) => {
  setSettings(loaded);
  applyTheme(loaded.themeId, loaded.importedThemes);
});
```

Pass `settings` and `onSettingsSaved` into `WorkspaceDashboard` and `WorkspaceShell`, or keep local loads but still apply globally after every settings save.

### 6. `WorkspaceDashboard.tsx`

- Accept optional `settings` from `App` if refactoring props.
- After settings save, call `applyTheme(saved.themeId, saved.importedThemes)`.
- Ensure imported theme selection applies immediately from dashboard settings modal.

### 7. `WorkspaceShell.tsx`

- After loading settings, call `applyTheme(loadedSettings.themeId, loadedSettings.importedThemes)`.
- After saving settings, call `applyTheme(saved.themeId, saved.importedThemes)`.
- Pass the unified `settings` to `EditorPanel` and `TerminalPanel`.

### 8. `EditorPanel.tsx`

Replace:

```ts
settings?.editor.themeId
settings?.editor.importedThemes
```

with:

```ts
settings?.themeId
settings?.importedThemes
```

On mount/update:

```ts
registerEditorSupport(settings?.importedThemes ?? []);
applyTheme(settings?.themeId, settings?.importedThemes ?? []);
```

Keep editor font/tab/word-wrap under `settings.editor`.

### 9. `SettingsModal.tsx`

Collapse two dropdowns into one.

Remove:

- `Theme` dropdown with `dark/system`.
- `Editor theme` dropdown.

Add one:

```tsx
<label>
  Theme
  <select value={draft.themeId} onChange={(event) => setDraft({ ...draft, themeId: event.target.value })}>
    {getThemes(draft.importedThemes).map((theme) => (
      <option key={theme.id} value={theme.id}>{theme.label}</option>
    ))}
  </select>
</label>
```

Import flow:

- Parse file with `parseVsCodeThemeJson()`.
- Ensure id is unique against `getThemes(draft.importedThemes)`.
- Add to `draft.importedThemes`.
- Set `draft.themeId = imported.id`.
- Call `applyTheme(imported.id, nextImportedThemes)` for preview.

Remove flow:

- Show remove button only if selected theme is imported.
- Remove from `draft.importedThemes`.
- Set `draft.themeId = DEFAULT_THEME_ID`.
- Call `applyTheme(DEFAULT_THEME_ID, importedThemesAfterRemoval)`.

Cancel behavior:

- If the modal previews changes before Save, closing without save should restore the original theme:

```ts
useEffect(() => () => applyTheme(settings.themeId, settings.importedThemes), []);
```

- On Save, save `draft`, then apply saved settings.

### 10. `TerminalPanel.tsx`

- Accept `settings?: StackDockSettings | null` prop if it does not already.
- Get terminal colors from CSS variables or `getTerminalTheme()`.
- Use settings terminal font options.

Terminal creation should use:

```ts
theme: {
  background: css('--terminal-bg', '#000000'),
  foreground: css('--terminal-fg', '#ffffff'),
  cursor: css('--terminal-cursor', '#ffffff'),
  selectionBackground: css('--terminal-selection', 'rgba(255,255,255,.2)'),
}
```

Add effect on settings/theme change:

```ts
terminalRef.current?.options.theme = { ...newTheme };
terminalRef.current?.options.fontSize = settings?.terminal.fontSize ?? 14;
terminalRef.current?.options.fontFamily = settings?.terminal.fontFamily ?? 'Consolas, monospace';
terminalRef.current?.options.cursorBlink = settings?.terminal.cursorBlink ?? true;
```

### 11. `src/styles.css`

- Add all fallback variables listed above.
- Replace hard-coded dark-theme colors from the CSS cleanup checklist.
- Keep fixed syntax/git semantic colors only if they are intentionally language identity colors; otherwise make them CSS variables.

### 12. `README.md`

Document:

- One theme dropdown controls the full app and Monaco.
- VS Code theme JSON/JSONC import is supported.
- Workbench `colors` are mapped to StackDock UI tokens.
- `tokenColors` are mapped to Monaco token rules.
- Full VS Code extension installation and exact TextMate grammar fidelity are not included.
- Catppuccin Noctis credit remains.

## Implementation order for low-thinking pass

Follow this exact order:

1. Update types only.
2. Update config migration/defaults only.
3. Create `themeSupport.ts` by moving/copying current theme code.
4. Add CSS variable mapper with simple fallbacks first.
5. Add `applyTheme()`.
6. Wire `applyTheme()` in `App`, dashboard save, workspace load/save, editor mount/update.
7. Collapse SettingsModal dropdown/import/remove behavior.
8. Update EditorPanel references from `settings.editor.themeId` to `settings.themeId`.
9. Update TerminalPanel theming/settings.
10. Replace hardcoded CSS colors with variables.
11. Run typecheck.
12. Fix type errors.
13. Run build.
14. Fix build errors.
15. Manually test dark imported theme.
16. Manually test light imported theme.
17. Manually test removing active imported theme.
18. Update README.

Do not attempt visual perfection before the architecture is wired. First make all theme data flow through one `themeId`, then improve mappings.

## Verification

Automated:

- [ ] `npm run typecheck`
- [ ] `npm run build`

Manual dark theme:

- [ ] Start dev app.
- [ ] Confirm Catppuccin Noctis is default across dashboard, workspace, editor, terminal.
- [ ] Import a dark VS Code theme JSON/JSONC.
- [ ] Select it from the single Theme dropdown.
- [ ] Confirm dashboard and workspace colors change.
- [ ] Confirm Monaco changes.
- [ ] Confirm terminal background/foreground/cursor change.
- [ ] Save settings and restart; selection persists.

Manual light theme:

- [ ] Import a light VS Code theme JSON/JSONC.
- [ ] Select it from the single Theme dropdown.
- [ ] Confirm body, panels, buttons, inputs, modal, sidebar, editor, terminal are readable.
- [ ] Confirm hover/active states are visible.
- [ ] Confirm borders are visible.
- [ ] Confirm terminal contrast is readable.
- [ ] Save settings and restart; selection persists.

Removal/fallback:

- [ ] Select an imported theme.
- [ ] Remove selected theme.
- [ ] Confirm app falls back to Catppuccin Noctis.
- [ ] Confirm no crash in editor or terminal.

Regression:

- [ ] Existing old config with `editor.themeId` still migrates.
- [ ] Existing old config with `editor.importedThemes` still migrates.
- [ ] Workspace settings modal and dashboard settings modal both save/apply the same theme.

## Non-goals

- Do not install VS Code extensions.
- Do not parse `package.json` theme contributions from extension folders.
- Do not implement exact TextMate grammar fidelity.
- Do not support icon themes as part of this pass.
- Do not build a separate app theme editor.
