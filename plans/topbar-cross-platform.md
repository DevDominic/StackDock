# Plan: Cross-platform topbar/window controls

## Context
- StackDock is an Electron + React app. The topbar/window controls are currently Windows-first.
- `electron/main.ts` decides whether to use native controls with `const nativeWindowControls = isWindows11()`; Windows 11 uses `titleBarStyle: 'hidden'` + `titleBarOverlay`, every other platform uses `{ frame: false }`.
- `electron/preload.ts` duplicates `isWindows11()`, sets `document.documentElement.dataset.windowControls` to `native` or `custom`, and exposes `api.app.windowControlsStyle()`.
- `src/components/TitleBar.tsx` exports `WindowControls`, which always renders custom controls in Windows/Linux order: minimize, maximize/restore, close.
- `src/components/workspace/WorkspaceShell.tsx` imports `WindowControls` and renders it at the far right of the workspace topbar.
- `src/styles.css` positions `.window-controls` on the right and hides them only for `html[data-window-controls="native"]`. macOS currently gets custom right-side controls, which conflicts with the expected macOS left-side traffic-light layout.

## Approach
- Add a small shared platform/window-controls helper so Electron main, preload, renderer, and tests use one source of truth.
- Preserve the existing Windows 11 native overlay behavior.
- Keep custom controls for non-native modes, but make their position/appearance platform-aware:
  - macOS: left side, close/minimize/zoom order, traffic-light styling.
  - Windows: right side; Windows 11 remains native overlay, older Windows keeps custom controls.
  - Linux: right side custom controls by default, matching the current app and common Linux window-manager default.
- Use `html` data attributes from preload for CSS and initial render so layout is correct before React finishes mounting.
- Avoid changing packaging targets, app menus, terminal behavior, workspace state, or theme semantics beyond titlebar layout variables.

## Files
- `src/shared/types.ts`
  - Add `WindowPlatform`, `WindowControlsPosition`, and `WindowControlsConfig` types.
  - Add `windowControlsConfig(): Promise<WindowControlsConfig>` to `StackDockApi.app` while keeping `windowControlsStyle()` for compatibility.
- `src/shared/windowControls.ts` (new)
  - Add pure helpers for platform normalization and control-layout selection.
- `electron/main.ts`
  - Replace local `isWindows11()` / `windowControlsStyle()` decision logic with the shared helper.
  - Add an IPC handler for `app:windowControlsConfig`.
- `electron/preload.ts`
  - Replace duplicate platform logic with the shared helper.
  - Set new root data attributes: `data-window-platform`, `data-window-controls`, and `data-window-controls-position`.
  - Expose `windowControlsConfig()` through the bridge.
- `src/components/TitleBar.tsx`
  - Make `WindowControls` read the platform/layout config and render macOS vs Windows/Linux ordering/classes.
  - Keep the same minimize/maximize/close API calls.
- `src/components/workspace/WorkspaceShell.tsx`
  - Keep reusing `WindowControls`, but adjust markup only if needed to avoid a stray divider or overlap when controls are left-positioned.
- `src/styles.css`
  - Add platform/position selectors for macOS left controls, traffic-light visuals, drag-region spacing, and workspace topbar padding.
  - Preserve existing native Windows 11 overlay selectors.
- `tests/windowControls.test.ts` (new)
  - Add unit coverage for the pure shared helper.

## Reuse
- Reuse existing bridge methods: `api.app.minimizeWindow()`, `api.app.toggleMaximizeWindow()`, `api.app.closeWindow()`, and `api.app.isWindowMaximized()`.
- Reuse existing CSS hooks: `html[data-window-controls="native"]`, `.window-controls`, `.window-control`, `.window-titlebar`, `.workspace-titlebar`, `.topbar-left`, `.topbar-right`.
- Reuse existing theme variables: `--titlebar-bg`, `--titlebar-fg`, `--titlebar-inactive-fg`, `--hover`, and `--border`.
- Reuse existing validation commands: `npm run typecheck`, `npm test`, and `npm run build`.

## Assumptions
- macOS should show controls on the left; Windows and Linux should show controls on the right.
- Linux should keep custom app-rendered controls because native titlebar button placement varies by desktop environment and StackDock already uses a custom frameless window outside Windows 11.
- Windows 11 native overlay behavior should remain unchanged because it already integrates with Windows window controls and is hidden from React via `data-window-controls="native"`.
- The maximize action on macOS can use the existing `toggleMaximizeWindow()` IPC path and label it as Zoom/Restore visually if desired; no separate fullscreen behavior is required for this task.

