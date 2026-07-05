# Pi JSON Headless Commands Plan

## Context

- StackDock custom commands are stored as `PaletteCommand` objects in `src/shared/types.ts` and edited in `src/components/workspace/CommandsEditor.tsx` / `src/components/workspace/SettingsModal.tsx`.
- A command with `headless: true` is launched from `runPaletteCommand` in `src/components/workspace/WorkspaceShell.tsx`, which calls `createTerminal(..., { headless: true, commandLabel })`.
- Renderer session state for command runs lives in `src/state/sessionStore.ts` as `headlessRuns`. It currently appends raw streamed chunks via `appendHeadlessOutput` and finalizes via `completeHeadlessRun`.
- Main-process headless execution lives in `electron/terminalManager.ts`:
  - `runHeadlessProcess` uses `child_process.spawn` for headless commands and exits when the child exits.
  - `appendHeadlessProcessOutput` forwards stdout/stderr chunks through `terminal:headlessData`.
  - `sendHeadlessProcessResult` forwards a final `terminal:headlessResult` with cleaned raw output.
- The Commands panel UI lives in `extensions/builtin/headless/renderer/HeadlessPanel.tsx` and currently displays one `output` string while a command runs and after completion.
- `pi --help` confirms Pi JSON mode is `--mode json`; print mode remains one-shot and exits after completing prompts. The JSON stream is newline-delimited JSON events from the session/event subscription, not a long-lived interactive protocol.

## Approach

Add renderer-side support for Pi's JSON event stream in headless command output:

1. Keep the existing headless process lifecycle unchanged so `pi --mode json -p ...` still terminates when Pi exits, exactly like current `pi -p ...` commands.
2. Auto-detect Pi JSONL events in `appendHeadlessOutput` instead of adding a mandatory new command setting. Existing plain commands keep current behavior; users enable Pi JSON mode by changing their command text from `pi -p ...` to `pi --mode json -p ...`.
3. Parse recognized Pi JSON events into human-readable live progress plus a clean final assistant answer. Avoid showing raw JSON lines in the Commands panel.
4. Preserve raw/plain behavior for non-JSON output, malformed lines, stderr warnings, and commands that emit unrelated JSON.
5. Add targeted tests around parsing, partial-line buffering, fallback behavior, and finalization.

## Files

- `src/shared/types.ts`
  - Extend `HeadlessCommandRun` with optional presentation fields for live parsed progress, e.g. `progress?: string`, and possibly a detected format marker such as `outputFormat?: 'plain' | 'pi-json'`.
- `src/state/sessionStore.ts`
  - Add a small Pi JSONL parser/helper layer used by `appendHeadlessOutput` and `completeHeadlessRun`.
  - Keep existing `cleanHeadlessOutput` behavior for plain mode.
- `extensions/builtin/headless/renderer/HeadlessPanel.tsx`
  - Display parsed progress while a Pi JSON command is running and display the final assistant output when available.
  - Keep current UI for plain commands.
- `tests/sessionStore.test.ts`
  - Add unit coverage for Pi JSON parsing and plain fallback.
- Optional documentation/update surface if desired after implementation:
  - `README.md` or a short docs note can show that a headless command should use `pi --mode json -p "..."` to get live command progress.

## Reuse

- Reuse the existing IPC flow:
  - `terminal:headlessData` for live chunks.
  - `terminal:headlessResult` for process completion.
- Reuse the existing `headlessRuns` in-memory state rather than adding a new global store.
- Reuse existing output limits:
  - `HEADLESS_OUTPUT_MAX_CHARS` in `src/state/sessionStore.ts` for bounded renderer state.
  - Main-process timeout/kill behavior in `electron/terminalManager.ts` remains unchanged.
- Reuse existing `HeadlessPanel` list/modal surfaces; no new panel is required.

## Assumptions

- Users who want this behavior will update their headless Pi command to include `--mode json`, for example:
  - `pi --mode json -p --model openai-codex/gpt-5.5 --thinking medium "..."`
