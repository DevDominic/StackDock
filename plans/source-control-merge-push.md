# Source Control: Git merge and push handling plan

## Context
- The bundled Source Control extension lives under `extensions/builtin/git/` and is wired through `electron/main.ts`, `electron/preload.ts`, `src/shared/types.ts`, and `src/components/workspace/WorkspaceShell.tsx`.
- Current behavior is intentionally simple:
  - `extensions/builtin/git/main/gitService.ts` runs git with `execFile('git', ['-C', cwd, ...args])` and `GIT_TERMINAL_PROMPT=0`.
  - `pull()` runs `git pull --ff-only`, so any required merge is rejected instead of represented in the UI.
  - `push()` runs non-interactive `git push`; if Electron's process cannot use the same credentials as the user's terminal, errors surface as raw IPC failures.
  - `getGitStatus()` parses `git status --porcelain=v1 -b` but does not expose merge/rebase/cherry-pick state or unmerged/conflict state.
  - `GitPanel.tsx` only has Refresh/Stage/Commit controls; remote actions are currently command-palette only via `extensions/builtin/git/renderer/index.tsx`.
- User-reported failure: after a manual merge, Source Control `git push` failed with HTTPS credential/authentication errors, while `git push` in the integrated/system terminal succeeded. This points to a non-interactive git credential environment mismatch and a need for a terminal fallback path, not just a better error string.

## Approach
- Add first-class repository operation state to the Git model so the UI knows when a merge is in progress, when files are conflicted, and when a merge commit is ready.
- Keep existing safe defaults: normal `Git: Pull` remains fast-forward-only. Add explicit `Git: Pull (Merge)` for users who want the Source Control UI to initiate a merge.
- Make merge resolution UI-guided rather than magic:
  - conflict files are grouped and marked clearly;
  - stage/unstage still work;
  - the commit box changes to `Commit Merge` while `MERGE_HEAD` exists;
  - aborting a merge is possible but danger-confirmed.
- Fix push-after-merge usability by adding a terminal fallback for remote operations. If non-interactive `git push` fails due to authentication/credential prompts, offer to run the same command in an integrated terminal in the workspace, because that matches the path the user confirmed works.
- Avoid storing or asking for credentials in StackDock. Use the user's installed git credential helper, browser/device auth, SSH agent, or terminal prompt.

## Files
- `src/shared/types.ts`
  - Extend `GitFileStatus` and `GitStatus` with merge/conflict/operation fields.
  - Extend `StackDockApi.git` with new merge-aware git methods.
- `extensions/builtin/git/main/gitParser.ts`
  - Parse and classify unmerged status codes.
  - Add tests for merge conflict porcelain lines.
- `extensions/builtin/git/main/gitService.ts`
  - Preserve stderr/stdout details for git command errors.
  - Detect merge/rebase/cherry-pick state.
  - Add explicit merge pull, merge abort, and possibly continue helpers.
  - Classify authentication failures and terminal-required failures.
- `electron/main.ts`
  - Register IPC handlers for new git methods.
- `electron/preload.ts`
  - Expose new git methods to the renderer.
- `src/components/workspace/WorkspaceShell.tsx`
  - Add UI action handlers for merge pull, abort merge, push terminal fallback, and improved remote error handling.
  - Reuse existing `createTerminal`, `showToast`, `promptDialog`, `refreshGit`, `setRefreshToken`, `requireTrusted`.
- `src/extensions/extensionTypes.ts`
  - Add new `gitActions` callbacks and any error metadata needed by the Git extension renderer.
- `extensions/builtin/git/renderer/GitPanel.tsx`
  - Render merge state, conflict group, remote action buttons, terminal fallback action, merge abort action, and merge commit wording.
- `extensions/builtin/git/renderer/index.tsx`
  - Add command palette entries for `Git: Pull (Merge)`, `Git: Abort Merge`, and `Git: Push in Terminal`.
