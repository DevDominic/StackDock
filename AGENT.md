# StackDock

Electron desktop dev workbench: manage multiple project **workspaces**, each with a Monaco code editor, `node-pty` terminals, a git source-control panel, and in-app web tabs. Think lightweight, workspace-centric VS Code.

## Stack
- **Electron 36** (main + preload) ↔ **React 18 + TypeScript** renderer, bundled by **Vite 6**.
- **monaco-editor** (editor), **xterm + node-pty** (terminals), **zustand** (renderer state), **react-resizable-panels** (layout).
- Tests: **vitest**. Package: `electron-builder` → Windows x64 portable/NSIS outputs in `release/`.

## Architecture
Three TS programs, two tsconfigs:
- **Main** (`electron/`, `electron/tsconfig.json` → `dist-electron/`): Node-side services. All IO (fs, git, pty, dialogs, persistence) lives here, exposed only via `ipcMain.handle` channels named `domain:action` (see `electron/main.ts`).
- **Preload** (`electron/preload.ts`): `contextBridge` exposes a typed `window.stackdock` API. `contextIsolation: true`, `nodeIntegration: false`.
- **Renderer** (`src/`, root `tsconfig.json` → `dist/`): React UI. Touches the backend **only** through `api` (`src/lib/api.ts` = `window.stackdock`). No direct Node access. `dist/` is renderer build input to packaging, not the final packaged app output.

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
  terminalManager.ts       node-pty session lifecycle, data/exit/status events
  terminalStatusParser.ts  Parses StackDock OSC status-bar messages from terminal output
  attachmentService.ts     Terminal drag/drop/paste attachment inspection/cache
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
    terminalAttachments.ts Terminal attachment serialization helpers
    errors.ts              Error helpers
    themes/                Bundled VS Code color-theme JSON
  state/                   zustand stores (renderer-only state)
    workspaceStore.ts      Workspace list + active workspace
    sessionStore.ts        Global terminal-session registry (cross-workspace)
  components/
    TitleBar.tsx                       Custom/native window titlebar controls
    icons.tsx                          Shared SVG icon components
    dashboard/WorkspaceDashboard.tsx   Home: list/add/create/pin/open workspaces
    workspace/
      WorkspaceShell.tsx               ★ Main layout: wires all panels (largest file)
      EditorPanel.tsx                  Monaco editor + open-file tabs
      TerminalPanel.tsx                xterm view bound to a pty session
      FileTree.tsx                     File explorer
      GitPanel.tsx                     Source-control panel
      WebTabPanel.tsx                  In-app browser <webview> tabs
      GlobalSessionsSidebar.tsx        All terminal sessions across workspaces
      SessionSwitcher.tsx              Session picker UI
      CommandLauncher.tsx              Command palette
      CommandsEditor.tsx               Edit global/per-workspace commands
      NewTerminalMenu.tsx              Terminal-profile picker
      SettingsModal.tsx                Settings UI (theme/editor/terminal/profiles)
      StatusBar.tsx                    Bottom widget status bar
      fileIcons.tsx                    Path → icon mapping
    common/ToastProvider.tsx           Toasts
  styles.css                           Global CSS (driven by theme CSS vars)

release/                    electron-builder output dir for packaged .exe/installers (generated, not source)
dist/                       Vite renderer build output (generated; packaging input)
dist-electron/              Electron main/preload build output (generated; packaging input)
```

## Commands
- `npm run dev` — Vite + electron tsc watch + Electron with `--agent-browser` support (HMR at :5173, remote debugging at :9222 for `agent_browser connect 9222`). The script runs three long-lived processes from `package.json`: Vite watches `src/`, `tsc -p electron/tsconfig.json -w` rebuilds `electron/` into `dist-electron/`, and `nodemon --watch dist-electron --exec electron . --agent-browser` automatically restarts Electron whenever the rebuilt main/preload output changes. In short: edit renderer → HMR; edit Electron main/preload/services → TypeScript rebuilds then Electron restarts automatically. DevTools does not detach automatically in agent-browser mode.
- `npm run dev:agent` — alias for `npm run dev` kept for compatibility.
- `npm run build` — tsc (electron) + vite build into `dist-electron/` and `dist/`.
- `npm run build:app` — clean generated package artifacts, build, then create a maximally compressed Windows x64 portable `.exe` with `electron-builder`; output goes to `release/`. Stop `npm run dev` first so nodemon does not relaunch the app while packaging.
- `npm run build:installer` — same build path but creates an NSIS installer in `release/`.
- `npm run build:web-installer` — creates an NSIS web installer in `release/` (smaller initial installer, downloads payload during install).
- `npm run dist` / `npm run dist:x64:min` — legacy aliases; prefer `build:app` for current packaged-app checks.
- `npm test` — vitest. `npm run typecheck` — both tsconfigs, `--noEmit`.

## Conventions
- New backend capability = add channel in `main.ts` + arg guards in `validation.ts` + bridge method in `preload.ts` + type in `shared/types.ts` `StackDockApi`. Keep all four in sync.
- Renderer never imports Node/`electron`; go through `api`.
- Theming is unified: a single `themeId` drives both Monaco and the app via CSS variables in `themeSupport.ts`. VS Code `*-color-theme.json` files can be imported by users.
- IPC channel naming: `domain:action`. Renderer→main events listened via `onTerminalData` / `onTerminalExit` / `onTerminalStatus` / `onWorkspaceChanged`.
- Packaging size notes: renderer-only libraries live in `devDependencies` because Vite bundles them into `dist/`; keep only true main-process runtime modules (currently `node-pty`) in `dependencies`. Electron Builder outputs to `release/` to avoid recursively packaging `dist/win-unpacked`; keep generated package artifacts out of `dist/` or explicitly excluded in `build.files`.
- `node-pty` packaging is x64-trimmed: only `node_modules/node-pty/prebuilds/win32-x64/**/*.{node,dll,exe}` is unpacked, and arm64 prebuilds/PDBs/source/deps are excluded for smaller Windows x64 builds.
