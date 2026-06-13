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

## Map Info

When making changes to file directories, creating new files, adjusting file names etc., ensure that `AGENT.md` is updated to reflect any changes to the Map

## Map
```
electron/                  Main process (Node services, IO)
  main.ts                  App bootstrap + ALL ipcMain.handle registrations
  preload.ts               contextBridge → window.stackdock
  validation.ts            assert* guards for every IPC arg
  workspaceStore.ts        Workspace CRUD + layout load/save (JSON)
  fileService.ts           fs ops: read/write/create/rename/delete dir & files
  browserBridge.ts         webview/browser bridge main-process handling
  extensionService.ts      bundled/local extension manifest loading + assets
  terminalManager.ts       node-pty session lifecycle, data/exit/status events
  attachmentService.ts     Terminal drag/drop/paste attachment inspection/cache
  configStore.ts           Settings (theme, editor, terminal profiles) persist
  automationStore.ts       automation.json: palette cmds + per-workspace setups
  storage.ts               userData data-dir setup
  log.ts                   Error logging

src/
  main.tsx                 Renderer entry
  App.tsx                  Dashboard ⇄ WorkspaceShell switch; loads settings/theme
  shared/
    types.ts               ★ Shared API + domain types (main ↔ renderer contract)
    terminalProfiles.ts    Terminal-profile defaults and helpers
    terminalSnapshot.ts    Terminal snapshot sanitizing/trimming helpers
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
    common/ToastProvider.tsx           Toasts
    workspace/
      WorkspaceShell.tsx               ★ Main layout: wires extension views + panels
      EditorPanel.tsx                  Monaco editor + open-file tabs
      TerminalPanel.tsx                xterm view bound to a pty session
      WebTabPanel.tsx                  In-app browser <webview> tabs
      SessionSwitcher.tsx              Session picker UI
      CommandLauncher.tsx              Command palette
      CommandsEditor.tsx               Edit global/per-workspace commands
      NewTerminalMenu.tsx              Terminal-profile picker
      SettingsModal.tsx                Settings UI (theme/editor/terminal/profiles)
      StatusBar.tsx                    Bottom widget status bar
      JsonCodeEditor.tsx               JSON editor wrapper used by settings/commands
      fileIcons.tsx                    Path → icon mapping
  extensions/
    ExtensionFrame.tsx     sandboxed iframe host for local extension views
    ExtensionProvider.tsx  extension context/provider wiring
    configuration.ts       extension configuration helpers
    enablement.ts          enablement/filtering of extension contributions
    extensionTypes.ts      renderer extension interfaces and contexts
    registry.tsx           registers bundled native extension renderers
  styles.css               Global CSS (driven by theme CSS vars)

extensions/                 Built-in extension packages
  builtin/explorer/
    manifest.ts
    renderer/FileTree.tsx
    renderer/index.tsx
    renderer/explorer.css
  builtin/git/
    manifest.ts
    main/gitService.ts     git status/diff/stage/unstage/discard/commit/addAll
    main/gitParser.ts      Parse git porcelain output → GitStatus
    renderer/GitPanel.tsx
    renderer/index.tsx
    renderer/git.css
  builtin/sessions/
    manifest.ts
    renderer/GlobalSessionsSidebar.tsx
    renderer/SessionsSettings.tsx
    renderer/index.tsx
    renderer/sessions.css
  builtin/workspace-status/
    manifest.ts
    renderer/WorkspaceStatusSettings.tsx
    renderer/index.tsx
    renderer/workspaceStatus.css

tests/                      Vitest coverage for services, extensions, git, terminals, renderer stores
docs/                       Extension authoring and folder-format docs
release/                    electron-builder output dir for packaged .exe/installers (generated, not source)
dist/                       Vite renderer build output (generated; packaging input)
dist-electron/              Electron main/preload build output (generated; packaging input)
```

## Commands
- `npm run dev` — build once (`npm run build`) then launch Electron with `--agent-browser --built` support. `--built` forces the unpackaged app to load `dist/index.html` instead of the Vite dev server. No Vite/tsc watch, no HMR, no auto-restart; rerun after source changes when testing latest build. Remote debugging is available for agent-browser interaction.
- `npm run build` — tsc (electron) + vite build into `dist-electron/` and `dist/`.
- `npm run build:app` — clean generated package artifacts, build, then create a maximally compressed Windows x64 portable `.exe` with `electron-builder`; output goes to `release/`. Stop `npm run dev` first so nodemon does not relaunch the app while packaging.
- `npm run build:installer` — same build path but creates an NSIS installer in `release/`.
- `npm run build:web-installer` — creates an NSIS web installer in `release/` (smaller initial installer, downloads payload during install).
- `npm run dist` / `npm run dist:x64:min` — legacy aliases; prefer `build:app` for current packaged-app checks.
- `npm test` — vitest. `npm run typecheck` — both tsconfigs, `--noEmit`.

## Extension Architecture
- Built-in workspace UI surfaces (Explorer, Source Control/Git, Sessions, status items) are bundled extensions. Prefer adding new workspace side/bottom/status UI as extension contributions instead of hardcoding panels in `WorkspaceShell.tsx`.
- Local extension JavaScript must run only inside sandboxed iframes served through the extension asset protocol.
- Never dynamically import local package code into the StackDock renderer; local packages communicate with the host via the typed iframe bridge only.
- Extension IPC and bridge payloads must use typed shared contracts from `src/shared/types.ts` and validated main-process boundaries.
- New extension loader/enablement/bridge tests should run with `npm test`.

## Conventions
- When asked to interact with or test the running Electron app, use the native `agent_browser` tool against the `npm run dev` app launched with `--agent-browser`; do not use manual browser-driving scripts unless explicitly requested.
- New backend capability = add channel in `main.ts` + arg guards in `validation.ts` + bridge method in `preload.ts` + type in `shared/types.ts` `StackDockApi`. Keep all four in sync.
- Renderer never imports Node/`electron`; go through `api`.
- Global terminal active-session fallback prefers another session in the same workspace before falling back to other workspaces, so session highlighting and restore state stay aligned.
- Windows browser-capture helpers should avoid visible console windows; Plannotator/browser opens route through the hidden bridge helper into StackDock web tabs.
- Theming is unified: a single `themeId` drives both Monaco and the app via CSS variables in `themeSupport.ts`. VS Code `*-color-theme.json` files can be imported by users.
- IPC channel naming: `domain:action`. Renderer→main events listened via `onTerminalData` / `onTerminalExit` / `onTerminalStatus` / `onWorkspaceChanged`.
- Packaging size notes: renderer-only libraries live in `devDependencies` because Vite bundles them into `dist/`; keep only true main-process runtime modules (currently `node-pty`) in `dependencies`. Electron Builder outputs to `release/` to avoid recursively packaging `dist/win-unpacked`; keep generated package artifacts out of `dist/` or explicitly excluded in `build.files`.
- `node-pty` packaging is x64-trimmed: only `node_modules/node-pty/prebuilds/win32-x64/**/*.{node,dll,exe}` is unpacked, and arm64 prebuilds/PDBs/source/deps are excluded for smaller Windows x64 builds.
