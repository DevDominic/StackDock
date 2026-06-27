import type { LaunchInfo } from '../shared/types';

interface Props {
  launchInfo?: LaunchInfo | null;
  onClose(): void;
}

export function ReleaseNotesDialog({ launchInfo, onClose }: Props) {
  const version = launchInfo?.releaseNotesVersion ?? '0.1.0';
  return (
    <div className="modal-backdrop release-notes-backdrop" onMouseDown={onClose}>
      <section className="release-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="release-notes-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h3 id="release-notes-title">StackDock {version}</h3>
            <p>Launch build focused on resilient terminals, Source Control, and local recovery tools.</p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close release notes">×</button>
        </header>
        <div className="release-notes-grid">
          <section>
            <h4>Added</h4>
            <ul>
              <li>Diagnostics export and local logs access.</li>
              <li>Safe Mode for starting without local extensions.</li>
              <li>Terminal reload, restart, kill, and external-open commands.</li>
              <li>Settings backup/reset and workspace layout reset.</li>
            </ul>
          </section>
          <section>
            <h4>Fixed</h4>
            <ul>
              <li>Terminal output no longer goes stale when switching sessions.</li>
              <li>Partial git staging no longer marks both rows as the active diff.</li>
              <li>Unpreviewable git entries fail clearly instead of leaving an old diff active.</li>
            </ul>
          </section>
          <section>
            <h4>Known Notes</h4>
            <ul>
              <li>Binary git files are skipped in the diff preview.</li>
              <li>Large Monaco and terminal chunks are expected in launch builds.</li>
              <li>Safe Mode removes local extension package paths after creating a backup.</li>
            </ul>
          </section>
        </div>
        {launchInfo?.safeMode ? <div className="release-notes-safe-mode">Safe Mode is active for this launch.</div> : null}
        <footer>
          <button className="primary" onClick={onClose}>Continue</button>
        </footer>
      </section>
    </div>
  );
}
