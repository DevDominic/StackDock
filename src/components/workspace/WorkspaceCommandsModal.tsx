import { useEffect, useState } from 'react';
import type { Workspace, WorkspaceCommand } from '../../shared/types';

interface Props {
  workspace: Workspace;
  onSave(workspace: Workspace): Promise<void>;
  onRun(command: WorkspaceCommand): void;
  onClose(): void;
}

function newCommand(): WorkspaceCommand {
  return { id: crypto.randomUUID(), name: 'New command', command: '', terminalName: '', cwd: '', autoStart: false };
}

export function WorkspaceCommandsModal({ workspace, onSave, onRun, onClose }: Props) {
  const [commands, setCommands] = useState<WorkspaceCommand[]>(workspace.commands ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => setCommands(workspace.commands ?? []), [workspace.id, workspace.commands]);

  function update(id: string, patch: Partial<WorkspaceCommand>) {
    setCommands((current) => current.map((command) => (command.id === id ? { ...command, ...patch } : command)));
  }

  async function save() {
    setSaving(true);
    await onSave({ ...workspace, commands });
    setSaving(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal command-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title row"><span>Workspace commands</span><button className="ghost" onClick={onClose}>×</button></div>
        <div className="command-list">
          {commands.map((command) => (
            <div className="command-row" key={command.id}>
              <input value={command.name} onChange={(event) => update(command.id, { name: event.target.value })} placeholder="Name" />
              <input value={command.command} onChange={(event) => update(command.id, { command: event.target.value })} placeholder="Command" />
              <input value={command.terminalName ?? ''} onChange={(event) => update(command.id, { terminalName: event.target.value })} placeholder="Terminal name" />
              <input value={command.cwd ?? ''} onChange={(event) => update(command.id, { cwd: event.target.value })} placeholder="CWD (optional)" />
              <label><input type="checkbox" checked={!!command.autoStart} onChange={(event) => { const checked = event.target.checked; if (checked && !window.confirm(`Run automatically when workspace opens?\n\n${command.command}`)) return; update(command.id, { autoStart: checked }); }} /> Run automatically when workspace opens</label>
              <button className="ghost" onClick={() => onRun(command)}>Run</button>
              <button className="ghost danger" onClick={() => setCommands((current) => current.filter((item) => item.id !== command.id))}>Delete</button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={() => setCommands((current) => [...current, newCommand()])}>Add command</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
