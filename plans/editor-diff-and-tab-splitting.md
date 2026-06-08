# Editor Diff and Tab Splitting Plan

## Context
- User wants to replace the small git diff at the bottom with diff support directly in the text editor.
- Diff mode should support side-by-side and inline modes, switchable from the topbar.
- Editor tabs should gain a right-click context menu with split left/right/up/down, close, close others, close to right, and close to left.

## Current findings
- App uses React + Monaco (`monaco-editor`) and Electron APIs.
- `src/components/workspace/EditorPanel.tsx` owns a single `IStandaloneCodeEditor`, creates/reuses Monaco models by `monaco.Uri.file(path)`, and receives tab state from `WorkspaceShell`.
- `src/components/workspace/WorkspaceShell.tsx` renders one unified main tabbar (Terminal + files + web tabs), tracks editor/web tabs per terminal session in local `editorsBySession`, persists only the union of file paths to `WorkspaceLayout.editors`, and already supports terminal splitting via `react-resizable-panels` elsewhere.
- `src/components/workspace/GitPanel.tsx` currently shows the bottom inline text diff with `DiffView`; selecting a git file sets `selectedGitFile`, loads `api.git.diff(...)`, then opens the file in the editor.
- Git API exposes `git.diff(path, filePath?, staged?)`, implemented by `electron/gitService.ts` as `git diff [--staged] -- file`, but there is no API for reading the original/HEAD version of a file.
- Existing right-click context menu styles and behavior can be reused from `FileTree` and `GlobalSessionsSidebar` (`.context-menu`, `.context-menu-item`).
- Theme support already defines CSS variables for diff colors in `src/lib/themeSupport.ts`; Monaco diff editor theme colors should pick these up through the registered theme when possible.

## Approach
- Replace the Git panel’s embedded `<DiffView>` with editor-integrated diff state: Git panel remains the source-control file/action list, but the selected change is displayed in the main editor area.
- Add a workspace-level editor diff mode (`side-by-side` vs `inline`) controlled by compact topbar buttons/dropdown. This maps to Monaco diff editor `renderSideBySide`.
- Extend `EditorPanel` to manage both a normal `IStandaloneCodeEditor` and an `IStandaloneDiffEditor`, showing one or the other based on an optional active diff descriptor. The diff editor will use the active file’s working content as the modified model.
- Add an Electron Git API for original file content (recommended: `git show HEAD|:path` or `git show :path` for staged diffs, with empty content for untracked/added files and sensible handling for deleted files) because Monaco diff editor needs original and modified text, not just unified diff text.
- Introduce editor groups in `WorkspaceShell` state so file tabs can be split left/right/up/down. Each group has its own `openFiles` array and `activeFile`; the group layout can be represented as a simple tree or a constrained grid using `PanelGroup` for first implementation.
- Implement file-tab context menu in the unified tabbar using existing `.context-menu` styles. Actions: Split Left/Right/Up/Down, Close, Close Others, Close to Right, Close to Left.
- For split actions, create/select a target editor group adjacent to the source group and copy the tab into it while leaving the original tab in place; this matches common editor split behavior and is safest for dirty tabs.
- Persist editor split groups/layout in `WorkspaceLayout` so panes restore after reload, while keeping a migration path from the current flat `editors.openFiles` shape.

## Files to modify
- `src/components/workspace/EditorPanel.tsx` — add Monaco diff editor support and props for active diff/mode.
- `src/components/workspace/WorkspaceShell.tsx` — add editor group state, render split editor panes, topbar diff mode control, Git selection wiring, and tab context menu actions.
- `src/components/workspace/GitPanel.tsx` — remove bottom `DiffView` and optionally show selected-file/diff-open status instead.
- `src/styles.css` — split editor layout, diff mode controls, and context-menu refinements if needed.
- `src/shared/types.ts` — add Git original-content API type and optionally persisted editor group layout types.
- `electron/gitService.ts`, `electron/main.ts`, `electron/preload.ts` — expose original-content API for Monaco diff editor.

## Reuse
- Reuse `languageFor`, `registerEditorSupport`, `registerThemes`, and `applyTheme` from `src/lib/editorSupport.ts` / `src/lib/themeSupport.ts`.
- Reuse existing file read/write flow and Monaco model creation in `EditorPanel.tsx`.
- Reuse existing `api.git.diff(...)` for refresh/error handling only if still useful; use a new original-content API for actual Monaco diff models.
- Reuse existing source control selection/stage/unstage/discard/commit logic in `WorkspaceShell.tsx` and `GitPanel.tsx`.
- Reuse context-menu CSS and close-on-outside-click pattern from `FileTree.tsx` / `GlobalSessionsSidebar.tsx`.
- Reuse `react-resizable-panels` already used by `WorkspaceShell.tsx` for split editor panes.

## Steps
- [ ] Add and type a Git API for retrieving original file contents for unstaged/staged/untracked/deleted cases.
- [ ] Add editor diff state in `WorkspaceShell` tied to selected Git file and refresh it after save/stage/unstage/discard/commit.
- [ ] Update `GitPanel` so selecting a file opens the file and activates editor diff, without rendering the old bottom text diff.
- [ ] Extend `EditorPanel` to create/dispose a Monaco diff editor, wire original/modified models, respect inline vs side-by-side mode, and keep normal editing behavior unchanged outside diff mode.
- [ ] Add topbar diff controls in the right action cluster, visible when an editor diff is active.
- [ ] Replace single editor tab state with editor groups/panes in `WorkspaceShell`, rendering multiple `EditorPanel` instances via resizable split layout.
- [ ] Add tab context menu actions for split/close variants, using group-aware close behavior.
- [ ] Update layout persistence if split panes should be restored.
- [ ] Update styles for split panes, active editor group, and diff controls.

## Verification
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Manually verify unstaged modified file shows side-by-side diff in editor.
- [ ] Manually verify inline diff toggle updates the active Monaco diff editor.
- [ ] Manually verify staged, added/untracked, and deleted file diffs have sensible original/modified content.
- [ ] Manually verify Save refreshes git state/diff and does not corrupt dirty editor content.
- [ ] Manually verify tab context menu Split Left/Right/Up/Down, Close, Close Others, Close to Right, and Close to Left across one and multiple editor groups.
