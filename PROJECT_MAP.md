# Project Map

## Overview

StackDock is a Windows-first Electron desktop workbench for managing project workspaces with terminals, git, file editing, and in-app web tabs. Main stack: Electron 36 main/preload, React 18 + TypeScript renderer, Vite 6 build, Monaco editor, xterm/node-pty terminals, Zustand state, Vitest tests, electron-builder packaging.

## Entry Points

| Path | Purpose |
| ---- | ------- |
| `electron/main.ts` | Electron app bootstrap, BrowserWindow creation, IPC handler registration, workspace watching. |
| `electron/preload.ts` | `contextBridge` exposing typed `window.stackdock` API to renderer. |
| `src/main.tsx` | React renderer mount. |
| `src/App.tsx` | Top-level dashboard/workspace switch, settings/theme loading. |
| `src/components/workspace/WorkspaceShell.tsx` | Main workspace UI composition and orchestration. |
| `index.html` | Vite renderer HTML entry. |
| `scripts/build-if-needed.cjs` | Incremental build wrapper used by `npm run build`. |
| `tests/*.test.ts` | Vitest test entry files. |

## Folder Map

### `electron`

Purpose: Electron main-process services, IPC handlers, validation, persistence, and Node-only integration.
Important files (paths are repo-relative; there is no top-level `main/` folder):

* `electron/main.ts` — app/window lifecycle and all `ipcMain.handle` registrations.
* `electron/preload.ts` — typed bridge from isolated renderer to main IPC.
* `electron/validation.ts` — IPC argument guard helpers; keep in sync with API changes.
* `electron/terminalManager.ts` — node-pty lifecycle, terminal snapshots, headless command output, terminal events.
* `electron/terminalIntegration.ts` — main-process terminal integration interfaces used by built-in extensions.
* `electron/workspaceStore.ts` — workspace CRUD, layout restore/save, restore-state JSON.
* `electron/fileService.ts` — filesystem read/write/create/rename/delete operations.
* `electron/configStore.ts` — user settings and terminal profile persistence.
* `electron/automationStore.ts` — palette commands and per-workspace automation config.
* `electron/extensionService.ts` — bundled/local extension manifest loading and extension assets.
* `electron/browserBridge.ts` — captured browser/webview bridge handling.
* `electron/attachmentService.ts` — terminal drag/drop/paste attachment inspection/cache.
* `electron/storage.ts` — Electron userData paths and data-dir setup.

### `src`

Purpose: React renderer, shared types/helpers, renderer stores, UI components, extension host.
Important files:

* `main.tsx` — React root render.
* `App.tsx` — dashboard/workspace routing and app settings/theme bootstrap.
* `styles.css` — global app CSS driven by theme variables.

### `src/shared`

Purpose: Contracts and pure helpers shared by Electron and renderer.
Important files:

* `types.ts` — source of truth for domain types and `StackDockApi` bridge contract.
* `terminalProfiles.ts` — default profiles and startup-command resolution.
* `terminalSnapshot.ts` — terminal snapshot sanitize/trim/replay helpers.
* `keybinds.ts` — keybinding matching helpers.
* `defaultKeybinds.ts` — default keybind definitions.

### `src/lib`

Purpose: Renderer-side adapters and UI support utilities.
Important files:

* `api.ts` — `window.stackdock`; only backend entry point from renderer.
* `themeSupport.ts` — VS Code theme import/mapping to Monaco and app CSS variables.
* `editorSupport.ts` — Monaco language/config registration.
* `monacoEnvironment.ts` — Monaco worker wiring.
* `terminalAttachments.ts` — terminal attachment serialization helpers.
* `errors.ts` — user-facing error message helpers.
* `themes/` — bundled VS Code color-theme JSON.

### `src/state`

Purpose: Renderer-only Zustand stores.
Important files:

* `workspaceStore.ts` — workspace list and active workspace state.
* `sessionStore.ts` — global terminal sessions and headless command run state.

### `src/components`

