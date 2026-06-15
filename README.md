# StackDock

StackDock is a Windows-first Electron desktop workbench for local development. It brings project workspaces, terminals, git status/actions, Monaco file editing, web tabs, command automation, theming, and local/bundled extensions into one lightweight app.

> Status: pre-1.0. The project is usable for local development, but public APIs and extension contracts may change.

## Features

- Workspace dashboard for opening, creating, pinning, and searching projects.
- Integrated `node-pty` terminals with restore snapshots and configurable profiles.
- Git source-control panel for status, diffs, staging, commits, branch switching, fetch/pull/push, and discard flows.
- Monaco editor tabs for quick file edits and previews.
- In-app web tabs and captured browser opens for local tooling flows.
- Command palette and per-workspace automation commands.
- Built-in extension host plus sandboxed local extension iframes.
- Unified VS Code color-theme import for app, editor, and terminal styling.

## Screenshots

Screenshots/GIFs are not checked in yet. Before a broader release, add:

- dashboard overview;
- workspace with terminal/editor/git panels;
- settings and extension configuration;
- theme import example.

## Supported platform

StackDock is currently developed and packaged for **Windows x64**. macOS and Linux are not supported release targets yet.

## Prerequisites

- Node.js 22 or newer recommended.
- npm (from Node.js).
- Git, if you want source-control features.
- Windows terminal shells you configure in Settings, such as PowerShell, Command Prompt, Git Bash, or WSL.

## Development

```bash
npm ci
npm run dev
```

`npm run dev` builds the app and launches Electron against the built renderer.

Useful checks:

```bash
npm run typecheck
npm test
npm run build:force
```

## Packaging

Windows package scripts:

```bash
npm run build:app          # portable Windows x64 build
npm run build:installer    # NSIS installer
npm run build:web-installer
```

Artifacts are written to `release/`. See `docs/releases.md` for the release checklist.

## Extensions

StackDock extensions can contribute activity/sidebar views, session rail views, bottom-bar views, status-bar items, and settings fields.

- Local extension docs: `docs/extensions.md`
- Built-in extension folder format: `docs/extension-folder-format.md`

Local package JavaScript runs in sandboxed iframes served by StackDock and communicates with the host through typed `postMessage` bridge messages.

## Security and trust

StackDock is a powerful local tool. It can read/write/delete files, spawn shells, run configured commands, perform git mutations, load web content, and host local extensions. Only open workspaces and install extensions you trust.

Read the full model and current limitations in `docs/security-model.md`. Vulnerability reporting guidance is in `SECURITY.md`.

## Contributing

See `CONTRIBUTING.md` for setup, architecture rules, testing expectations, and PR guidance.

## License

StackDock is released under the MIT License. See `LICENSE`.

## Credits

Default theme: [Catppuccin Noctis](https://github.com/alexdauenhauer/catppuccin-noctis) by alexdauenhauer, used under the MIT License. The bundled license is in `third-party/catppuccin-noctis/LICENSE.md`.