## Steps
1. Create `src/shared/windowControls.ts`.
   - Add `normalizeWindowPlatform(platform: string): WindowPlatform` returning `windows` for `win32`, `macos` for `darwin`, `linux` for `linux`, otherwise `other`.
   - Add `isWindows11OrNewer(platform: string, release: string): boolean` using the current build-number logic from `electron/main.ts` / `electron/preload.ts`.
   - Add `getWindowControlsConfig(platform: string, release: string): WindowControlsConfig` returning:
     - Windows 11+: `{ platform: 'windows', style: 'native', position: 'right', variant: 'windows' }`.
     - macOS: `{ platform: 'macos', style: 'custom', position: 'left', variant: 'macos' }`.
     - Linux: `{ platform: 'linux', style: 'custom', position: 'right', variant: 'windows' }`.
     - Other: `{ platform: 'other', style: 'custom', position: 'right', variant: 'windows' }`.
   - Expected result: platform behavior is centralized and testable without Electron.
2. Update `src/shared/types.ts`.
   - Extend `WindowControlsStyle` only if needed; keep current `native | custom` values.
   - Add `WindowPlatform`, `WindowControlsPosition`, `WindowControlsVariant`, and `WindowControlsConfig` exports matching the helper.
   - Add `windowControlsConfig(): Promise<WindowControlsConfig>` to `StackDockApi.app`.
   - Expected result: TypeScript consumers can use strongly typed platform/control metadata.
3. Update `electron/main.ts`.
   - Import `getWindowControlsConfig` from `../src/shared/windowControls`.
   - Replace `const nativeWindowControls = isWindows11();` with `const windowControlsConfig = getWindowControlsConfig(process.platform, os.release());` and `const nativeWindowControls = windowControlsConfig.style === 'native';`.
   - Remove or stop using the local `isWindows11()` and `windowControlsStyle()` helpers.
   - Keep the existing `BrowserWindow` options: native uses `titleBarStyle: 'hidden'` + `titleBarOverlay`; custom uses `{ frame: false }`.
   - Update `ipcMain.handle('app:windowControlsStyle')` to return `windowControlsConfig.style`.
   - Add `ipcMain.handle('app:windowControlsConfig')` returning `windowControlsConfig`.
   - Expected result: main process and renderer agree about style/position/platform.
4. Update `electron/preload.ts`.
   - Import `getWindowControlsConfig` and compute `const controlsConfig = getWindowControlsConfig(process.platform, os.release());`.
   - Replace `controlsStyle` with `controlsConfig.style`.
   - In `applyWindowControlsStyle()`, set:
     - `document.documentElement.dataset.windowControls = controlsConfig.style`
     - `document.documentElement.dataset.windowPlatform = controlsConfig.platform`
     - `document.documentElement.dataset.windowControlsPosition = controlsConfig.position`
   - Keep `windowControlsStyle: () => Promise.resolve(controlsConfig.style)`.
   - Add `windowControlsConfig: () => Promise.resolve(controlsConfig)`.
   - Expected result: CSS can place controls correctly before React renders.
5. Update `src/components/TitleBar.tsx`.
   - Add a small local function or hook to read `document.documentElement.dataset.windowPlatform` / `data-window-controls-position`, defaulting to `windows` / `right` for safety.
   - In `WindowControls`, derive `isMac = platform === 'macos'`.
   - For macOS custom controls, render button order: close, minimize, maximize/restore; add classes such as `window-controls macos` and per-button classes `close`, `minimize`, `maximize`.
   - For Windows/Linux custom controls, preserve current order: minimize, maximize/restore, close; add `window-controls windows` or `window-controls linux` class if useful.
   - Keep all existing click handlers and `aria-label`/`title` behavior, changing macOS maximize title to `Zoom`/`Restore` only if the UI copy needs it.
   - Expected result: one reusable `WindowControls` component supports dashboard and workspace topbars.
6. Update `src/components/workspace/WorkspaceShell.tsx` only if CSS alone cannot handle the left-positioned controls.
   - Prefer keeping the existing `<WindowControls />` reuse.
   - If the divider before controls remains visible on the right for macOS, add a class or wrapper to the divider, e.g. `topbar-window-divider`, so CSS can hide it when `data-window-controls-position="left"`.
   - Do not duplicate platform logic in `WorkspaceShell`.
   - Expected result: macOS controls appear left without leaving an orphan divider at the right edge.