Purpose: Core React UI outside extension packages.
Important files:

* `TitleBar.tsx` — custom/native window titlebar controls.
* `icons.tsx` — shared SVG icon components.
* `dashboard/WorkspaceDashboard.tsx` — workspace list/add/create/pin/open dashboard.
* `common/ToastProvider.tsx` — toast notification provider.

### `src/components/workspace`

Purpose: Main workspace panels and content tabs.
Important files (paths are repo-relative; there is no top-level `workspace/` folder):

* `src/components/workspace/WorkspaceShell.tsx` — main layout, panels, extensions, terminal/editor/web/git command wiring.
* `src/components/workspace/EditorPanel.tsx` — Monaco editor and file tabs.
* `src/components/workspace/TerminalPanel.tsx` — xterm view bound to pty session output/input.
* `src/components/workspace/WebTabPanel.tsx` — in-app webview tabs.
* `src/components/workspace/CommandLauncher.tsx` — command palette.
* `src/components/workspace/CommandsEditor.tsx` — global/per-workspace command editing UI.
* `src/components/workspace/SettingsModal.tsx` — settings UI for theme/editor/terminal/profiles/extensions.
* `src/components/workspace/SessionSwitcher.tsx` — terminal/session picker.
* `src/components/workspace/StatusBar.tsx` — bottom status bar composition.
* `src/components/workspace/JsonCodeEditor.tsx` — JSON editor wrapper.

### `src/extensions`

Purpose: Renderer extension host, enablement, registry, and extension context types.
Important files:

* `extensionTypes.ts` — native extension interfaces and workspace context shape.
* `registry.tsx` — registers bundled native extension renderers.
* `ExtensionProvider.tsx` — extension provider/context wiring.
* `ExtensionFrame.tsx` — sandboxed iframe host for local extension views.
* `enablement.ts` — filters extension contributions by workspace context.
* `configuration.ts` — extension settings/config helpers.

### `extensions`

Purpose: Built-in extension packages and extension-owned code.
Important files:

* `mainRegistry.ts` — main-process registry for extension-owned terminal integrations.
* `builtin/explorer/` — file-tree view extension.
* `builtin/git/` — source-control UI plus git service/parser.
* `builtin/headless/` — headless command run list/output panel.
* `builtin/sessions/` — global sessions sidebar and settings.
* `builtin/workspace-status/` — workspace status contribution/settings.
* `builtin/pi/` — Pi-specific integration/renderer contribution.

### `docs`

Purpose: Extension authoring and built-in extension folder guidance.
Important files:

* `extensions.md` — local extension manifest/configuration/bridge notes.
* `extension-folder-format.md` — built-in extension layout and migration rules.

### `tests`

Purpose: Vitest coverage for main services, shared helpers, extension behavior, stores, and git parsing.
Important files:

* `attachmentService.test.ts` — attachment service behavior.
* `automationStore.test.ts` — automation config normalization.
* `extension*.test.ts` — extension service/config/enablement tests.
* `gitParser.test.ts` — git porcelain parsing.
* `sessionStore.test.ts` — renderer session store behavior.
* `terminal*.test.ts` — terminal profile/snapshot helpers.

### `scripts`

Purpose: Build helper scripts.
Important files:

* `build-if-needed.cjs` — hashes source/config inputs and skips rebuild when `dist` + `dist-electron` are current.

### `third-party`

Purpose: Third-party notices/licenses for bundled assets.
Important files:

* `catppuccin-noctis/LICENSE.md` — bundled default theme license.

## Important Files

| File | Purpose |
| ---- | ------- |
| `AGENT.md` | Project instructions, architecture notes, and working conventions. Update when structure changes. |
| `README.md` | Short product/dev overview and theme-support notes. |
| `package.json` | npm scripts, dependency lists, electron-builder config. |
| `package-lock.json` | npm lockfile; do not edit manually. |
| `tsconfig.json` | Renderer/shared TypeScript config for `src`. |
| `electron/tsconfig.json` | Electron main/preload TypeScript config outputting to `dist-electron`. |
| `vite.config.ts` | Renderer build/dev-server config and manual chunks. |
| `vitest.config.mts` | Vitest node environment config. |
| `index.html` | Vite HTML shell. |

