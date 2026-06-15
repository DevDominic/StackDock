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
