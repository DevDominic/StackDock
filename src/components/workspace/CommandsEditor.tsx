import type { PaletteCommand } from '../../shared/types';

interface Props {
  commands: PaletteCommand[];
  onChange(commands: PaletteCommand[]): void;
  /** When provided, each card gets an enabled Run button. */
  onRun?(command: PaletteCommand): void;
  /** Workspace scope: expose terminal name + auto-run on open. Off for global commands. */
  showSessionFields?: boolean;
  /** Placeholder for the CWD field (usually the workspace folder). */
  cwdPlaceholder?: string;
}

function blankCommand(): PaletteCommand {
  return { id: crypto.randomUUID(), label: 'New command', command: '' };
}

// Roomy, multi-field editor for global and per-workspace commands. Replaces the
// old one-line WorkspaceCommandsModal rows so longer commands and optional
// fields are actually readable.
export function CommandsEditor({ commands, onChange, onRun, showSessionFields = false, cwdPlaceholder }: Props) {
  function update(id: string, patch: Partial<PaletteCommand>) {
    onChange(commands.map((command) => (command.id === id ? { ...command, ...patch } : command)));
  }
  function remove(id: string) {
    onChange(commands.filter((command) => command.id !== id));
  }
  function add() {
    onChange([...commands, blankCommand()]);
  }
  function toggleAutoStart(command: PaletteCommand, checked: boolean) {
    // Auto-run fires unattended on workspace open, so confirm before enabling.
    if (checked && command.command.trim() && !window.confirm(`Run automatically when this workspace opens?\n\n${command.command}`)) return;
    update(command.id, { autoStart: checked ? true : undefined });
  }

  return (
    <div className="commands-editor">
      {commands.length === 0 ? <p className="muted config-hint">No commands yet — add one below.</p> : null}
      <div className="command-card-list">
        {commands.map((command) => (
          <div className="command-card" key={command.id}>
            <div className="command-card-head">
              <label className="field grow">
                <span>Label</span>
                <input value={command.label} onChange={(event) => update(command.id, { label: event.target.value })} placeholder="e.g. Start dev server" />
              </label>
              <div className="command-card-actions">
                <button className="ghost" disabled={!onRun || !command.command.trim()} title={onRun ? 'Run in a terminal' : 'Open a workspace to run'} onClick={() => onRun?.(command)}>Run</button>
                <button className="ghost danger" onClick={() => remove(command.id)}>Delete</button>
              </div>
            </div>
            <label className="field">
              <span>Command</span>
              <input value={command.command} onChange={(event) => update(command.id, { command: event.target.value })} placeholder="e.g. npm run dev" />
            </label>
            <div className="command-card-row">
              <label className="field grow">
                <span>Working directory <span className="muted">(optional)</span></span>
                <input value={command.cwd ?? ''} onChange={(event) => update(command.id, { cwd: event.target.value || undefined })} placeholder={cwdPlaceholder || 'Defaults to workspace folder'} />
              </label>
              {showSessionFields ? (
                <label className="field grow">
                  <span>Terminal name <span className="muted">(optional)</span></span>
                  <input value={command.terminalName ?? ''} onChange={(event) => update(command.id, { terminalName: event.target.value || undefined })} placeholder="Defaults to label" />
                </label>
              ) : null}
            </div>
            {showSessionFields ? (
              <label className="checkbox-field">
                <input type="checkbox" checked={!!command.autoStart} onChange={(event) => toggleAutoStart(command, event.target.checked)} />
                Run automatically when this workspace opens
              </label>
            ) : null}
          </div>
        ))}
      </div>
      <button className="ghost add-command" onClick={add}>+ Add command</button>
    </div>
  );
}