## Core Flows

* App startup: `electron/main.ts` -> `createWindow()` -> load built `dist/index.html` or dev server -> `preload.ts` exposes `window.stackdock` -> `src/main.tsx` renders `App`.
* Renderer/backend API: React UI -> `src/lib/api.ts` -> `window.stackdock` -> `preload.ts` -> `ipcRenderer.invoke/on` -> `electron/main.ts` handlers -> services.
* IPC contract changes: update `src/shared/types.ts` -> validate args in `electron/validation.ts` -> add handler in `electron/main.ts` -> expose method/event in `electron/preload.ts`.
* Workspace flow: dashboard/store calls workspace API -> `electron/workspaceStore.ts` reads/writes userData JSON -> `WorkspaceShell` loads/saves layout and restore state.
* Terminal flow: `WorkspaceShell`/`sessionStore` creates session -> `electron/terminalManager.ts` spawns `node-pty` -> output events through preload -> `TerminalPanel` renders xterm and sends input back.
* Headless command flow: palette command with `headless` -> terminal created hidden -> `terminalManager` wraps command + exit -> live output updates `sessionStore.headlessRuns` -> headless extension displays output -> result toast on completion.
* Editor/file flow: Explorer or workspace actions -> `WorkspaceShell.openFile` -> file API in `fileService` -> `EditorPanel` edits -> save via file API.
* Git flow: Git extension UI -> workspace context actions in `WorkspaceShell` -> git API handlers -> `extensions/builtin/git/main/gitService.ts` and parser.
* Extension flow: `electron/extensionService.ts` loads manifests -> renderer registry/provider resolves enabled contributions -> `WorkspaceShell` renders native views or iframe `ExtensionFrame` for local packages.
* Persistence flow: Electron userData JSON via `storage.ts`; settings/config/automation/workspaces/layouts/snapshots are separate service-owned files.
* Build/package flow: `npm run build` -> `scripts/build-if-needed.cjs` -> `npm run build:force` when stale -> `tsc -p electron/tsconfig.json` + `vite build` -> `dist-electron` + `dist`; builder scripts package to `release`.

## Key Modules / Components

| Symbol/File | Responsibility | Notes |
| ----------- | -------------- | ----- |
| `StackDockApi` / `src/shared/types.ts` | Main-renderer API contract. | Keep synced with preload/main/validation. |
| `WorkspaceShell` | Central workspace coordinator and layout owner. | Large hotspot; prefer extension contributions for new panels. |
| `TerminalPanel` | xterm rendering, snapshot replay, terminal input/output. | Sensitive to terminal geometry and replay timing. |
| `terminalManager.ts` | PTY sessions, snapshots, headless command completion. | Node-only; handles hidden/visible output buffering. |
| `workspaceStore.ts` (main) | Workspace and layout persistence. | Uses JSON in Electron userData. |
| `sessionStore.ts` (renderer) | Terminal/headless session state. | Global across workspaces. |
| `ExtensionProvider` / `registry.tsx` | Renderer extension registration and context. | Built-ins are native React modules. |
| `ExtensionFrame.tsx` | Local extension iframe host. | Local JS must stay sandboxed. |
| `gitService.ts` / `gitParser.ts` | Git commands and status parsing. | Extension-owned backend code. |
| `themeSupport.ts` | VS Code theme mapping to Monaco/app CSS vars. | Large, change carefully. |
| `configStore.ts` | Settings persistence and defaults. | Drives UI/theme/terminal profiles/extensions. |
| `automationStore.ts` | Palette commands and workspace automation. | Headless/autoStart flags normalized here. |
| `validation.ts` | IPC boundary validation. | Security-sensitive. |

## Dependencies Between Areas

