# PLAN.md — StackDock

## 1. Product Goal

Build **StackDock**, a lightweight Windows-first terminal workspace manager for developers who want:

- One app per project/workspace.
- Multiple terminals open at once.
- Easy launching of CLI agents/tools such as `pi`, `claude`, `npm`, `cargo`, `git`, etc.
- Git status and diffs visible without switching apps.
- A basic text editor for quick file edits.
- Minimal configuration.
- No AI-first clutter, marketplace bloat, or complex cloud/workspace system.

The app should feel closer to **Windows Terminal + VS Code Source Control + a basic editor**, but simpler.

---

## 2. Core Principles

### 2.1 Simplicity First

The app should not require users to learn a complex configuration system.

Avoid:

- Large settings panels.
- Required accounts.
- Cloud sync as a core feature.
- Complex plugin systems in v1.
- Command palettes overloaded with features.
- Deep IDE-style project indexing.

Prefer:

- Local JSON config.
- Obvious buttons.
- Project cards.
- Right-click actions.
- Keyboard shortcuts.
- Sensible defaults.

### 2.2 Workspace-Centric

Everything starts from a workspace.

A workspace represents:

- A project folder.
- A saved layout.
- A set of terminal tabs/panes.
- Optional startup commands.
- Git repository state.
- Editor state.

Example workspace:

```json
{
  "name": "FunkyExperiments",
  "path": "C:/Users/domin/Documents/Programming/Lyte/FunkyExperiments",
  "terminals": [
    {
      "name": "pi",
      "command": "pi",
      "cwd": "${workspaceRoot}"
    },
    {
      "name": "dev",
      "command": "npm run dev",
      "cwd": "${workspaceRoot}"
    }
  ]
}
```

### 2.3 Local-Only by Default

Everything should work locally with no login.

Store user data in:

```text
%APPDATA%/StackDock/
```

Suggested files:

```text
%APPDATA%/StackDock/config.json
%APPDATA%/StackDock/workspaces.json
%APPDATA%/StackDock/layouts/
%APPDATA%/StackDock/logs/
```

---

## 3. Recommended Tech Stack

Use **Electron** as the committed app framework.

Stack:

- **Electron**
- **React**
- **TypeScript**
- **Vite**
- **node-pty**
- **xterm.js**
- **Monaco Editor**
- **Git CLI integration first**
- **Zustand** for state management
- **react-resizable-panels** for layout

Why Electron:

- Fastest path to a working prototype.
- `node-pty` is mature and commonly used for terminal apps.
- Easier terminal process management than a Rust/Tauri setup.
- Better examples and ecosystem for terminal-based desktop apps.
- Allows direct Node.js access in the main process for:
  - PTY sessions
  - file system operations
  - Git commands
  - workspace config storage
  - shell/profile detection

Tradeoffs:

- Larger app size than Tauri.
- Higher memory usage than Tauri.
- Needs careful security boundaries between renderer and main process.

Decision:

- **Do not use Tauri.**
- Build v1 with **Electron + React + TypeScript + node-pty + xterm.js + Monaco**.
- Keep the app local-first and simple.

## 4. Main Features

## 4.1 Workspace Dashboard

The first screen should show project workspaces.

Each workspace card should show:

- Project name.
- Folder path.
- Git branch.
- Dirty file count.
- Last opened date.
- Quick buttons:
  - Open
  - Open folder
  - Edit workspace
  - Delete from app

Actions:

- Add existing folder as workspace.
- Create new workspace.
- Duplicate workspace.
- Pin workspace.
- Search workspaces.

MVP behavior:

- User clicks **Add Workspace**.
- Picks a folder.
- App detects:
  - Folder name.
  - Whether it is a Git repo.
  - Current branch.
- App saves it to `workspaces.json`.

---

## 4.2 Workspace Window Layout

When a workspace opens, layout should be simple:

