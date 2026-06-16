# StackDock Security Model

StackDock is a local desktop developer tool. It intentionally integrates with powerful local capabilities, so its main security boundary is user trust in a workspace, command, web page, or extension.

## Local capabilities

StackDock can:

- read, write, create, rename, and delete files through Electron IPC;
- spawn interactive or headless terminals through `node-pty`;
- run configured terminal startup commands and palette automation;
- run git commands, including destructive local changes and remote push/pull/fetch;
- render web content in Electron webviews;
- serve local extension assets and host extension UI in sandboxed iframes.

## Workspace trust

Newly added external workspace folders are marked untrusted. Workspaces created from inside StackDock and previously saved workspaces are trusted. In untrusted workspaces, StackDock blocks high-risk actions such as terminal creation, command automation, startup commands, and git mutations until the user clicks **Trust workspace**.

Trust a workspace only when you trust the folder contents and the commands/extensions you plan to run there.

## IPC boundary

Renderer code must use the typed `window.stackdock` preload bridge. Main-process handlers validate IPC arguments before touching filesystem, terminal, git, or persistence services.

Known limitation: many filesystem APIs currently accept absolute paths. Public hardening work should continue moving these operations toward active-workspace-root validation and explicit trusted external paths.

## Terminals and automation

Terminals run with the user's local account permissions. Treat startup commands, profile startup commands, automation commands, and enabled terminal command hooks like shell scripts from the workspace owner. Enabled terminal command hooks can mutate submitted commands before execution.

## Git operations

Git actions can alter local worktrees, commits, branches, and remotes. Destructive actions should clearly identify their target and ask for confirmation where practical.

## Webviews and browser capture

Web tabs can load local development pages or external URLs. Webview navigation, new-window, and external-open behavior should remain explicit and reviewed because web content is less trusted than StackDock UI.

## Extensions

Local extension package JavaScript runs in sandboxed iframes served by the `stackdock-extension://` protocol. Extension code must not be dynamically imported into the main renderer. Extensions communicate with StackDock through documented bridge messages.

Local declarative terminal command hooks require the `terminal-command-hook` capability. Only enable local packages with this capability from trusted folders. Review hook `match` and `appendArgs` values before enabling them because they can alter terminal commands.

Current extension hardening priorities:

- show declared capabilities before enabling local packages;
- validate extension asset paths and bridge payloads;
- document extension permissions and examples.