```text
Renderer components -> src/lib/api -> preload bridge -> electron/main IPC -> electron services / extension main services -> filesystem, git, pty, Electron APIs
```

```text
src/shared/types + helpers -> imported by both electron and renderer
src/extensions host -> extensions/builtin/*/renderer -> WorkspaceShell contribution rendering
extensions/builtin/*/main -> electron/main or extensions/mainRegistry -> Electron services
src/state stores -> renderer components -> api bridge
```

Renderer should not import Node/Electron modules directly. Main process should not depend on renderer components.

## Build, Test, and Dev Commands

| Command | Purpose | Expected success signal |
| ------- | ------- | ----------------------- |
| `npm install` | Install dependencies from lockfile. | `node_modules` installed, no npm errors. |
| `npm run dev` | Build if needed, launch Electron with `--agent-browser --built`. | Electron window opens after build/cache message. |
| `npm run build` | Incremental build using source hash cache. | Either “Build cache current…” or successful `build:force`. |
| `npm run build:force` | Force Electron TS compile and Vite renderer build. | `tsc` passes and Vite build completes. |
| `npm run typecheck` | Typecheck renderer and Electron projects without emit. | Both `tsc` commands exit 0. |
| `npm test` | Run Vitest suite. | Vitest reports passing tests. |
| `npm run build:app` | Build and package Windows x64 portable app. | electron-builder writes portable output in `release`. |
| `npm run build:installer` | Build and package Windows NSIS installer. | installer output in `release`. |
| `npm run build:web-installer` | Build and package NSIS web installer. | web installer output in `release`. |
| `npm start` | Launch Electron using configured `main`. | Electron app starts from built files. |

Note: `package.json` references `npm run clean:dist` in packaging scripts, but no `clean:dist` script was present during inspection.

## Generated / Do Not Edit

* `node_modules/` — installed dependencies.
* `dist/` — Vite renderer build output.
* `dist-electron/` — Electron main/preload TypeScript output.
* `release/` — electron-builder package output.
* `.buildstamp` — build cache metadata written by `scripts/build-if-needed.cjs`.
* `package-lock.json` — npm lockfile; update only through npm install/update workflows.
* Electron userData JSON files — runtime data, not repo source.

## Known Risks / Sharp Edges

* IPC changes require four-way sync: `types.ts`, `validation.ts`, `main.ts`, `preload.ts`.
* `WorkspaceShell.tsx` is a large coordinator/hotspot; unrelated changes can easily collide.
* Renderer must go through `src/lib/api.ts`; no direct Node/Electron access.
* Local extension code must run only in sandboxed iframes, never dynamic imports into renderer.
* Terminal snapshot/replay logic is geometry-sensitive; changes in `TerminalPanel`/`terminalManager` need terminal restore checks.
* Headless terminal output is cleaned in both main and renderer paths; keep behavior aligned if changing output filtering.
* `themeSupport.ts` maps external VS Code theme shapes to CSS/Monaco; regression risk across UI and editor themes.
* `electron/validation.ts`, file operations, git discard, terminal attachments, and browser bridge are security/user-data-sensitive.
* Packaging is Windows x64 tuned; node-pty unpack/exclusion rules in `package.json` matter for packaged app size and runtime.
* `WorkspaceCommand` in `types.ts` is marked deprecated; prefer `PaletteCommand`/automation config.
* Packaging scripts reference missing `clean:dist`; confirm before relying on `build:app`/installer scripts.

## Mapping Notes

* Date updated: 2026-06-13.
* Completeness: partial but practical; focused on architecture, entry points, services, extension system, and build/test paths.
* Inspected: repo tree, `AGENT.md`, `README.md`, package/config files, docs, key maps for Electron main/preload, workspace shell, terminal manager, stores, and shared types.
* Not deeply inspected: detailed CSS, all renderer component internals, full IPC handler bodies, all extension UI components, runtime userData schemas on disk.
* Assumptions: project remains Windows-first; Electron userData paths are runtime-only; `dist`, `dist-electron`, and `release` are generated even if absent/present locally.