```text
┌────────────────────────────────────────────────────────────┐
│ Top Bar: Workspace Name | Branch | Dirty Count | Actions   │
├───────────────┬───────────────────────────────┬────────────┤
│ File Tree     │ Editor / Diff Area            │ Git Panel  │
│               │                               │            │
├───────────────┴───────────────────────────────┴────────────┤
│ Terminal Area: Tabs / Splits                               │
└────────────────────────────────────────────────────────────┘
```

Default layout:

- Left: file tree.
- Center: editor/diff viewer.
- Right: Git panel.
- Bottom: terminal area.

All panels should be collapsible.

Keyboard shortcuts:

```text
Ctrl+`       Toggle terminal
Ctrl+B       Toggle sidebar
Ctrl+Shift+G Toggle Git panel
Ctrl+P       Quick file open
Ctrl+Shift+P Command actions
Ctrl+Shift+T New terminal
Ctrl+W       Close focused tab/pane
```

---

## 4.3 Terminal System

The terminal system is the core feature.

Requirements:

- Multiple terminal tabs.
- Split terminal panes.
- Rename terminal tab.
- Restart terminal.
- Kill terminal.
- Duplicate terminal.
- Set terminal working directory.
- Run startup command.
- Support PowerShell, CMD, Git Bash, WSL.

Terminal profiles:

```json
{
  "profiles": [
    {
      "name": "PowerShell",
      "shell": "powershell.exe",
      "args": []
    },
    {
      "name": "Command Prompt",
      "shell": "cmd.exe",
      "args": []
    },
    {
      "name": "Git Bash",
      "shell": "C:/Program Files/Git/bin/bash.exe",
      "args": ["--login"]
    },
    {
      "name": "WSL",
      "shell": "wsl.exe",
      "args": []
    }
  ]
}
```

Terminal tab object:

```json
{
  "id": "terminal_001",
  "name": "pi",
  "profile": "PowerShell",
  "cwd": "${workspaceRoot}",
  "startupCommand": "pi",
  "autoStart": true
}
```

MVP terminal features:

- New terminal.
- Close terminal.
- Rename terminal.
- Run command on open.
- Persist terminal names and layout.
- Do not persist terminal scrollback in v1.

Advanced later:

- Persist terminal scrollback.
- Terminal search.
- Terminal broadcast input.
- Terminal task runner.
- Terminal snapshots.

---

## 4.4 Workspace Startup Commands

Each workspace should allow saved commands.

Example:

```json
{
  "startupCommands": [
    {
      "name": "PI",
      "command": "pi",
      "terminalName": "pi",
      "autoStart": false
    },
    {
      "name": "Claude",
      "command": "claude",
      "terminalName": "claude",
      "autoStart": false
    },
    {
      "name": "Dev Server",
      "command": "npm run dev",
      "terminalName": "dev",
      "autoStart": true
    }
  ]
}
```

UI:

- Button row: `+ Terminal`, `Run PI`, `Run Claude`, `Run Dev`.
- Startup commands can be toggled on/off.
- Auto-start commands run when workspace opens.

Keep this simple. Do not build a full task system in v1.

---

## 4.5 Git Integration

Use the Git CLI first.

Required commands:

```bash
git status --porcelain=v1 -b
git diff
git diff --staged
git branch --show-current
git log --oneline -n 20
git add <file>
git restore <file>
git restore --staged <file>
git commit -m "<message>"
```

Git panel should show:

- Current branch.
- Changed files.
- Staged files.
- Untracked files.
- Commit message box.
- Buttons:
  - Stage
  - Unstage
  - Discard
  - Commit
  - Refresh

File states:

```text
M  Modified
A  Added
D  Deleted
R  Renamed
?? Untracked
```

Clicking a changed file opens a diff.

Diff viewer:

- Side-by-side diff.
- Inline diff later.
- Show staged/unstaged toggle.
- Basic syntax highlighting if available.

MVP Git features:

- Detect repo.
- Show branch.
- Show changed files.
- Open file diff.
- Stage/unstage file.
- Commit.
- Refresh.

Later Git features:

- Branch switcher.
- Pull/push.
- Merge conflict UI.
- Stash support.
- Commit history viewer.
- Git graph.

---

## 4.6 Basic Text Editor

The editor should not try to replace VS Code in v1.

Required:

- Open files from file tree.
- Edit text files.
- Save file.
- Unsaved indicator.
- Basic syntax highlighting through Monaco.
- Find in file.
- Multiple editor tabs.
- Close editor tab.

Nice-to-have:

- Format document.
- Go to line.
- Minimap toggle.
- Basic JSON validation.
- Basic Lua syntax support.
- Basic TypeScript/JavaScript support.

Do not build:

- Language servers in v1.
- Debugger.
- Refactor tools.
- Extension marketplace.
- Full IntelliSense system.

---

## 4.7 File Tree

Required:

- Show workspace files.
- Collapse folders.
- Open file.
- Create file.
- Create folder.
- Rename.
- Delete.
- Reveal in Explorer.
- Open terminal here.

Respect `.gitignore` if possible.

Default hidden folders:

```text
.git
node_modules
dist
build
target
.cache
.vscode
```

Allow user to toggle hidden files.

---

## 4.8 Command Launcher

Add a small command launcher, but keep it simple.

Shortcut:

```text
Ctrl+Shift+P
```

Commands:

```text
New Terminal
Run PI
Run Claude
Open Git Panel
Open File
Reload Workspace
Open Settings
Open Workspace Config
Toggle File Tree
Toggle Git Panel
Toggle Terminal
```

Do not make this the main UX. The app should be usable with visible buttons.

---

## 4.9 Layout Persistence

Each workspace should remember:

- Open editor tabs.
- Active editor tab.
- Terminal tabs.
- Terminal names.
- Terminal split layout.
- Panel sizes.
- Sidebar collapsed/expanded.
- Git panel collapsed/expanded.

Do not persist:

- Running process state.
- Terminal scrollback.
- Unsaved files unless autosave is implemented.

Layout file:

```text
%APPDATA%/StackDock/layouts/<workspace-id>.json
```

Example:

```json
{
  "workspaceId": "funkyexperiments",
  "panels": {
    "fileTreeWidth": 280,
    "gitPanelWidth": 320,
    "terminalHeight": 300,
    "fileTreeVisible": true,
    "gitPanelVisible": true,
    "terminalVisible": true
  },
  "editors": {
    "openFiles": [
      "src/main.lua",
      "README.md"
    ],
    "activeFile": "src/main.lua"
  },
  "terminals": [
    {
      "name": "pi",
      "profile": "PowerShell",
      "cwd": "${workspaceRoot}",
      "startupCommand": "pi"
    }
  ]
}
```

---

## 5. Non-Goals for v1

Do not build these in v1:

- Cloud workspaces.
- SSH workspace management.
- Docker UI.
- Extension/plugin marketplace.
- Full IDE language server support.
- AI chat sidebar.
- Project templates.
- Remote pair programming.
- Account login.
- Theme marketplace.
- Deep GitHub integration.
- Pull request review UI.
- Background daemon.

The app should stay focused.

---

## 6. MVP Scope

The MVP should include only the features needed to replace the current workflow.

## MVP Feature List

### Workspace Management

- Add workspace from folder.
- Open workspace.
- Remove workspace from app.
- Save workspace list.
- Show Git branch and dirty count on dashboard.

### Terminal

- Open terminal in workspace root.
- Multiple terminal tabs.
- Rename terminal.
- Close terminal.
- Run saved command in a new terminal.
- Profiles for PowerShell, CMD, Git Bash, and WSL.

### Git

- Show branch.
- Show changed files.
- Open diff for changed file.
- Stage/unstage.
- Commit.

### Editor

- File tree.
- Open file.
- Edit file.
- Save file.
- Multiple editor tabs.

### Layout

- Remember panel sizes.
- Remember open terminals.
- Remember editor tabs.

---

## 7. Suggested UI Flow

## 7.1 First Launch

Show empty dashboard:

```text
No workspaces yet.

