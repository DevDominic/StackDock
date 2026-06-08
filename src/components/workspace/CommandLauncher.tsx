import { useEffect, useMemo, useState } from 'react';

export interface CommandAction { id: string; label: string; description?: string; run(): void | Promise<void>; }
interface Props { open: boolean; actions: CommandAction[]; onClose(): void; }

export function CommandLauncher({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const filtered = useMemo(() => actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())), [actions, query]);

  useEffect(() => { if (open) { setQuery(''); setIndex(0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, filtered.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
      if (event.key === 'Enter') { event.preventDefault(); const action = filtered[index]; if (action) { void action.run(); onClose(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, index, onClose, open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="launcher" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder="Run command" />
        <div className="launcher-list">
          {filtered.map((action, itemIndex) => (
            <button key={action.id} className={itemIndex === index ? 'launcher-item active' : 'launcher-item'} onMouseEnter={() => setIndex(itemIndex)} onClick={() => { void action.run(); onClose(); }}>
              <span>{action.label}</span>{action.description ? <small>{action.description}</small> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
