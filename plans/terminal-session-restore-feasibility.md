# Terminal Session Restore Plan

## Context

StackDock should feel like it returns to the same working terminal after restart: reopen the last workspace/session, recreate the terminal(s), restore visible scrollback, and resume a Pi conversation when Pi exposes a durable resume command or session id. This targets Windows, macOS, and Linux without promising impossible OS-level PTY resurrection.

## Feasibility conclusion

- Cross-platform relaunch/resume is feasible with the existing Electron + `node-pty` architecture.
- True restoration of a killed OS process is not feasible after full app quit; the implementation should recreate processes and use Pi's own resume capability when available.
- Scrollback restoration is feasible as a visual snapshot, but should be treated as historical output. It should not be sent to the restarted PTY as input.

## Approach

1. Persist app/window restore state separately from workspace layout: last active workspace id and last active terminal id.
2. Extend workspace layout terminal data with restore-specific metadata:
   - stable restore id separate from the runtime `node-pty` session id,
   - active terminal id,
   - optional scrollback snapshot/ring buffer,
   - optional Pi resume metadata/command.
3. On app startup, load settings/workspaces as today, then auto-open the last active workspace if it still exists.
4. In `WorkspaceShell`, recreate saved terminals from layout as today, map saved restore ids to new runtime ids, and select the restored active session.
5. Restore scrollback visually in `TerminalView` before live output arrives. Prefer a bounded per-session output snapshot captured in the main process so hidden/inactive sessions are covered too.
6. Add Pi resume support by detecting Pi's shutdown hint in terminal output: `To resume this session: pi --session <session-id>`. Store the parsed session id and resume command with the terminal's restore metadata.
7. On restore, if a saved terminal has Pi resume metadata, launch the shell normally and write `pi --session <session-id>` as the startup command instead of the original Pi command.
8. Surface restore status conservatively in the terminal, e.g. `[restored scrollback]` and `[resuming Pi session ...]`, so users can distinguish historical output from live process output.

## Files to modify

- `src/shared/types.ts`
  - Add persisted restore fields to `WorkspaceLayout` / `TerminalSession` or introduce a layout-only `PersistedTerminalSession` shape.
  - Add API methods for reading terminal scrollback snapshots if the main process owns them.
- `electron/storage.ts`
  - Add path helper for app restore state and possibly terminal scrollback state.
- `electron/workspaceStore.ts`
  - Reuse layout storage; add helpers for app restore state if not placed in a new store.
- `electron/terminalManager.ts`
  - Capture bounded output per terminal from `terminal.onData` for all sessions, including inactive/unmounted terminals.
  - Expose snapshot lookup and clear snapshots when sessions are closed.
- `electron/main.ts`
  - Add IPC handlers for restore state and terminal snapshot APIs with validation.
- `electron/preload.ts`
  - Expose new restore/snapshot IPC methods through `window.stackdock`.
- `electron/validation.ts`
  - Add guards for restore state, terminal ids, and snapshot limits.
- `src/App.tsx`
  - Auto-open the last active workspace after workspaces load.
- `src/state/workspaceStore.ts`
  - Coordinate loading/saving active workspace restore state.
- `src/state/sessionStore.ts`
  - Preserve stable restore ids while replacing runtime ids after relaunch.
  - Persist active session changes.
- `src/components/workspace/WorkspaceShell.tsx`
  - Save active terminal id in layout.
  - Recreate terminals with resume commands when available.
  - Map saved terminal ids/restore ids to newly created runtime terminal ids.
- `src/components/workspace/TerminalPanel.tsx`
  - Load and write visual scrollback snapshots into xterm without sending them to `api.terminal.write`.
  - Append restored/live separator messaging.
- `src/components/workspace/SettingsModal.tsx` or a session context menu component if configuration is user-facing
  - Likely not required for the first pass because Pi emits a detectable resume command; only add settings if detection proves insufficient.

## Reuse

- Existing layout persistence: `electron/workspaceStore.ts` `loadLayout()` / `saveLayout()`.
- Existing data directory helpers: `electron/storage.ts`.
- Existing terminal metadata persistence: `WorkspaceLayout.terminals` in `src/shared/types.ts` and `WorkspaceShell`'s debounced `api.workspaces.saveLayout(...)`.
- Existing terminal relaunch flow: `src/state/sessionStore.ts` `createSession()` and `WorkspaceShell.restartTerminal()`.
- Existing startup command support: `electron/terminalManager.ts` writes `startupCommand` to the spawned PTY.
- Existing IPC pattern: `electron/main.ts` + `electron/preload.ts` + `src/shared/types.ts` + `electron/validation.ts`.

## Steps

- [x] Add a persisted app restore state file containing `lastWorkspaceId` and `lastTerminalRestoreId`/`lastTerminalRuntimeId`.
- [x] Add stable terminal restore ids so a saved terminal can be matched to its newly created runtime session id after app restart.
- [x] Persist active terminal information with workspace layout saves.
- [x] Capture bounded terminal output snapshots in `electron/terminalManager.ts` from `onData`; keep memory/disk limits per terminal.
- [x] Add IPC/preload API to fetch the snapshot for a terminal restore id/runtime id.
- [x] Restore the last active workspace from `App.tsx` once workspaces and settings have loaded.
- [x] Recreate saved terminals in `WorkspaceShell`, preserving names/profile/cwd/split layout and selecting the previously active terminal.
- [x] Before attaching live output in `TerminalPanel`, write restored scrollback to xterm only, then add a separator before live output.
- [x] Add Pi resume detection in terminal output using a bounded regex for `To resume this session: pi --session <session-id>`.
- [x] Store the parsed Pi session id and exact resume command on the terminal restore metadata.
- [x] On restore, prefer the stored `pi --session <session-id>` startup command for that terminal.
- [x] If detection cannot find a session id, fall back to normal terminal recreation without Pi resume.
- [x] Ensure terminal close/kill removes restore snapshots for intentionally closed sessions, while app close preserves them.

## Verification

- Run type checks: `npm run typecheck`.
- Run tests: `npm test`.
- Manual: open workspace A, create two terminals, select the second, close/reopen StackDock, confirm workspace A opens and the second terminal is selected.
- Manual: generate output in an inactive terminal, close/reopen, confirm its scrollback snapshot is present when selected.
- Manual: verify restored scrollback is visual only by typing after restore and confirming old output is not sent to the shell.
- Manual: close a terminal intentionally, restart app, confirm that closed terminal does not reappear.
- Manual cross-platform profile checks:
  - Windows: PowerShell/CMD.
  - macOS: default shell profile.
  - Linux: default shell profile.
- Manual Pi check: start Pi conversation, exit it so it prints `To resume this session: pi --session <session-id>`, close/reopen StackDock, confirm the restored terminal runs that resume command and re-enters the same conversation.

## Pi detection detail

Detect and persist Pi resume commands from terminal output lines matching the shutdown hint, for example:

```text
To resume this session: pi --session 019eaab9-8e19-7ba7-9c2c-536f5eb90f2a
```

Suggested parser target: capture the session id after `pi --session`, preserving the full command as `pi --session <id>` for restore.
