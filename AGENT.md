# StackDock

Electron desktop dev workbench: manage multiple project **workspaces**, each with a Monaco code editor, `node-pty` terminals, a git source-control panel, and in-app web tabs. Think lightweight, workspace-centric VS Code.

## Stack
- **Electron 36** (main + preload) ↔ **React 18 + TypeScript** renderer, bundled by **Vite 6**.
- **monaco-editor** (editor), **xterm + node-pty** (terminals), **zustand** (renderer state), **react-resizable-panels** (layout).
- Tests: **vitest**. Package: `electron-builder` → Windows portable.

## Architecture
Three TS programs, two tsconfigs:
- **Main** (`electron/`, `electron/tsconfig.json` → `dist-electron/`): Node-side services. All IO (fs, git, pty, dialogs, persistence) lives here, exposed only via `ipcMain.handle` channels named `domain:action` (see `electron/main.ts`).
- **Preload** (`electron/preload.ts`): `contextBridge` exposes a typed `window.stackdock` API. `contextIsolation: true`, `nodeIntegration: false`.
- **Renderer** (`src/`, root `tsconfig.json` → `dist/`): React UI. Touches the backend **only** through `api` (`src/lib/api.ts` = `window.stackdock`). No direct Node access.

Contract: every IPC arg is validated in `electron/validation.ts` (assert* helpers) before a service runs. The full API + all data shapes are declared in `src/shared/types.ts` (`StackDockApi` interface) — **this is the source of truth shared by both sides; update it when changing any channel.**

Persistence: JSON files in the Electron userData dir (`electron/storage.ts` sets up dirs). Settings → `configStore.ts`, automation → `automationStore.ts`, workspaces + per-workspace layouts → `workspaceStore.ts`.

## Map
```
electron/                  Main process (Node services, IO)
  main.ts                  App bootstrap + ALL ipcMain.handle registrations
  preload.ts               contextBridge → window.stackdock
  validation.ts            assert* guards for every IPC arg
  workspaceStore.ts        Workspace CRUD + layout load/save (JSON)
  fileService.ts           fs ops: read/write/create/rename/delete dir & files
  gitService.ts            git status/diff/stage/unstage/discard/commit/addAll
  gitParser.ts             Parse git porcelain output → GitStatus
  terminalManager.ts       node-pty session lifecycle, data/exit events
  configStore.ts           Settings (theme, editor, terminal profiles) persist
  automationStore.ts       automation.json: palette cmds + per-workspace setups
  storage.ts               userData data-dir setup
  log.ts                   Error logging

src/
  main.tsx                 Renderer entry
  App.tsx                  Dashboard ⇄ WorkspaceShell switch; loads settings/theme
  shared/types.ts          ★ Shared API + domain types (main ↔ renderer contract)
  lib/
    api.ts                 = window.stackdock (the ONLY backend entry from UI)
    themeSupport.ts        VS Code theme JSON → Monaco theme + app CSS vars (large)
    editorSupport.ts       Monaco language/config registration
    monacoEnvironment.ts   Monaco web-worker wiring
    errors.ts              Error helpers
    themes/                Bundled VS Code color-theme JSON
  state/                   zustand stores (renderer-only state)
    workspaceStore.ts      Workspace list + active workspace
    sessionStore.ts        Global terminal-session registry (cross-workspace)
  components/
    dashboard/WorkspaceDashboard.tsx   Home: list/add/create/pin/open workspaces
    workspace/
      WorkspaceShell.tsx               ★ Main layout: wires all panels (largest file)
      EditorPanel.tsx                  Monaco editor + open-file tabs
      TerminalPanel.tsx                xterm view bound to a pty session
      FileTree.tsx                     File explorer
      GitPanel.tsx                     Source-control panel
      WebTabPanel.tsx                  In-app browser <webview> tabs
      GlobalSessionsSidebar.tsx        All terminal sessions across workspaces
      CommandLauncher.tsx              Command palette
      WorkspaceCommandsModal.tsx       Edit per-workspace commands
      NewTerminalMenu.tsx              Terminal-profile picker
      SettingsModal.tsx                Settings UI (theme/editor/terminal/profiles)
      fileIcons.tsx                    Path → icon mapping
    common/ToastProvider.tsx           Toasts
  styles.css                           Global CSS (driven by theme CSS vars)
```

## Commands
- `npm run dev` — Vite + electron tsc watch + Electron (HMR at :5173, devtools detached).
- `npm run build` — tsc (electron) + vite build.
- `npm run dist` — build + `electron-builder --win portable`.
- `npm test` — vitest. `npm run typecheck` — both tsconfigs, `--noEmit`.

## Conventions
- New backend capability = add channel in `main.ts` + arg guards in `validation.ts` + bridge method in `preload.ts` + type in `shared/types.ts` `StackDockApi`. Keep all four in sync.
- Renderer never imports Node/`electron`; go through `api`.
- Theming is unified: a single `themeId` drives both Monaco and the app via CSS variables in `themeSupport.ts`. VS Code `*-color-theme.json` files can be imported by users.
- IPC channel naming: `domain:action`. Renderer→main events listened via `onTerminalData` / `onTerminalExit` / `onWorkspaceChanged`.
