import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeadlessCommandRun } from '../../../../src/shared/types';

interface Props {
  runs: HeadlessCommandRun[];
  onTerminate(id: string): void | Promise<void>;
  onDelete(id: string): void | Promise<void>;
}

function elapsedLabel(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function HeadlessPanel({ runs, onTerminate, onDelete }: Props) {
  const [inspectingRunId, setInspectingRunId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const outputRef = useRef<HTMLPreElement | null>(null);
  const inspectingRun = useMemo(() => runs.find((run) => run.id === inspectingRunId) ?? null, [inspectingRunId, runs]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!inspectingRun) setInspectingRunId(null);
  }, [inspectingRun]);

  useEffect(() => {
    const node = outputRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [inspectingRun?.output]);

  if (!runs.length) return null;

  return (
    <aside className="panel headless-panel">
      <div className="panel-title headless-title">
        <span>Headless</span>
        <small>{runs.length}</small>
      </div>
      <div className="headless-list">
        {runs.map((run) => (
          <button key={run.id} className={`headless-run${run.completedAt ? ' completed' : ''}`} title={run.output || run.command} onClick={() => setInspectingRunId(run.id)}>
            <span className="headless-run-copy">
              <span className="headless-run-label">{run.label}</span>
              <small>{run.workspaceName} · {run.completedAt ? (run.timedOut ? 'Timed out' : run.exitCode === 0 ? 'Completed' : `Exited ${run.exitCode ?? '?'}`) : elapsedLabel(run.startedAt, now)}</small>
              {run.output ? <span className="headless-run-output">{run.output}</span> : null}
            </span>
            <span
              role="button"
              tabIndex={0}
              className="git-row-action git-row-undo headless-terminate"
              title={run.completedAt ? 'Delete' : 'Terminate'}
              aria-label={`${run.completedAt ? 'Delete' : 'Terminate'} ${run.label}`}
              onClick={(event) => { event.stopPropagation(); void (run.completedAt ? onDelete(run.id) : onTerminate(run.id)); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  void (run.completedAt ? onDelete(run.id) : onTerminate(run.id));
                }
              }}
            >×</span>
          </button>
        ))}
      </div>
      {inspectingRun ? (
        <div className="modal-backdrop" onMouseDown={() => setInspectingRunId(null)}>
          <div className="modal headless-output-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-title row">
              <span>{inspectingRun.label}</span>
              <button className="ghost" onClick={() => setInspectingRunId(null)}>Close</button>
            </div>
            <div className="headless-command muted">{inspectingRun.command}</div>
            <pre ref={outputRef} className="headless-output">{inspectingRun.output || 'No output yet.'}</pre>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
