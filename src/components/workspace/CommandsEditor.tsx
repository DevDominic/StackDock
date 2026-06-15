import type { PaletteCommand } from '../../shared/types';
import { formatKeybind, normalizeKeybind } from '../../shared/keybinds';
import { usePromptDialog } from '../common/PromptProvider';

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

function KeybindInput({ value, onChange }: { value?: string; onChange(value?: string): void }) {
  return (
    <div className="keybind-editor">
      <button
        type="button"
        className="keybind-recorder"
        title="Focus, then press a key combination"
        onKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = normalizeKeybind([event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key].filter(Boolean).join('+'));
          if (next) onChange(next);
        }}
      >{value ? formatKeybind(value) : 'Record shortcut'}</button>
      {value ? <button type="button" className="ghost" onClick={() => onChange(undefined)}>Clear</button> : null}
    </div>
  );
}

// Roomy, multi-field editor for global and per-workspace commands. Replaces the
// old one-line WorkspaceCommandsModal rows so longer commands and optional
// fields are actually readable.
export function CommandsEditor({ commands, onChange, onRun, showSessionFields = false, cwdPlaceholder }: Props) {
  const promptDialog = usePromptDialog();
  function update(id: string, patch: Partial<PaletteCommand>) {
    onChange(commands.map((command) => (command.id === id ? { ...command, ...patch } : command)));
  }
  function remove(id: string) {
    onChange(commands.filter((command) => command.id !== id));
  }
  function add() {
    onChange([...commands, blankCommand()]);
  }
  async function toggleAutoStart(command: PaletteCommand, checked: boolean) {
    // Auto-run fires unattended on workspace open, so confirm before enabling.
    if (checked && command.command.trim() && !(await promptDialog.confirm({ title: 'Run automatically?', message: `This command will run when the workspace opens.\n${command.command}`, confirmLabel: 'Enable', icon: '▶' }))) return;
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
              <label className="field keybind-field">
                <span>Keybind <span className="muted">(optional)</span></span>
                <KeybindInput value={command.keybind} onChange={(keybind) => update(command.id, { keybind })} />
              </label>
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={!!command.headless} onChange={(event) => update(command.id, { headless: event.target.checked ? true : undefined })} />
              Run headlessly <span className="muted">— hide terminal, notify with final output, then close</span>
            </label>
            {showSessionFields ? (
              <label className="checkbox-field">
                <input type="checkbox" checked={!!command.autoStart} onChange={(event) => { void toggleAutoStart(command, event.target.checked); }} />
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