7. Update `src/styles.css` for the normal dashboard titlebar.
   - Keep current right-side custom control styles as the Windows/Linux default.
   - Add selectors for `html[data-window-controls-position="left"]`:
     - Position `.window-controls` on the left with `margin-left: 0; margin-right: auto;`.
     - Add left padding to `.window-titlebar-drag` so the brand/title do not overlap controls.
     - Move `.window-titlebar-brand` rightward or hide it on macOS if it competes with traffic lights.
   - Add macOS traffic-light styling under `html[data-window-platform="macos"] .window-control` using circular buttons and close/minimize/maximize colors.
   - Preserve `html[data-window-controls="native"] .window-controls { display: none; }`.
   - Expected result: dashboard titlebar has correct drag area and visible controls on all platforms.
8. Update `src/styles.css` for the workspace topbar.
   - Add `html[data-window-controls-position="left"] .compact-topbar` left padding/reserved space so left controls do not overlap Home/Explorer buttons.
   - Add `html[data-window-controls-position="left"] .workspace-titlebar .window-controls` positioning so controls sit at the far left and stay `-webkit-app-region: no-drag`.
   - Add `html[data-window-controls-position="left"] .topbar-right > .topbar-divider` or the new divider class from Step 6 to hide the right-side divider if necessary.
   - Keep `html[data-window-controls="native"] .topbar-right { padding-right: 138px; }` behavior for Windows 11 native controls.
   - Expected result: workspace titlebar remains draggable, buttons remain clickable, and content does not sit under OS controls.
9. Add `tests/windowControls.test.ts`.
   - Test `normalizeWindowPlatform('win32')`, `('darwin')`, `('linux')`, and an unknown string.
   - Test `getWindowControlsConfig('win32', '10.0.22631')` returns native/right/windows.
   - Test `getWindowControlsConfig('win32', '10.0.19045')` returns custom/right/windows.
   - Test `getWindowControlsConfig('darwin', '23.0.0')` returns custom/left/macos.
   - Test `getWindowControlsConfig('linux', '6.8.0')` returns custom/right/linux.
   - Expected result: cross-platform decisions are guarded by fast unit tests in the existing Node Vitest setup.
10. Run validation and fix only issues caused by these changes.
    - Run `npm run typecheck`.
    - Run `npm test -- windowControls` for the new helper test.
    - Run `npm test` if the focused test passes.
    - Run `npm run build` to verify Electron + Vite compile.
    - Expected result: all commands exit 0.

## Verification
- Automated checks:
  - `npm run typecheck` exits 0.
  - `npm test -- windowControls` exits 0 and covers Windows 11, older Windows, macOS, Linux, and unknown platform decisions.
  - `npm test` exits 0.
  - `npm run build` exits 0.
- Manual Windows checks:
  - On Windows 11, launch with `npm run dev`; verify native Windows controls appear on the right and custom `.window-controls` are hidden.
  - On Windows 10 or by temporarily testing helper output only, verify custom controls remain right-side and still minimize/maximize/close.
- Manual macOS checks:
  - Launch with `npm run dev`; verify controls are on the left in close/minimize/zoom order.
  - Verify the dashboard titlebar and workspace topbar are draggable except over buttons.
  - Verify Home/Explorer/Git/Settings/Open Folder buttons do not overlap the traffic lights.
- Manual Linux checks:
  - Launch with `npm run dev`; verify custom controls are on the right and the window remains draggable.
  - Verify minimize/maximize/close still call the existing IPC handlers.
- Theme checks:
  - Switch between light/dark or available themes; verify titlebar colors still follow `--titlebar-bg` and `--titlebar-fg` and Windows 11 overlay still updates through `setTitleBarOverlay()`.

## Risks
- macOS users may expect native traffic lights rather than custom-drawn controls. This plan prioritizes minimal risk by keeping the current frameless custom-window approach and only moving/restyling the custom controls.
- Linux window-control placement can vary by desktop environment. This plan chooses right-side controls as the default to match current StackDock behavior and common Linux defaults.
- Drag regions can accidentally cover buttons if spacing is wrong. Mitigation: keep `.window-controls` and topbar buttons under `-webkit-app-region: no-drag`, then manually verify click/drag behavior on each OS.
- Windows 11 native overlay may regress if the shared helper changes build-number detection. Mitigation: preserve the exact current release-build check and cover it with unit tests.
- Rollback: revert the helper/types/preload/main/component/CSS/test changes together; the previous behavior is localized to `isWindows11()`, `data-window-controls`, `WindowControls`, and `.window-controls` CSS.