import { useState } from 'react';
import type { StackDockSettings } from '../../shared/types';

interface Props { settings: StackDockSettings; onSave(settings: StackDockSettings): Promise<void>; onClose(): void; }

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const valid = draft.terminalProfiles.every((profile) => profile.name.trim() && profile.shell.trim());
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title row"><span>Settings</span><button className="ghost" onClick={onClose}>×</button></div>
        <label>Default profile<select value={draft.defaultTerminalProfileId ?? ''} onChange={(event) => setDraft({ ...draft, defaultTerminalProfileId: event.target.value })}>{draft.terminalProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label><input type="checkbox" checked={draft.confirmBeforeDiscard} onChange={(event) => setDraft({ ...draft, confirmBeforeDiscard: event.target.checked })} /> Confirm before discard</label>
        <label><input type="checkbox" checked={draft.showHiddenFiles} onChange={(event) => setDraft({ ...draft, showHiddenFiles: event.target.checked })} /> Show hidden files</label>
        <label><input type="checkbox" checked={draft.emptySessionsVisible} onChange={(event) => setDraft({ ...draft, emptySessionsVisible: event.target.checked })} /> Show empty sessions</label>
        <label><input type="checkbox" checked={draft.autoSave} onChange={(event) => setDraft({ ...draft, autoSave: event.target.checked })} /> Auto save</label>
        <label>Auto save delay (ms)<input type="number" min={200} step={100} disabled={!draft.autoSave} value={draft.autoSaveDelayMs} onChange={(event) => setDraft({ ...draft, autoSaveDelayMs: Math.max(200, Number(event.target.value) || 0) })} /></label>
        <label>Editor font size<input type="number" value={draft.editor.fontSize} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, fontSize: Number(event.target.value) } })} /></label>
        <label>Terminal font size<input type="number" value={draft.terminal.fontSize} onChange={(event) => setDraft({ ...draft, terminal: { ...draft.terminal, fontSize: Number(event.target.value) } })} /></label>
        <h3>Terminal profiles</h3>
        <div className="command-list">
          {draft.terminalProfiles.map((profile) => (
            <div className="command-row profile-row" key={profile.id}>
              <input value={profile.name} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, name: event.target.value } : item) })} placeholder="Name" />
              <input value={profile.shell} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, shell: event.target.value } : item) })} placeholder="Shell" />
              <input value={profile.args.join(' ')} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, args: event.target.value.split(' ').filter(Boolean) } : item) })} placeholder="Args" />
              <button className="ghost danger" onClick={() => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.filter((item) => item.id !== profile.id) })}>Delete</button>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button className="ghost" onClick={() => setDraft({ ...draft, terminalProfiles: [...draft.terminalProfiles, { id: crypto.randomUUID(), name: '', shell: '', args: [] }] })}>Add profile</button><button className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!valid || saving} onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); onClose(); }}>{saving ? 'Saving...' : 'Save'}</button></div>
      </div>
    </div>
  );
}
