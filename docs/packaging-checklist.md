# Packaging checklist

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm run dist`
6. Launch portable exe from `dist/`.
7. Add workspace.
8. Open terminal.
9. Run `git --version` or `node -v`.
10. Open file, edit, save.
11. Verify Git panel lists changes and diff.
12. Verify `%APPDATA%/StackDock/` config/workspace/layout files exist.
13. Confirm no DevTools in packaged app.
14. Confirm `node-pty` works packaged via `asarUnpack`.