[Add Workspace]
```

User picks folder.

App creates workspace:

```json
{
  "id": "funkyexperiments",
  "name": "FunkyExperiments",
  "path": "C:/Users/domin/Documents/Programming/Lyte/FunkyExperiments",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "lastOpenedAt": null
}
```

## 7.2 Opening Workspace

App opens main layout.

It should:

1. Load file tree.
2. Detect Git repo.
3. Load saved layout.
4. Create default terminal if no saved terminal exists.
5. Refresh Git status.

Default terminal:

```text
PowerShell at workspace root
```

## 7.3 Adding CLI Tool Commands

In workspace settings:

```text
Saved Commands

[+] Add Command

Name: PI
Command: pi
Open in: New terminal
Auto-start: No
```

Then main workspace top bar shows:

```text
[+ Terminal] [PI] [Claude] [Dev]
```

Clicking `PI` opens a terminal named `PI` and runs:

```bash
pi
```

---

## 8. Architecture

## 8.1 Frontend Modules

```text
src/
  app/
    App.tsx
    routes.tsx

  state/
    workspaceStore.ts
    terminalStore.ts
    gitStore.ts
    editorStore.ts
    layoutStore.ts

  components/
    dashboard/
      WorkspaceDashboard.tsx
      WorkspaceCard.tsx
      AddWorkspaceButton.tsx

    workspace/
      WorkspaceShell.tsx
      TopBar.tsx
      PanelLayout.tsx

    terminal/
      TerminalPanel.tsx
      TerminalTabBar.tsx
      TerminalView.tsx
      NewTerminalButton.tsx

    git/
      GitPanel.tsx
      GitFileList.tsx
      GitDiffView.tsx
      CommitBox.tsx

    editor/
      EditorTabs.tsx
      MonacoEditorView.tsx
      FileTree.tsx

    command/
      CommandLauncher.tsx

  lib/
    paths.ts
    workspace.ts
    git.ts
    config.ts
