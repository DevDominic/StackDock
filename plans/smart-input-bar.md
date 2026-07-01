# Smart Input Bar Plan

## Context
- Goal: add a Warp-like Smart Input bar beneath the active terminal so multi-line command editing feels closer to a normal text editor.
- Desired behavior from request:
  - Textbox/editor under terminal with a Send button.
  - Enter-to-send behavior should be configurable.
  - Dragged files, folders, and images should remain supported.
  - Dropped/pasted attachments should have a visual preview above the input, similar to ChatGPT attachment chips.
  - Voice Input button should move from the transparent terminal overlay into the Smart Input UI when the bar is open.
- Current code findings:
  - `src/components/workspace/TerminalPanel.tsx` owns xterm setup, PTY writes, drag/drop, paste, context menu, and attachment insertion.
  - Attachments are converted through `api.attachments.inspectPath`, `api.attachments.savePastedImage`, and serialized by `serializeTerminalAttachments` in `src/lib/terminalAttachments.ts`.
  - Voice Input currently contributes `renderTerminalOverlay` from `extensions/builtin/voice-input/renderer/index.tsx`, rendering `VoiceInputTerminalButton` as a floating overlay via `WorkspaceShell.tsx` and `voiceInput.css`.
  - Settings live in `StackDockSettings` (`src/shared/types.ts`) with defaults in `electron/configStore.ts` and UI in `src/components/workspace/SettingsModal.tsx`.

## Approach
- Add a terminal-level Smart Input composer that sits below xterm inside `TerminalView` and writes composed input to the active terminal via `api.terminal.write(session.id, textToSend)`.
- Keep the first implementation lightweight and React-native: use a styled `textarea` plus attachment chips, send button, and optional integrated voice action slot.
- Refactor current terminal drag/drop and paste attachment handling so dropped/pasted files can be staged as chips in Smart Input mode instead of immediately written to the PTY.
- Add terminal settings for enabling Smart Input and configuring Enter behavior. Smart Input should be always visible whenever enabled, not toggled per terminal/session.
- Adapt the Voice Input native extension so its terminal button can render inside Smart Input when the host exposes an integration point, falling back to the existing floating overlay otherwise.

## UI design guidance
The composer must read as a native part of StackDock, not a bolted-on chat widget. Everything below maps to existing tokens in `src/styles.css` (`:root`) — do not introduce new hex colors, font stacks, or radii. Prefix all new classes with `terminal-smart-input`.

### Layout & container
- The composer is a flex column child of `.terminal-shell`, rendered as a sibling *after* `.terminal-mount` so xterm keeps `flex: 1` and the bar sits flush at the bottom. This is also why terminal fit/resize must subtract the composer height (see Steps).
- Container: `background: var(--bg-panel)`, `border-top: 1px solid var(--border)` (matches how `.session-header`, status bar, and other bottom/edge chrome separate from content). No outer border-radius — it spans the full terminal width edge-to-edge, like the status bar.
- Inner padding `8px 10px`, `display: flex; flex-direction: column; gap: 8px`. Keep `min-width: 0` so split terminals don't overflow (follow the `min-width: 0` discipline used throughout `.terminal-*`).
- In split view (`.terminal-views.split-row/.split-column`) the composer belongs to each `.terminal-shell`, so it inherits per-pane sizing automatically; verify the textarea `max-height` cap (below) keeps a narrow pane usable.

