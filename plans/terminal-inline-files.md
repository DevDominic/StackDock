# Add inline files/images to active terminal chat

## Context
- StackDock terminals are rendered in `src/components/workspace/TerminalPanel.tsx` using `xterm` and send all typed data directly to the active pty via `api.terminal.write()`.
- Terminal sessions are managed by `src/state/sessionStore.ts` and created/wired through the Electron IPC chain (`src/shared/types.ts` → `electron/preload.ts` → `electron/main.ts` → `electron/terminalManager.ts`).
- The requested behavior is to let users paste or drag files/images into the active terminal and have StackDock pass attachment references/data to terminal CLIs such as Pi, Claude, and Codex, while keeping normal text paste unchanged.
- User requirements captured: support dragged files, pasted OS files, pasted clipboard images, and normal text paste; for large files, reference the source directory rather than trying to inline the full file.

## Approach
- Add a terminal attachment pipeline with two layers:
  1. **Capture** paste/drop sources in the focused `TerminalView` before xterm handles them.
  2. **Serialize** attachments into CLI-friendly text inserted into the terminal input via the existing `api.terminal.write()` path.
- Default first-version serialization should be cross-CLI and future-proof:
  - Insert path references instead of pressing Enter, so users can review/edit before sending.
  - Use absolute path tokens in a form commonly accepted by AI CLIs (`@/path/to/file` for files/images; quoted/escaped where needed).
  - For large files, insert the parent directory reference (`@/path/to/directory/`) per user preference.
  - For clipboard images with no existing path, save a PNG under StackDock's user data attachment directory and insert that saved path.
- Keep the serializer isolated in a renderer helper so future work can add a richer Warp-style prompt editor, previews, and per-CLI formatters (`auto`, `pi`, `claude`, `codex`, `generic`) without rewriting terminal event handling.
- Keep renderer Node-free by exposing only narrow Electron helpers through preload/main for file-path extraction, file metadata, and clipboard-image persistence.

## Files to modify
- `src/components/workspace/TerminalPanel.tsx`
  - Add paste/drop capture, drag-over state, and terminal write integration.
- `src/lib/terminalAttachments.ts` (new)
  - Normalize attachment descriptors, classify large/text/image/binary inputs, and format them into terminal text.
- `src/shared/types.ts`
  - Add attachment descriptor/settings/API types to `StackDockApi`.
- `electron/preload.ts`
  - Expose typed helper methods; likely includes `webUtils.getPathForFile(file)` for drag/paste file objects.
- `electron/main.ts`
  - Register attachment IPC handlers for stat/metadata and saving pasted clipboard/image blobs.
- `electron/validation.ts`
  - Validate attachment paths/options/byte limits.
- `electron/storage.ts` or a new `electron/attachmentService.ts`
  - Create/use a StackDock attachment cache directory for pasted images.
- `src/styles.css`
  - Add drag-over affordance on `.terminal-shell` / `.terminal-mount`.

## Reuse
- Existing terminal write pipeline: `api.terminal.write()` in `TerminalPanel.tsx`, `terminal:write` IPC in `electron/main.ts`, and `writeTerminal()` in `electron/terminalManager.ts`.
- Existing API contract pattern documented in `AGENT.md`: update `src/shared/types.ts`, `electron/preload.ts`, `electron/main.ts`, and `electron/validation.ts` together for any new IPC.
- Existing storage convention in `electron/storage.ts` for placing generated clipboard-image attachment files under StackDock app data.
- Existing theme/style variables in `src/styles.css` for drag-over borders/backgrounds.

## Steps
- [ ] Add shared types for `TerminalAttachment`, `TerminalAttachmentSource`, and attachment API helpers.
- [ ] Add an `attachmentService` in Electron to:
  - validate absolute paths,
  - stat/classify files and directories,
  - enforce small-file/large-file thresholds,
  - save pasted image blobs as PNG files in a StackDock attachment directory.
- [ ] Expose attachment helpers through `electron/preload.ts`, including safe path extraction for dropped/pasted `File` objects.
- [ ] Implement `src/lib/terminalAttachments.ts` to produce reviewable terminal input text from descriptors:
  - files/images: `@<absolute-path>`;
  - clipboard images: `@<saved-image-path>`;
  - large files: `@<parent-directory>`;
  - multiple attachments separated by spaces, with no trailing Enter.
- [ ] Update `TerminalPanel.tsx` to intercept:
  - drag enter/over/leave/drop for files/images,
  - paste events containing OS files,
  - paste events containing image blobs,
  - ordinary text paste, which should continue through xterm unchanged.
- [ ] Add drag-over styling and minimal failure feedback; if no toast is available in `TerminalPanel`, use a local inline status or pass an optional `onAttachmentError` from `WorkspaceShell`.
- [ ] Leave clear seams for future prompt-editor/attachment-preview support: serializer options and attachment descriptors should not be tied directly to xterm.

## Verification
- [ ] Run `npm run typecheck`.
- [ ] Manually paste a text snippet into terminal and confirm normal terminal paste still works.
- [ ] Drag a small text/code file into an active terminal and confirm an editable `@<path>` reference appears in the terminal input without auto-submitting.
- [ ] Drag an image file into an active terminal and confirm its path reference appears.
- [ ] Copy/paste an OS file into an active terminal and confirm its path reference appears.
- [ ] Copy/paste a screenshot/image and confirm StackDock saves it to the attachment cache and inserts the saved path reference.
- [ ] Drag/paste a large file and confirm StackDock references the parent directory rather than reading/inlining the full file.
- [ ] Try the inserted references with Pi, Claude, and Codex CLIs and adjust formatter mappings if one requires a different token form.