```

## 8.2 Backend Commands

Electron main/preload should expose safe IPC commands like:

```ts
// Workspace
listWorkspaces()
addWorkspace(path: string)
removeWorkspace(id: string)
openWorkspace(id: string)
saveWorkspaceConfig(workspace)

// File system
readDirectory(path: string)
readFile(path: string)
writeFile(path: string, content: string)
createFile(path: string)
createFolder(path: string)
renamePath(oldPath: string, newPath: string)
deletePath(path: string)
revealInExplorer(path: string)

// Terminal
createTerminal(profile, cwd)
writeToTerminal(id, data)
resizeTerminal(id, cols, rows)
killTerminal(id)

// Git
getGitStatus(path)
getGitDiff(path, file, staged)
stageFile(path, file)
unstageFile(path, file)
discardFile(path, file)
commit(path, message)
getCurrentBranch(path)
```

## 8.3 Terminal Backend

Use Electron's main process to own all terminal processes.

Terminal process lifecycle:

1. Renderer requests terminal creation through a safe preload IPC API.
2. Main process creates a `node-pty` process.
3. Main process streams terminal output to the renderer.
4. Renderer renders output in xterm.js.
5. Renderer sends keyboard input to the main process through IPC.
6. Main process writes input to the PTY.
7. On close, main process kills the PTY process.

Do not spawn shell processes directly from the renderer.

Terminal ID format:

```text
term_<uuid>
```

---

## 9. Data Models

## 9.1 Workspace

```ts
export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt?: string;
  pinned?: boolean;
  commands?: WorkspaceCommand[];
}
```

## 9.2 Workspace Command

```ts
export interface WorkspaceCommand {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  terminalName?: string;
  autoStart?: boolean;
}
```

## 9.3 Terminal Profile

```ts
export interface TerminalProfile {
  id: string;
  name: string;
  shell: string;
  args: string[];
}
```

## 9.4 Terminal Session

```ts
export interface TerminalSession {
  id: string;
  name: string;
  profileId: string;
  cwd: string;
  startupCommand?: string;
  createdAt: string;
}
```

## 9.5 Git Status

```ts
export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  files: GitFileStatus[];
}
```

## 9.6 Git File Status

```ts
export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}
```

---

## 10. Implementation Phases

## Phase 1 — App Shell

Goal:

Create a basic desktop app that opens and saves workspaces.

Tasks:

- Set up Electron + React + TypeScript + Vite.
- Add app shell.
- Add workspace dashboard.
- Add workspace storage in JSON.
- Add folder picker.
- Add workspace cards.
- Add open workspace view.
- Add basic panel layout.

Deliverable:

User can add a folder as a workspace and reopen it later.

---

## Phase 2 — Terminal MVP

Goal:

Add working terminal tabs.

Tasks:

- Install and configure `node-pty`.
- Install and render `xterm.js`.
- Create terminal backend process manager.
- Support PowerShell profile.
- Add new terminal button.
- Add terminal tabs.
- Add terminal close.
- Add terminal rename.
- Start terminal in workspace root.
- Resize PTY when terminal view resizes.

Deliverable:

User can open a project workspace and run commands in multiple terminal tabs.

---

## Phase 3 — Saved Commands

Goal:

Make it easy to run `pi`, `claude`, and project commands.

Tasks:

- Add workspace command model.
- Add workspace settings modal.
- Add command creation UI.
- Add quick command buttons.
- Run command in new terminal.
- Add optional auto-start.

Deliverable:

User can click `PI` or `Claude` and the app opens a terminal running that command.

---

## Phase 4 — File Tree and Editor

Goal:

Add basic file browsing and editing.

Tasks:

- Add file tree backend.
- Ignore noisy folders by default.
- Add Monaco Editor.
- Open files in editor tabs.
- Save file.
- Add dirty indicator.
- Add create/rename/delete file actions.
- Add right-click “Open terminal here”.

Deliverable:

User can browse and edit project files without leaving the app.

---

## Phase 5 — Git Status and Diff

Goal:

Add practical Git visibility.

Tasks:

- Implement `git status --porcelain=v1 -b`.
- Parse branch and file statuses.
- Show Git panel.
- Show changed files.
- Implement unstaged diff.
- Implement staged diff.
- Open diff in Monaco.
- Add refresh button.

Deliverable:

User can see what changed and inspect diffs.

---

## Phase 6 — Git Actions

Goal:

Allow basic source-control actions.

Tasks:

- Stage file.
- Unstage file.
- Discard file.
- Stage all.
- Commit with message.
- Show commit result/errors.
- Refresh after actions.

Deliverable:

User can do a simple Git workflow inside the app.

---

## Phase 7 — Layout Persistence

Goal:

Make workspaces reopen the same way.

Tasks:

- Save panel sizes.
- Save visible panels.
- Save open editor files.
- Save terminal tab definitions.
- Save active terminal.
- Restore workspace layout on open.

Deliverable:

User can reopen a workspace and continue from the same layout.

---

## Phase 8 — Polish

Goal:

Make the app feel clean and reliable.

Tasks:

- Add keyboard shortcuts.
- Add command launcher.
- Add settings page.
- Add terminal profile editor.
- Add error toasts.
- Add loading states.
- Add empty states.
- Add confirmation dialogs for destructive actions.
- Add basic theme toggle.

Deliverable:

App is usable daily.

---

## 11. Error Handling

Show readable errors.

Examples:

```text
Git is not installed or not available in PATH.
```

```text
This folder is not a Git repository.
```

```text
Could not start terminal profile: Git Bash.
Check that the shell path exists.
```

```text
Could not save file. It may be read-only or locked by another process.
```

Avoid raw stack traces in the UI.

Log detailed errors to:

```text
%APPDATA%/StackDock/logs/app.log
```

---

## 12. Settings

Global settings:

```json
{
  "theme": "system",
  "defaultTerminalProfile": "PowerShell",
  "confirmBeforeDiscard": true,
  "showHiddenFiles": false,
  "gitRefreshIntervalSeconds": 10,
  "editor": {
    "fontSize": 14,
    "fontFamily": "Consolas",
    "tabSize": 2,
    "wordWrap": "off"
  },
  "terminal": {
    "fontSize": 14,
    "fontFamily": "Cascadia Mono",
    "cursorBlink": true
  }
}
```

Keep settings page small.

Recommended initial settings sections:

- Appearance
- Terminal
- Git
- Editor
- Workspaces

---

## 13. Suggested First File Structure

```text
stackdock/
  package.json
  electron/
    main.ts
    preload.ts
    terminalManager.ts
    workspaceStore.ts
    gitService.ts
    fileService.ts
  src/
    App.tsx
    main.tsx
    styles.css
    components/
      dashboard/
      workspace/
      terminal/
      git/
      editor/
    state/
    types/
  data/
    defaultProfiles.json
