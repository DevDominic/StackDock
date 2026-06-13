import { useEffect, useMemo, useState } from 'react';
import { formatKeybind } from '../../shared/keybinds';

export interface CommandAction { id: string; label: string; description?: string; keybind?: string; run(): void | Promise<void>; prompt?: { placeholder: string; run(value: string): void | Promise<void>; }; }
interface Props { open: boolean; actions: CommandAction[]; onClose(): void; }

export function CommandLauncher({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [promptAction, setPromptAction] = useState<CommandAction | null>(null);
  const filtered = useMemo(() => promptAction ? [] : actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())), [actions, promptAction, query]);

  useEffect(() => { if (open) { setQuery(''); setIndex(0); setPromptAction(null); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (promptAction) {
        if (event.key === 'Enter') { event.preventDefault(); const value = query.trim(); if (value) { void promptAction.prompt?.run(value); onClose(); } }
        return;
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, filtered.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
      if (event.key === 'Enter') { event.preventDefault(); const action = filtered[index]; if (action) { if (action.prompt) { setPromptAction(action); setQuery(''); setIndex(0); } else { void action.run(); onClose(); } } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, index, onClose, open, promptAction, query]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="launcher" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder={promptAction?.prompt?.placeholder ?? 'Run command'} />
        {promptAction ? <div className="launcher-list"><div className="launcher-empty muted">Enter to confirm, Esc to cancel.</div></div> : (
          <div className="launcher-list">
            {filtered.map((action, itemIndex) => (
              <button key={action.id} className={itemIndex === index ? 'launcher-item active' : 'launcher-item'} onMouseEnter={() => setIndex(itemIndex)} onClick={() => { if (action.prompt) { setPromptAction(action); setQuery(''); setIndex(0); } else { void action.run(); onClose(); } }}>
                <span className="launcher-item-title"><span>{action.label}</span>{action.keybind ? <kbd className="keybind-chip">{formatKeybind(action.keybind)}</kbd> : null}</span>{action.description ? <small>{action.description}</small> : null}
              </button>
            ))}
            {!filtered.length ? <div className="launcher-empty muted">No commands found.</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
