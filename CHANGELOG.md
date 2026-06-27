# StackDock Changelog

## 0.1.0

Initial launch release focused on workspace terminals, Source Control, editor/web tabs, and recovery tooling.

- Added terminal session recovery commands for reload, snapshot-preserving restart, forced kill, and external terminal launch.
- Added diagnostics export, local logs access, settings backup, settings reset, workspace layout reset, and Safe Mode.
- Added first-run release notes and command-palette access for launch support actions.
- Improved Source Control diff selection for partial staging and added clearer handling for unpreviewable git entries.
- Improved terminal visibility/output handling so switching sessions does not leave stale terminal output behind.

Known launch notes:

- Large Monaco and terminal renderer chunks are expected in 0.1.0 builds.
- Binary git file previews are intentionally skipped.
- Safe Mode disables local extension packages for the next launch; re-add local packages from Settings when needed.
