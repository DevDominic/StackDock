# Contributing to StackDock

Thanks for your interest in StackDock. This project is a Windows-first Electron desktop workbench for local development workspaces.

## Local setup

```bash
npm ci
npm run typecheck
npm test
npm run build:force
```

Use `npm run dev` to launch the built Electron app locally.

## Architecture rules

- Renderer code must access backend functionality only through `src/lib/api.ts` / `window.stackdock`.
- IPC contracts live in `src/shared/types.ts`; update `electron/main.ts`, `electron/preload.ts`, and `electron/validation.ts` together when changing an API.
- Main-process file, git, terminal, and persistence logic belongs under `electron/` or extension-owned `extensions/*/main` code.
- Prefer extension contributions for new workspace side/bottom/status UI instead of growing `WorkspaceShell.tsx`.
- Local extension JavaScript must run only in sandboxed iframes, never via dynamic import into the renderer.

## Pull requests

Before opening a PR, run:

```bash
npm run typecheck
npm test
```

For package-related changes, also run:

```bash
npm run build:force
npm run build:app
```

Do not commit generated outputs such as `dist/`, `dist-electron/`, `release/`, `node_modules/`, or `.buildstamp`.

## Tests

Add or update Vitest coverage for behavior changes, especially IPC validation, extension loading, terminal/session state, git parsing, and security-sensitive filesystem behavior.