- StackDock should parse and present Pi JSON output but should not rewrite arbitrary shell command strings to insert `--mode json`; command rewriting would be fragile with quoting, aliases, wrappers, and non-Pi commands.
- The Pi JSON stream is newline-delimited JSON where recognized event objects have fields such as `type`, and `message_update` may contain `assistantMessageEvent` with `text_delta`, `thinking_delta`, and tool-call events.
- The final command result shown in the Commands UI should be the final assistant text, not the raw JSON event log.
- It is acceptable for the Commands UI to show summarized progress/status for thinking and tool activity. If full reasoning text is displayed, it should remain confined to this local command output surface and bounded by existing truncation limits.

## Steps

1. **Extend headless run presentation type**
   - In `src/shared/types.ts`, update `HeadlessCommandRun` with optional fields:
     - `progress?: string` for live parsed status/progress text.
     - `outputFormat?: 'plain' | 'pi-json'` if useful for UI badges/branching.
   - Expected result: existing plain command call sites still type-check because new fields are optional.

2. **Introduce Pi JSON parser state in `sessionStore.ts`**
   - In `src/state/sessionStore.ts`, add module-level parser state keyed by run id, for example a `Map<string, PiJsonRunState>` containing:
     - pending line buffer,
     - detection status (`unknown`, `plain`, `pi-json`),
     - accumulated progress text,
     - accumulated/final assistant text.
   - Add helper functions:
     - `isPiJsonEvent(value: unknown): boolean` to recognize Pi session/event objects conservatively.
     - `extractAssistantText(message: unknown): string` to collect `content` blocks with `type === 'text'`.
     - `formatPiJsonEvent(event: unknown, state: PiJsonRunState): Partial<HeadlessCommandRun>` to update progress/output.
     - `appendPiJsonChunk(id: string, chunk: string, command: string): Partial<HeadlessCommandRun> | null` to return `null` when the chunk should be treated as plain output.
   - Expected result: parser logic is isolated and can be unit tested through store behavior without touching Electron IPC.

3. **Parse live headless chunks before plain cleaning**
   - In `appendHeadlessOutput(id, data)`:
     - Look up the target run.
     - Feed raw `data` into the Pi JSON parser before calling `cleanHeadlessOutput`.
     - If the parser detects Pi JSON mode, update the run with `outputFormat: 'pi-json'`, parsed `progress`, and any current/final assistant `output`.
     - If detection has not happened or fails, preserve current behavior: append raw data, trim, and clean with `cleanHeadlessOutput`.
   - Expected result: plain commands behave exactly as before, while `pi --mode json -p ...` no longer fills the panel with raw JSON.

4. **Finalize Pi JSON runs cleanly**
   - In `completeHeadlessRun(id, result)`:
     - Flush any buffered partial JSON line for the run.
     - If parser state says the run is `pi-json`, prefer the parsed final assistant text for `output` and ignore raw JSON in `result.output` unless no final text exists.
     - If the process failed or timed out and no parsed final text exists, show a concise error/status from `result.output` or existing progress.
     - Delete parser state for the run after completion or deletion.
   - In `removeHeadlessRun(id)`, also delete parser state for that id.
   - Expected result: final toast/modal output is the actual assistant answer, and memory does not retain parser buffers after the run is gone.

5. **Map Pi events to useful progress text**
   - In the event formatter, handle at least:
     - `agent_start` / `turn_start`: set progress like `Agent started` / `Thinking…`.
     - `message_update.assistantMessageEvent.type === 'thinking_delta'`: append or update a bounded thinking/progress tail.
     - `message_update.assistantMessageEvent.type === 'text_delta'`: append assistant text to the final-output buffer.
     - `tool_execution_start`: append `Running <toolName>…`.
     - `tool_execution_end`: append `<toolName> completed` or `<toolName> failed` based on `isError`.
     - `message_end`, `turn_end`, or `agent_end`: derive final assistant text from the event's message/messages when present.
     - `auto_retry_start`, `compaction_start`, and `compaction_end`: append concise status lines if encountered.
   - Bound progress/output to `HEADLESS_OUTPUT_MAX_CHARS` or a smaller helper limit.
   - Expected result: command cards visibly update during long Pi runs, especially while tools execute or reasoning/text deltas stream.

