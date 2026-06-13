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

## Project Map

Repository map lives in `PROJECT_MAP.md`. Update `PROJECT_MAP.md` when changing folder structure, adding/removing major files, or changing architecture flows.

To create or refresh the project map, use the standalone project-mapping prompt, not this file.

Use LeanCTX for repo exploration where available.
Prefer small, targeted changes.
Do not modify generated files, lockfiles, dependency files, or git state unless explicitly requested.

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
