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

## Bridge

Iframe code communicates with the host using `postMessage` typed messages:

- `stackdock.ready`
- `stackdock.getContext`
- `stackdock.openFile`
- `stackdock.openTerminalHere`
- `stackdock.refreshGit`
- `stackdock.revealFolder`

The host replies with `stackdock.response` and either a payload or an error string.