- `extensions/builtin/git/renderer/git.css`
  - Style merge banner, conflict badges, and remote action row.
- Tests:
  - `tests/gitParser.test.ts` for conflict parsing.
  - New `tests/gitService.test.ts` or similar for status operation-state detection with temporary git repositories.

## Reuse
- Reuse `runGit(cwd, args, options)` in `gitService.ts`, but change it to return stdout/stderr or throw a structured git error.
- Reuse `parseStatusLine()` as the single source for status parsing; add conflict classification there instead of duplicating it in the UI.
- Reuse `WorkspaceShell.createTerminal()` to run terminal fallback commands in the workspace. Do not introduce a separate terminal/spawn mechanism in the renderer.
- Reuse existing trust checks (`requireTrusted`) before any git state-changing action.
- Reuse existing confirmations:
  - `confirmBeforeRemoteActions` for pull/push and merge pull.
  - `confirmBeforeDiscard` style danger confirmation for aborting a merge.
- Reuse existing status refresh paths (`refreshGit()` and `setRefreshToken`) after operations that can affect files.

## Assumptions
- StackDock should not implement credential storage, token entry, or special Codeberg/Forgejo auth flows.
- Normal `Git: Pull` should stay `--ff-only` to avoid surprising local merges.
- `Git: Pull (Merge)` should run `git pull --no-rebase --no-edit` so a successful clean merge does not block on an editor.
- If `Git: Pull (Merge)` produces conflicts, the failed git command is expected and the UI should refresh into merge/conflict mode instead of treating it as only an error.
- A merge is considered commit-ready when `MERGE_HEAD` exists and there are no unmerged/conflict files; the existing `git commit -m <message>` can create the merge commit.
- Terminal fallback command strings are fixed enum-based commands (`git push`, `git pull --ff-only`, `git pull --no-rebase --no-edit`, `git fetch`) and must not interpolate user-controlled arguments.

## Steps
1. Update shared Git types in `src/shared/types.ts`.
   - Add `conflicted: boolean` and optional `conflictStatus?: string` to `GitFileStatus`.
   - Add `operation?: 'merge' | 'rebase' | 'cherry-pick'`, `conflicts?: number`, `mergeReady?: boolean`, and optional `remoteErrorKind?: 'auth' | 'terminal-required' | 'other'` only if needed for renderer state.
   - Add API methods: `pullMerge(path: string): Promise<void>`, `abortMerge(path: string): Promise<void>`.
   - Expected result: TypeScript consumers can distinguish normal dirty files from merge conflicts and operation state.

2. Extend `parseStatusLine()` in `extensions/builtin/git/main/gitParser.ts`.
   - Recognize unmerged porcelain XY pairs: `DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`.
   - Return `conflicted: true`, `staged: false`, `unstaged: true`, and `conflictStatus: XY` for those pairs.
   - Keep existing handling for untracked, staged, unstaged, renamed files unchanged.
   - Expected result: conflict lines such as `UU src/app.ts` parse as a conflict file.

3. Add parser tests in `tests/gitParser.test.ts`.
   - Add cases for `UU`, `AA`, `DU`, and renamed/non-conflict regression.
   - Expected result: parser tests document the exact conflict classification.

4. Refactor `runGit()` in `extensions/builtin/git/main/gitService.ts` into structured command execution.
   - Capture both stdout and stderr on success.
   - On failure, throw an error whose message includes the useful stderr/stdout lines but not the full Electron IPC wrapper.
   - Preserve `timeoutMs` and `GIT_TERMINAL_PROMPT=0` for non-terminal UI operations.
   - Add a helper `isAuthError(error)` matching common patterns: `Authentication failed`, `Credentials are incorrect or have expired`, `could not read Username`, `terminal prompts disabled`, `Permission denied (publickey)`, `Repository not found` only if emitted with auth wording.
   - Expected result: UI receives concise, classified git failures.

