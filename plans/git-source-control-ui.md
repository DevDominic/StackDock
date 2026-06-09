# Plan: Improve Source Control UI

## Context

The Source Control sidebar currently shows either Explorer or Git in a single sidebar pane. `GitPanel` supports one selected file at a time, with text actions at the bottom (`Stage`, `Unstage`, `Discard`) and a global `Stage All`. The user wants a more VS Code-like workflow: multi-select changed files (including shift-select ranges), stage/unstage selected files together, per-file `+` and undo (`<-`) buttons, ability to show Explorer and Git simultaneously with Git stacked below Explorer, and visual cleanup for awkward button styling.

## Approach

Replace the single-tab sidebar behavior with independent Explorer and Git toggles. When both are enabled, render them in a vertical stacked sidebar with Explorer on top and Source Control below. Add Git multi-selection scoped separately per group: staged files select only within the Staged group, and unstaged/untracked changes select only within the Changes group. Support normal click, ctrl/cmd-click, and shift-click range selection inside the current group.

Add compact inline row actions mirroring VS Code: `+` stages an unstaged/untracked row, and `<-` undoes the current row state. For staged rows, `<-` unstages. For unstaged/untracked rows, `<-` discards/reverts after one confirmation prompt. Batch actions operate on the current group selection, with one confirmation for multi-file discard. Reuse existing git IPC methods (`stage`, `unstage`, `discard`, `addAll`) by invoking them for selected paths, avoiding backend changes unless testing shows batch performance needs a dedicated IPC later.

## Files to modify

- `src/components/workspace/WorkspaceShell.tsx`
  - Replace `sidebarTab` single-active state with independent Explorer/Git visibility state and stacked rendering.
  - Own Git selection state and batch git handlers.
- `src/components/workspace/GitPanel.tsx`
  - Add selected path props, range/multi-select event handling, row action buttons, and selected batch actions.
- `src/components/icons.tsx`
  - Add small reusable `PlusIcon` and undo/arrow icon components if text glyphs are not sufficient.
- `src/styles.css`
  - Add stacked sidebar layout, Git row action, multi-selection, and button polish styles.
- Potentially `src/shared/types.ts`, `electron/gitService.ts`, `electron/main.ts`, `electron/preload.ts` only if a dedicated batch git IPC is needed.
- Potentially tests under `tests/` for any extracted selection helpers.

## Reuse

- `WorkspaceShell` git handlers: `stage`, `unstage`, `discard`, `stageAll`, `refreshGit`, `selectGitFile`.
- Existing `GitPanel` grouping by `Staged` / `Changes`, `statusText`, `statusClass`, `splitPath`, and file icon rendering.
- `react-resizable-panels` already used in `WorkspaceShell`; reuse it for nested vertical Explorer/Git stacked panels.
- Existing `WorkspaceLayout.panels.panelSizes.git` already exists and can store the vertical Git share.
- Existing `.tree-row`, `.git-file`, `.topbar-icon-btn`, `.git-actions`, and theme variables in `src/styles.css`.
- Existing `FileTree` panel title/list structure, so stacked Explorer can reuse the current component unchanged.
- Existing `src/components/icons.tsx` icon style helper for any new plus/undo icons.

## Decisions

- Multi-select is separate by group: selecting staged files does not select unstaged files, and selecting changes clears staged selection.
- Staged group stays above Changes and is shown only when staged files exist.
- Explorer and Source Control topbar buttons are independent toggles. When both are enabled, Source Control stacks below Explorer.
- Multi-file discard uses one confirmation prompt for the whole selection.
- Undo action semantics:
  - staged row: unstage
  - unstaged/untracked row: discard/revert with confirmation

## Steps

- [ ] Add sidebar visibility state that can represent Explorer only, Git only, both stacked, or hidden.
  - Keep existing layout fields compatible where possible (`fileTreeVisible`, `gitPanelVisible`) so older saved layouts still load.
  - Update commands/shortcuts/status-bar actions to toggle the matching pane instead of switching a single `sidebarTab`.
- [ ] Render the sidebar content based on visibility:
  - Explorer only: current `FileTree` fills the sidebar.
  - Git only: current `GitPanel` fills the sidebar.
  - Both: nested vertical `PanelGroup`, `FileTree` panel on top, resize handle, `GitPanel` panel below.
  - Persist the vertical split with existing `panelSizes.upper`/`panelSizes.git` or clearly named compatible panel size fields.
- [ ] Add Git selection state in `WorkspaceShell`:
  - Track selected paths by group (`staged` vs `changes`) and the last clicked path for shift ranges.
  - Clear the opposite group when selecting a file in the other group.
  - On `refreshGit`, remove selections for paths no longer present and preserve valid selections.
- [ ] Update `GitPanel` group rendering:
  - Hide the Staged section when empty; keep it above Changes when present.
  - Pass each group’s ordered file list into selection logic so shift-click selects the inclusive range.
  - Use normal click to select/open diff, ctrl/cmd-click to toggle a row, and shift-click to select a range.
  - Keep the primary selected file/diff behavior intact for the clicked row.
- [ ] Add per-row VS Code-like action buttons:
  - `+` button on unstaged/untracked rows calls stage for that row (or selected Changes files when the row is selected, if implemented consistently).
  - `<-` button on staged rows calls unstage.
  - `<-` button on unstaged/untracked rows calls discard/revert with confirmation.
  - Stop event propagation so row action clicks do not change/open the selection unexpectedly.
- [ ] Add selected-file batch actions:
  - Changes selection: `Stage Selected` and `Discard Selected`.
  - Staged selection: `Unstage Selected`.
  - Use one discard confirmation for the whole selection and handle untracked files via `api.fs.deletePath` as current `discard` does.
- [ ] Polish Source Control UI styles:
  - Add selected multi-row state distinct from active diff row.
  - Make inline action buttons small, aligned, visible on hover/focus/selected rows, and accessible by keyboard focus.
  - Replace awkward text-heavy bottom controls with clearer labels/counts and prevent clipping.
  - Ensure topbar active states correctly show Explorer, Git, or both.

## Verification

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test`.
- [ ] Run `npm run build` if typecheck/tests pass.
- [ ] Manual Electron check: open a git workspace with several changed files, use click/shift-click/ctrl-click to select files, stage selected, unstage selected, and verify diffs still open on row click.
- [ ] Manual Electron check: show Explorer and Source Control together and confirm Git stacks below Explorer, resize behavior works, and layout persists.
- [ ] Manual visual check: row action buttons, bottom action buttons, topbar active states, and hover/focus states look consistent across selected and unselected rows.
