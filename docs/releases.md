# Release Checklist

StackDock is Windows-first. Run release verification on a clean Windows x64 checkout.

## Clean build

```bash
git clean -xfd
npm ci
npm run typecheck
npm test
npm run build:force
```

## Package

Portable app:

```bash
npm run build:app
```

Installer:

```bash
npm run build:installer
```

Web installer:

```bash
npm run build:web-installer
```

Artifacts are written to `release/`.

## Smoke test packaged app

1. Launch the packaged app from `release/`.
2. Open or add a workspace.
3. Create a terminal with the default profile.
4. Run a simple command such as `node --version` or `git --version`.
5. Open, edit, save, and reopen a small text file.
6. Open the git panel in a repository workspace and refresh status.
7. Open a web tab and close it.
8. Open Settings and verify theme/terminal/extension tabs render.
9. Quit and relaunch; verify workspace/session restore behavior is reasonable.

## Safety checks

- Confirm destructive file and git actions clearly identify their targets.
- Confirm local extensions are loaded only from explicitly added package folders.
- Confirm webview new-window/external-link behavior matches `docs/security-model.md`.
- Confirm no generated artifacts are committed.

## Release notes

Mention:

- commit SHA;
- supported Windows version/architecture;
- known limitations;
- any migration or trust/security behavior changes;
- checksum/signing status for distributed binaries.