5. Add git operation-state detection in `getGitStatus()` in `gitService.ts`.
   - Use `git rev-parse --git-path MERGE_HEAD`, `REBASE_HEAD`/`rebase-merge`/`rebase-apply`, and `CHERRY_PICK_HEAD` to detect operation state without assuming `.git` is a directory.
   - Parse `git status --porcelain=v1 -b` as today.
   - Set `status.operation = 'merge'` when `MERGE_HEAD` exists.
   - Set `status.conflicts` to the count of `files` with `conflicted === true`.
   - Set `status.mergeReady = operation === 'merge' && conflicts === 0`.
   - Expected result: after a conflicted or manually resolved merge, Source Control can show the correct next action.

6. Add merge git methods in `gitService.ts`.
   - `pullMerge(cwd)` runs `git pull --no-rebase --no-edit` with the same 120s timeout as pull/push.
   - If `pullMerge` exits non-zero but a merge is now in progress, throw a clear message like `Merge has conflicts. Resolve them, stage the files, then commit the merge.` after status refresh in the caller.
   - `abortMerge(cwd)` runs `git merge --abort`.
   - Keep existing `pull(cwd)` as `git pull --ff-only`.
   - Expected result: users can intentionally start a merge from the UI and abort it when needed.

7. Wire new methods through IPC.
   - Add `git:pullMerge` and `git:abortMerge` handlers in `electron/main.ts` using `assertAbsolutePath`.
   - Add `pullMerge` and `abortMerge` bridge methods in `electron/preload.ts`.
   - Expected result: renderer code can call the new backend methods through `window.stackdock.git`.

8. Extend `gitActions` in `src/extensions/extensionTypes.ts` and `WorkspaceShell.tsx`.
   - Add callbacks: `pullMerge()`, `abortMerge()`, `pushInTerminal()`, and optionally `pullMergeInTerminal()`.
   - Implement `runGitInTerminal(kind)` in `WorkspaceShell.tsx` using existing `createTerminal(defaultProfileId, workspace.path, name, command)`.
   - Use fixed commands only:
     - push: `git push`
     - pull ff-only: `git pull --ff-only`
     - pull merge: `git pull --no-rebase --no-edit`
     - fetch: `git fetch`
   - Expected result: Source Control can launch the same terminal path that works for the user without adding credential handling.

9. Improve remote action handling in `WorkspaceShell.runGitRemoteAction()`.
   - On success, keep existing refresh/toast behavior.
   - On auth/terminal-required failure for push/pull/fetch, set `gitError` to a concise explanation and show a confirmation: `Git push needs terminal authentication. Run it in a terminal?`.
   - If confirmed, call `runGitInTerminal(kind)` and leave the terminal visible.
   - Always refresh git status after terminal command launch only when the command completes is not currently available; instead tell the user to press Refresh after terminal completion, or add a lightweight terminal result listener only if already easy to reuse.
   - Expected result: the reported push failure leads directly to a working terminal fallback instead of a dead-end raw error.

10. Update `GitPanel.tsx` UI.
    - Add a remote actions row near the top with `Fetch`, `Pull`, `Pull Merge`, and `Push` buttons wired to `gitActions`.
    - When `status.operation === 'merge'`, render a banner:
      - If conflicts exist: `Merge in progress: resolve conflicts, stage resolved files, then commit.`
      - If `mergeReady`: `Merge ready: commit to finish the merge.`
    - Add an `Abort Merge` danger button in the merge banner.
    - Group conflicted files above staged/changes as `Conflicts (n)` using `file.conflicted`.
    - Change conflict badge text to `!` or the `conflictStatus` code and apply conflict styling.
    - Change commit button label to `Commit Merge` when `status.operation === 'merge'`.
    - Expected result: users can see exactly what merge state they are in and what action finishes it.

