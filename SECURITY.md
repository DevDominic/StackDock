# Security Policy

## Supported versions

StackDock is pre-1.0. Security fixes target the current `main` branch unless release branches are announced later.

## Reporting a vulnerability

Please report suspected vulnerabilities privately by opening a GitHub security advisory or contacting the repository owner. Do not file public issues for vulnerabilities until a fix or mitigation is available.

## Local trust model

StackDock is a local developer tool. It can:

- read, write, rename, and delete local files selected through workspaces;
- spawn terminals and run configured startup or automation commands;
- run git operations that can modify local history or push/pull remote repositories;
- load web content in Electron webviews;
- load local extension packages in sandboxed iframes.

Only open workspaces, run commands, and install local extensions from sources you trust. See `docs/security-model.md` for the detailed model and current limitations.
