# Extension Folder Format

Use this format when migrating built-in features into extensions.

## Goals
- Keep each extension self-contained and easy to disable.
- Put feature-specific UI, styles, commands, manifests, and backend services under one extension folder.
- Keep shared host contracts in `src/shared` and generic extension host types in `src/extensions`.

## Built-in extension layout

```text
extensions/builtin/<extension-id>/
  manifest.ts              # shared manifest metadata
  renderer/
    index.tsx              # NativeExtension export and renderer contributions
    *.tsx                  # extension-owned UI components
    *.css                  # extension-owned UI styles
  main/
    *.ts                   # extension-owned Electron/backend services
```

## Rules
- Export one `NativeExtension` from `renderer/index.tsx`; it may include `renderSettings` for a custom Settings > Extensions configuration view.
- Export one manifest object from `manifest.ts` and reuse it anywhere bundled manifests are listed.
- Keep extension-owned React components inside `renderer/`, not `src/components`.
- Keep extension-owned CSS inside `renderer/*.css` and import it from the renderer entry.
- Keep extension-owned backend code inside `main/`, not `electron/`, unless it is generic host infrastructure.
- Do not duplicate manifest data between renderer and Electron services.
- Do not add generic app logic to an extension folder unless it belongs only to that extension.
- Disabling an extension should remove its views, status-bar items, commands, and other user-facing UI contributions.

## Shared code boundaries
- `src/shared/types.ts`: app-wide public contracts and IPC API types.
- `src/extensions/extensionTypes.ts`: generic native extension host interfaces.
- `electron/*`: generic Electron host services and IPC wiring.
- `extensions/builtin/<id>`: feature-specific extension implementation.

## Verification checklist
- Search for stale imports from old locations.
- Run `npm run typecheck`.
- Run `npm test -- --run`.
- Run `npm run build` for migrations that move renderer or Electron imports.