```

---

## 14. Suggested Package Dependencies

For Electron prototype:

```bash
npm install @xterm/xterm @xterm/addon-fit monaco-editor zustand
npm install node-pty
npm install -D electron vite typescript @vitejs/plugin-react concurrently wait-on
```

Optional:

```bash
npm install react-resizable-panels
npm install lucide-react
```

Suggested scripts:

```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "tsc && vite build",
    "start": "electron ."
  }
}
```

---

## 15. Security Notes

Since the app runs shell commands, be careful.

Electron security defaults:

- Use `contextIsolation: true`.
- Use `nodeIntegration: false`.
- Use a preload script for controlled APIs.
- Do not expose raw `child_process`, `fs`, or shell execution to the renderer.
- Validate all IPC inputs in the main process.

Rules:

- Never run workspace commands automatically unless user enabled auto-start.
- Show the exact command before saving it.
- Do not execute commands from remote files automatically.
- Do not execute commands from package scripts automatically without user action.
- Treat workspace config as trusted only if the user created it locally.
- Confirm destructive Git actions.
- Confirm file deletes.

For v1, avoid loading arbitrary plugins.

---

## 16. V1 Acceptance Criteria

The app is successful when the user can:

1. Add a project folder as a workspace.
2. Open that workspace later from a dashboard.
3. Open multiple terminal tabs in the project folder.
4. Save quick commands like `pi` and `claude`.
5. Run those commands with one click.
6. See Git branch and changed files.
7. Click a changed file and see a diff.
8. Stage, unstage, and commit files.
9. Open and edit a basic text file.
10. Reopen the workspace and recover the same layout.

---

## 17. Initial Development Order

Build in this exact order:

1. Create Electron + React + TypeScript + Vite app.
2. Add workspace dashboard.
3. Add local workspace storage.
4. Add workspace detail screen.
5. Add xterm.js terminal rendering.
6. Add `node-pty` terminal backend.
7. Add multiple terminal tabs.
8. Add saved commands.
9. Add file tree.
10. Add Monaco editor.
11. Add Git status parsing.
12. Add Git diff viewer.
13. Add Git actions.
14. Add layout persistence.
15. Add settings.
16. Polish.

Do not start with theming, plugins, AI features, or deep config.

---

## 18. Project Name

The project name is:

```text
StackDock
```

Rationale:

- **Stack** represents the user's project stack: terminals, Git, editor, commands, and tools.
- **Dock** represents a workspace where project tools are parked and ready.
- The name is short, readable, and works well as a desktop developer tool.

Use **StackDock** consistently in:

- App title.
- Executable name.
- Installer name.
- Config folder.
- README.
- Package metadata.
- Window title.
- Workspace dashboard branding.

---

## 19. Future Features

Only consider these after v1 is stable:

- Workspace templates.
- Git branch graph.
- Pull/push.
- SSH workspaces.
- WSL folder detection.
- Docker compose panel.
- Script/task runner.
- Global search with ripgrep.
- File search.
- Basic language server support.
- Session restore with terminal scrollback.
- Workspace import/export.
- Portable mode.
- Optional cloud sync.

---

## 20. Summary

The app should be a simple local project workspace manager with:

- Terminal tabs and splits.
- Saved project commands.
- Git status/diffs.
- Lightweight file editing.
- Layout persistence.

The main goal is not to replace a full IDE.  
The goal is to make project-based CLI work less messy on Windows.