11. Add command palette entries in `extensions/builtin/git/renderer/index.tsx`.
    - Keep existing `Git: Pull` as fast-forward-only and describe it as such.
    - Add `Git: Pull (Merge)` with description `Pull and create/continue a merge if needed`.
    - Add `Git: Abort Merge` only when `git.operation === 'merge'`.
    - Add `Git: Push in Terminal` always when in a repo.
    - Expected result: keyboard users can access the same merge and fallback flows.

12. Style the new Git UI in `extensions/builtin/git/renderer/git.css`.
    - Add `.git-merge-banner`, `.git-remote-actions`, `.git-conflict`, and `.git-badge.git-conflict` styles.
    - Keep layout compact for narrow sidebars by allowing buttons to wrap.
    - Expected result: merge/conflict state is visible without breaking the current sidebar layout.

13. Add service-level tests for merge state.
    - Create a new `tests/gitService.test.ts` using temporary directories and local git commands if the test suite already permits filesystem tests.
    - Test a repository with an unresolved merge conflict returns `operation: 'merge'`, `conflicts > 0`, and at least one `conflicted` file.
    - Test a manually resolved/staged merge returns `operation: 'merge'`, `conflicts: 0`, and `mergeReady: true` before the merge commit.
    - If full temp-repo tests are too slow/flaky on CI, extract operation-state helpers from `gitService.ts` and unit-test those helpers with mocked git paths/status text.
    - Expected result: merge state does not regress silently.

14. Manual Windows verification for the reported credential path.
    - In a repo using the same HTTPS remote style as the report, make sure terminal `git push` succeeds.
    - Trigger `Git: Push` from Source Control.
    - If non-interactive push fails with auth, confirm the fallback prompt opens an integrated terminal running `git push` in the workspace.
    - Expected result: the terminal command succeeds or presents the user's normal git credential flow.

## Verification
- Static checks:
  - `npm run typecheck`
  - Expected pass signal: both root and Electron TypeScript projects complete with no errors.
- Unit tests:
  - `npm test -- tests/gitParser.test.ts`
  - `npm test -- tests/gitService.test.ts` if added as a separate file.
  - Full suite: `npm test`
  - Expected pass signal: Vitest reports all tests passing.
- Manual merge-flow check:
  1. Create two branches with conflicting edits to the same file.
  2. From Source Control, run `Pull Merge` or reproduce a merge conflict manually in the repo.
  3. Confirm Source Control shows `Merge in progress`, a `Conflicts` group, and an `Abort Merge` button.
  4. Resolve the file in the editor/terminal, stage it in Source Control, and confirm the banner changes to merge-ready.
  5. Commit with the `Commit Merge` button.
  6. Confirm status returns to normal and the branch shows ahead.
- Manual push-after-merge check:
  1. Complete a merge commit locally so the branch is ahead.
  2. Run `Git: Push` from the UI.
  3. If credentials are available non-interactively, confirm push succeeds and ahead count clears.
  4. If credentials fail, confirm the error is concise and the `Run in Terminal` fallback launches `git push` in the workspace.

## Risks
- Authentication behavior varies by Git Credential Manager, SSH agent, remote host, and how Electron was launched. Mitigation: terminal fallback uses the user's normal shell/git path and avoids credential storage.
- `git pull --no-rebase --no-edit` can modify many files and produce conflicts. Mitigation: keep existing `Pull` as ff-only, make merge pull explicit, and require confirmation through `confirmBeforeRemoteActions`.
- `git merge --abort` can discard merge-progress state. Mitigation: danger confirmation and clear wording.
- Merge/rebase/cherry-pick state detection can be wrong if `.git` is a file for worktrees/submodules. Mitigation: use `git rev-parse --git-path ...` rather than hard-coded `.git` paths.
- Running terminal fallback commands cannot automatically notify Source Control when the terminal command completes unless additional plumbing is added. Mitigation: show a toast telling the user to refresh after terminal completion, or reuse existing headless result events only if implemented safely.
- Conflict rendering does not resolve conflicts itself. Mitigation: make the state and next steps obvious; rely on existing editor and staging functions.