6. **Update the Commands panel rendering**
   - In `extensions/builtin/headless/renderer/HeadlessPanel.tsx`:
     - For the card snippet, show `run.progress` while running when present, otherwise `run.output`.
     - In the modal, for running Pi JSON commands show a progress section and a final-answer/output section when `run.output` is non-empty.
     - For completed commands, prioritize final `run.output`; optionally show `run.progress` below it as run log if useful.
     - Keep the existing `No output yet.` fallback.
   - Expected result: the UI remains simple, but JSON-mode Pi commands provide live visibility and a clean final answer.

7. **Add unit tests**
   - In `tests/sessionStore.test.ts`, add tests that:
     - Create a headless run and feed JSONL `message_update` events with `thinking_delta` and `text_delta`; expect progress/output to update without raw JSON.
     - Feed split JSON lines across multiple `appendHeadlessOutput` calls; expect correct buffering and parsing.
     - Complete a Pi JSON run with a final `agent_end`/assistant message; expect `output` to be final assistant text rather than raw result JSON.
     - Feed a normal plain command output; expect existing cleaning behavior, including shell exit echo removal, to remain unchanged.
     - Feed malformed/non-Pi JSON; expect fallback to plain output rather than data loss.
   - Expected result: parser and fallback behavior are locked down without needing to spawn Pi in tests.

8. **Optional docs/help text**
   - If adding docs, update a small existing user-facing docs area with:
     - Headless Pi JSON command example: `pi --mode json -p "..."`.
     - Note that `pi -p` alone still only emits final text, so the Commands UI cannot show Pi event progress unless `--mode json` is used.
   - Expected result: users know how to enable live progress for their existing `Pi: Create Commits` command.

## Verification

- Run unit tests:
  - `npm test -- tests/sessionStore.test.ts`
  - Expected pass signal: all `sessionStore` tests pass, including new Pi JSON parsing tests and existing plain-output cleanup tests.
- Run full type checking:
  - `npm run typecheck`
  - Expected pass signal: both root and Electron TypeScript projects complete with no errors.
- Run full test suite if time allows:
  - `npm test`
  - Expected pass signal: Vitest completes with all tests passing.
- Manual check in the app:
  1. Create or edit a headless command to use `pi --mode json -p "Say hello, wait briefly, then say done"` or the existing commit prompt with `--mode json` inserted.
  2. Run it from the command palette.
  3. Open the Commands panel.
  4. Expected pass signals:
     - The command card changes while Pi is running.
     - The modal shows live progress/tool/thinking updates rather than raw JSONL.
     - When Pi exits, the run is marked completed and the final output is the assistant's final answer.
     - The hidden process terminates normally without leaving a terminal session open.
  5. Run a non-Pi headless command like `echo hi`.
  6. Expected pass signal: output remains `hi` and no JSON parser artifacts appear.

## Risks

- **Pi JSON event schema changes**: The parser should recognize only broad stable fields and fall back to plain output for unknown/malformed lines. Keep parsing defensive and optional.
- **Mixed stdout/stderr**: Current main-process code forwards both streams through the same `terminal:headlessData` channel. Non-JSON stderr warnings may appear during a Pi JSON run. The parser should preserve non-JSON lines as progress/error text rather than dropping them.
- **Reasoning/privacy**: `thinking_delta` may contain model reasoning. If displaying raw thinking is considered too sensitive/noisy, prefer showing a bounded status such as `Thinking…` plus short tail, or omit raw thinking deltas while still showing tool/text progress.
- **Final output semantics**: For JSON-mode Pi, raw process output is JSONL; final UI output must come from parsed assistant text. Tests should prevent regressions where the completion toast shows raw JSON.
- **No automatic command rewriting**: Existing commands must be edited to include `--mode json`. This avoids shell-quoting bugs but means old `pi -p ...` commands will still only update at completion.
- **Rollback**: Because the process lifecycle and IPC are unchanged, rollback is limited to removing the parser/UI branching and optional type fields. Existing headless command behavior should remain intact throughout.
