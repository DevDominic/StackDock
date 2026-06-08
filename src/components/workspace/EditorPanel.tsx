import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

interface Props {
  openFiles: OpenFileTab[];
  activePath: string | null;
  onOpenFile(path: string): void;
  onChangeFile(path: string, content: string): void;
  onSaveFile(path: string): Promise<void>;
  onCloseFile(path: string): void;
}

export function EditorPanel({ openFiles, activePath, onOpenFile, onChangeFile, onSaveFile, onCloseFile }: Props) {
  const active = openFiles.find((file) => file.path === activePath) ?? null;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && active) {
        event.preventDefault();
        setSaving(true);
        await onSaveFile(active.path);
        setSaving(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onSaveFile]);

  return (
    <section className="panel editor-panel">
      <div className="panel-title row">
        <span>Editor</span>
        <span className="muted">{saving ? 'Saving...' : ''}</span>
      </div>
      <div className="tab-strip">
        {openFiles.map((file) => (
          <button key={file.path} className={file.path === activePath ? 'tab active' : 'tab'} onClick={() => onOpenFile(file.path)}>
            {file.name}
            {file.dirty ? ' •' : ''}
            <span className="tab-close" onClick={(event) => {
              event.stopPropagation();
              onCloseFile(file.path);
            }}>×</span>
          </button>
        ))}
      </div>
      {active ? (
        <div className="editor-wrap">
          <div className="editor-actions">
            <button className="primary" onClick={async () => { setSaving(true); await onSaveFile(active.path); setSaving(false); }}>
              Save
            </button>
            <button className="ghost" onClick={() => api.fs.revealInExplorer(active.path)}>
              Reveal
            </button>
          </div>
          <textarea
            className="editor"
            value={active.content}
            spellCheck={false}
            onChange={(event) => onChangeFile(active.path, event.target.value)}
          />
        </div>
      ) : (
        <div className="empty-pad muted">Open file to edit.</div>
      )}
    </section>
  );
}