### Textarea (the editor)
- Style after `.search-input`: `background: var(--bg-panel)` (or `var(--bg-elevated)` to lift it off the container), `border: 1px solid var(--border)`, `border-radius: 10px`, `padding: 8px 10px`, `color: var(--text)`.
- Because it holds command text, use the code font tokens (`font-family: var(--code-font); font-weight: var(--code-font-weight); font-feature-settings: var(--code-font-features)`), matching `.terminal-mount`. This visually ties the composer to the terminal above it.
- Focus state must mirror `.search-input:focus` exactly: `outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--accent-soft)`.
- Auto-grow from ~1 line to a `max-height` of roughly 8–10 lines, then scroll internally (thin scrollbars are already global). `resize: none` (the voice extension's `.voice-transcript` sets this precedent).
- Placeholder in `var(--muted)`, e.g. "Type a command… Enter to send, Shift+Enter for newline" (reflect the actual `enterToSend` setting).

### Action row (Send + voice slot)
- A right-aligned flex row (`justify-content: flex-end; gap: 8px; align-items: center`) beneath the textarea, or inline-right if space allows.
- Send button uses the existing `button.primary` class verbatim (`var(--primary)` bg, `var(--primary-fg)` text, radius 6px, 30px min-height) — do not restyle. Disable it (native `:disabled`, already dimmed to `.55`) when the composer is empty.
- Optional secondary actions use `button.ghost`. Keep the built-in `:focus-visible` outline (`2px var(--primary-border-soft)`).
- The embedded Voice Input action should adopt composer-appropriate styling rather than the floating 42px circle: render it as a `button.ghost` icon button in the action row (reuse `.icon-btn` sizing: 32×32, `border-radius: 9px`, `color: var(--muted)`), keeping the existing recording state cue (`var(--danger)` color) from `voiceInput.css`. The floating `.voice-terminal-button` overlay remains the fallback when Smart Input is hidden.

### Attachment preview chips
- Reuse the existing `.chip` language (pill: `border-radius: 999px`, `padding: 3px 9px`, `font-size: 11px`, `color: var(--muted)`, `background: var(--bg-panel)`, `border: 1px solid var(--border)`, 13px svg icon). Render chips in a wrapping flex row (`.ws-chips` uses `flex-wrap: wrap; gap: 6px`) *above* the textarea.
- Each chip: a small type icon (file/folder/image), a truncated name (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, cap width ~180px), and a remove `×` affordance. On hover the remove control brightens toward `var(--text)`; the whole chip can lift its border to `var(--border-strong)` like `.session-tab:hover`.
- Image attachments may show a tiny thumbnail inside the chip; keep it within the pill height so the row stays compact.

### Drag-over state
- Keep the current `.terminal-shell.attachment-drag-over` treatment (inset `2px var(--primary-border-soft)` ring + dashed `var(--primary)` overlay with "Drop files, folders, or images to attach"). When Smart Input is enabled, the same drop still lands as chips — no separate composer drop-zone styling is needed, which keeps the interaction consistent with today's behavior.

### Settings controls
- The new Smart Input settings must use the established Settings pattern: boolean rows render as `label.settings-toggle-row` with a `<span><b>Label</b><span class="muted code-font-note">description</span></span>` and a trailing native `<input type="checkbox">` (accent-color already `var(--primary)`, row renders as a rounded `13px` panel card). Place them in the Terminal settings section under a matching `<h3>`.

### Motion, spacing & polish
- Reuse existing transition timing (`.12s ease` for color/border, `.06s ease` for transform) so hovers feel identical to the rest of the app.
- Respect the radius scale already in use: 6px buttons, 9px icon buttons, 10px text inputs, 999px chips, 13–16px large cards. The composer container itself stays square (edge chrome).
- Do not add drop shadows to the composer container; elevation shadows in this app are reserved for floating/overlay surfaces (`--shadow`), and the bar is docked chrome.

## Files to modify
- `src/components/workspace/TerminalPanel.tsx`
- `src/components/workspace/WorkspaceShell.tsx`
- `src/styles.css`
- `src/shared/types.ts`
- `electron/configStore.ts`
- `src/components/workspace/SettingsModal.tsx`
- `src/extensions/extensionTypes.ts`
- `extensions/builtin/voice-input/renderer/index.tsx`
- `extensions/builtin/voice-input/renderer/VoiceInputTerminalButton.tsx`
- `extensions/builtin/voice-input/renderer/voiceInput.css`
- Possibly tests under `tests/` if existing settings/attachment behavior is covered or new utility tests are added.

## Reuse
- Reuse terminal PTY writing: `api.terminal.write` from `src/lib/api.ts` / `src/shared/types.ts`.
- Reuse attachment inspection and persistence:
  - `api.attachments.inspectPath`
  - `api.attachments.savePastedImage`
  - `api.attachments.saveClipboardImage`
  - `api.attachments.getPathForFile`
- Reuse attachment serialization and summaries from `src/lib/terminalAttachments.ts`.
- Reuse existing drag/drop helpers in `TerminalPanel.tsx`: `filesFromDataTransfer`, `explorerPathsFromDataTransfer`, `attachmentFromFile`.
- Reuse `VoiceInputTerminalButton` and `useVoiceInputRecorder` from the voice input extension.

## Steps
- [x] Confirm UX choices that are not encoded in the codebase yet.
- [x] Add `terminal.smartInput` settings shape and defaults: `{ enabled, enterToSend, sendEnter }`. Defaults: `enabled` off, `enterToSend` on, `sendEnter` off. Sending writes the composer contents exactly; the optional `sendEnter` setting ("Execute after sending") appends a terminal Enter only when explicitly enabled.
- [x] Add Settings UI controls in the Terminal settings section.
- [x] Build a `TerminalSmartInput` subcomponent or inline component inside `TerminalPanel.tsx` with textarea, Send button, attachment preview chips, clear/remove actions, and keyboard handling. When enabled, the composer is always visible under the terminal.
- [x] Change attachment drop/paste behavior: when Smart Input is enabled, stage attachments as chips and insert their serialized path tokens into the textarea immediately; when disabled, preserve the current immediate-write behavior. Removing an attachment chip must also remove its corresponding token from the textarea/preview state.
- [x] Ensure terminal resize/fitting accounts for the composer occupying vertical space beneath xterm (the existing ResizeObserver on the xterm mount refits when the composer appears or grows).
- [x] Define an extension integration path so Voice Input can render as an embedded composer action when Smart Input is visible, while retaining overlay behavior when not visible. Voice transcripts should be inserted into the composer for review instead of being sent directly to the terminal while Smart Input is open.
- [x] Update CSS for composer layout, focus states, drag-over state, attachment chips, compact/split-terminal behavior, and embedded voice button styling. Follow the **UI design guidance** section above: reuse existing tokens/classes (`button.primary`, `.chip`, `.icon-btn`, `--primary`/`--accent-soft` focus ring) and add no new colors, fonts, or radii.
- [x] Add/adjust tests where practical for attachment serialization/staging and settings migration/defaults.

## Verification
- Run `npm run typecheck`.
- Run `npm test`.
- Manual checks:
  - With Smart Input disabled, terminal input, paste, drag/drop, and voice overlay behave exactly as before.
  - With Smart Input enabled, type single-line and multi-line commands and Send writes the exact composer contents to the active terminal.
  - Enter-to-send is on by default; pressing Enter sends without appending a trailing newline; Shift+Enter inserts a newline in the composer.
  - Drag/drop file, folder, and image; chips appear above the textarea; serialized tokens appear in the textarea immediately; removing chips removes matching tokens; Send writes the exact textarea contents.
  - Pasted text goes into textarea; pasted image/file becomes a chip and inserts its token into the textarea.
  - Voice Input button appears in composer instead of overlay and writes transcript into the composer for review.
  - Split terminals do not overflow and each focused/active terminal has the expected composer behavior.
  - Visual consistency: composer container, textarea focus ring, Send button, and attachment chips match surrounding StackDock chrome (see UI design guidance); no off-palette colors or radii were introduced.

## Answered UX decisions
- Smart Input is always visible when enabled; no per-terminal/session toggle for the initial implementation.
- Voice transcription is inserted into the composer for review while Smart Input is open.
- Staged attachment path tokens appear in the textarea immediately.
- Removing an attachment chip also removes the corresponding token from the textarea and preview state.
- Enter-to-send defaults to on.
- Shift+Enter inserts a newline in the composer.
- Send writes the exact composer contents and does not append a trailing newline/Enter automatically.
- A separate "Execute after sending" setting (`sendEnter`, default off) lets users opt into appending a terminal Enter after the composer contents are written.
