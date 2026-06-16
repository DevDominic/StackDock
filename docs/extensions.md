# StackDock Extensions

StackDock extensions can contribute activity/sidebar views, the sessions rail, bottom-bar views, and status-bar items.

## Local package manifest

Create a directory with `stackdock.extension.json`:

```json
{
  "id": "example.notes",
  "name": "Notes",
  "version": "0.1.0",
  "defaultEnabled": false,
  "contributes": {
    "views": [
      { "id": "example.notes.view", "title": "Notes", "location": "activity", "entry": "index.html" }
    ]
  }
}
```

Local package JavaScript runs only in sandboxed iframes served by StackDock. It is never dynamically imported into the main renderer.

## Configuration
Extensions can declare Settings UI fields with `contributes.configuration`:
```json
{
  "contributes": {
    "configuration": {
      "title": "Notes settings",
      "fields": [
        { "key": "showArchived", "label": "Show archived notes", "type": "boolean", "default": false }
      ]
    }
  }
}
```
Configurable extensions show a **Configure** button in Settings > Extensions. Built-in native extensions may also provide a custom settings renderer.

## Terminal command hooks

Local extensions can declare append-only terminal command hooks. Hooks run after the user presses Enter and before the command is sent to PowerShell, CMD, bash, or another shell.

```json
{
  "id": "example.tool-hook",
  "name": "Tool Hook",
  "version": "0.1.0",
  "defaultEnabled": true,
  "capabilities": ["terminal-command-hook"],
  "contributes": {
    "terminalCommandHooks": [
      {
        "id": "append.workspace",
        "match": "^tool(?:\\s|$)",
        "sources": ["interactive"],
        "appendArgs": "--workspace ${name}"
      }
    ]
  }
}
```

Version 1 hooks can only append arguments to matched commands. `match` is a JavaScript `RegExp` source string without flags. Supported template variables in `appendArgs` are `${command}`, `${restoreId}`, `${cwd}`, and `${name}`. Hooks apply only while the extension is enabled.

## Bridge

Iframe code communicates with the host using `postMessage` typed messages:

- `stackdock.ready`
- `stackdock.getContext`
- `stackdock.openFile`
- `stackdock.openTerminalHere`
- `stackdock.refreshGit`
- `stackdock.revealFolder`

The host replies with `stackdock.response` and either a payload or an error string.

## Example

See `examples/extension-basic/` for a minimal local extension with a manifest, settings field, sandboxed iframe view, and `stackdock.getContext` bridge request.

## Security notes

Only add local extension packages from folders you trust. Extension UI runs in a sandboxed iframe, but it can still request host actions through the documented bridge. Future capability prompts should make these permissions more explicit.
