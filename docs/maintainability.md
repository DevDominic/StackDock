# Maintainability Notes

This file tracks non-blocking public-readiness debt found during the repository audit.

## WorkspaceShell hotspot

`src/components/workspace/WorkspaceShell.tsx` is the main workspace coordinator and is currently large. Avoid adding new side/bottom/status UI directly to it when an extension contribution can own the feature.

Future refactor candidates:

- extract git command orchestration into a hook or extension-owned adapter;
- extract editor/web tab state helpers;
- isolate terminal split/session layout helpers;
- keep IPC calls in small focused adapters that are easier to test.

## Dead-code and complexity scan

The architecture scan reported many potential dead-code and complexity smells. Treat these as candidates, not proof. Remove code only after confirming it is unused through TypeScript references, tests, and manual QA.

## Public launch guidance

Do not block the first public source release on a broad `WorkspaceShell` rewrite. Prefer small, tested hardening changes and track larger refactors as issues.
