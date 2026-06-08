# Plan: Import VS Code Theme JSON Support

## Context

StackDock already uses Monaco Editor and has theme registration helpers in `src/lib/editorSupport.ts` (`StackDockEditorTheme`, `registerEditorTheme`, `setEditorTheme`, `createThemeFromCss`). The requested feature is to let users import a VS Code theme JSON file and use it for the Monaco editor inside the project.

VS Code themes can be mapped into Monaco themes reasonably well by converting:
- VS Code `type` (`dark`, `light`, `hc`) to Monaco `base` (`vs-dark`, `vs`, `hc-black` where applicable).
- VS Code `colors` to Monaco `colors`.
- VS Code `tokenColors` to Monaco `rules` using Monaco token/theme rule fields.

This first version will support direct import of a local VS Code theme JSON file. It will not install or parse full VS Code extensions automatically, and it will not add TextMate grammar support.

## Approach

Add imported editor themes to persisted settings, expose a file picker/read helper through Electron IPC, convert the selected VS Code theme JSON into StackDock's existing Monaco theme shape, register available themes when the editor loads, and add controls in Settings → Looks & feel to import/select/remove editor themes.

Imported themes will be stored in the existing settings JSON so they persist across app restarts. The built-in `stackdock-dark` theme remains the fallback.

## Files to modify

- `src/shared/types.ts`
  - Add persisted editor theme fields/types to `StackDockSettings`.
  - Add `ImportedEditorTheme` / VS Code theme conversion-related types if useful.
  - Add API method signatures for choosing/reading a theme JSON file.
- `electron/main.ts`
  - Add IPC handler to pick a JSON file, or a more general `app:pickFile` helper.
- `electron/preload.ts`
  - Expose the new picker/read method through `window.stackdock`.
- `electron/configStore.ts`
  - Add defaults and merge persisted theme settings safely.
- `src/lib/editorSupport.ts`
  - Add `convertVsCodeThemeToMonacoTheme()`.
  - Add imported theme registration and selected theme fallback handling.
- `src/components/workspace/EditorPanel.tsx`
  - Apply selected editor theme from settings instead of always using `stackdock-dark`.
  - Ensure imported themes are registered before `monaco.editor.create()` / `setTheme()`.
- `src/components/workspace/SettingsModal.tsx`
  - Add UI in Appearance tab for editor theme selection, import, and removal.
- `src/components/workspace/WorkspaceShell.tsx`
  - Pass current settings/editor theme info to `EditorPanel` if needed.
- `src/styles.css`
  - Add light styling for import/remove theme controls if existing classes are insufficient.

## Reuse

- `src/lib/editorSupport.ts`
  - Reuse `StackDockEditorTheme`, `registerEditorTheme()`, `getEditorThemes()`, and `setEditorTheme()`.
  - Extend `createThemeFromCss()` fallback behavior rather than replacing it.
- `src/components/workspace/SettingsModal.tsx`
  - Reuse existing Appearance tab and `draft` settings state/save flow.
- `electron/configStore.ts`
  - Reuse current settings persistence and default merge pattern.
- `electron/main.ts`
  - Reuse existing Electron `dialog.showOpenDialog()` pattern from `app:pickWorkspaceFolder`.
- `src/shared/types.ts` / `electron/preload.ts`
  - Reuse existing typed preload API pattern.

## Steps

- [ ] Extend settings types with editor theme storage:
  - `editor.themeId?: string`
  - `editor.importedThemes?: StackDockEditorTheme[]` or a serializable equivalent.
- [ ] Update `getDefaultSettings()` and `loadSettings()` to default and merge the new editor theme fields without dropping existing editor settings.
- [ ] Add Electron IPC/preload API for importing a JSON file:
  - open file dialog filtered to `.json`
  - read file content as UTF-8
  - return `{ path, content }` or `null` on cancel.
- [ ] Implement VS Code theme conversion in `src/lib/editorSupport.ts`:
  - parse/validate `name`, `type`, `colors`, `tokenColors`
  - create stable theme id such as `vscode:${slug(name)}`
  - map `tokenColors[].scope` and `settings.foreground/fontStyle` into Monaco `rules`
  - preserve editor colors directly where Monaco supports them.
- [ ] Register imported themes whenever editor support initializes.
- [ ] Update `setEditorTheme()` so missing/invalid selected theme falls back to `stackdock-dark`.
- [ ] Update `EditorPanel` to use selected theme/font/tab settings from `StackDockSettings` instead of hard-coded editor options where applicable.
- [ ] Add Appearance settings UI:
  - editor theme dropdown with built-in + imported themes
  - `Import VS Code Theme JSON` button
  - remove selected imported theme button
  - validation/error message for invalid JSON or unsupported theme shape.
- [ ] Save imported themes and selected theme through existing settings save flow.
- [ ] Add small manual documentation in `README.md` explaining that VS Code theme JSON files are supported, but full extension installation/TextMate grammar fidelity is not included.

## Verification

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] In dev, open Settings → Looks & feel and import a known VS Code theme JSON.
- [ ] Confirm imported theme appears in the editor theme dropdown.
- [ ] Select the imported theme, save settings, open a file, and confirm Monaco colors change.
- [ ] Restart `npm run dev` and confirm the imported theme persists.
- [ ] Import invalid JSON and confirm a clear error appears without crashing.
- [ ] Remove an imported theme and confirm selection falls back to `stackdock-dark` if the removed theme was active.

## Notes / Limitations

- This plan supports theme JSON files, not VS Code extension installation.
- Token color matching will be approximate with Monaco's default tokenization. Full VS Code TextMate fidelity would require additional dependencies such as `vscode-textmate` and Oniguruma and should be a separate follow-up feature.
