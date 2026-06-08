import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
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
  /** Render the built-in file tab strip. Disabled when an outer unified tab bar owns the tabs. */
  showTabs?: boolean;
}

function languageFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  if (ext === 'css') return 'css';
  if (ext === 'html') return 'html';
  return 'plaintext';
}

export function EditorPanel({ openFiles, activePath, onOpenFile, onChangeFile, onSaveFile, onCloseFile, showTabs = true }: Props) {
  const active = openFiles.find((file) => file.path === activePath) ?? null;
  const [saving, setSaving] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activePathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hostRef.current || editorRef.current) return;
    editorRef.current = monaco.editor.create(hostRef.current, {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      theme: 'vs-dark',
      scrollBeyondLastLine: false,
    });
    const sub = editorRef.current.onDidChangeModelContent(() => {
      const path = activePathRef.current;
      if (path) onChangeFile(path, editorRef.current?.getValue() ?? '');
    });
    return () => {
      sub.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [onChangeFile]);

  useEffect(() => {
    activePathRef.current = active?.path ?? null;
    const editor = editorRef.current;
    if (!editor) return;
    if (!active) {
      editor.setModel(null);
      return;
    }
    const uri = monaco.Uri.file(active.path);
    let model = monaco.editor.getModel(uri);
    if (!model) model = monaco.editor.createModel(active.content, languageFor(active.path), uri);
    if (model.getValue() !== active.content) model.setValue(active.content);
    monaco.editor.setModelLanguage(model, languageFor(active.path));
    editor.setModel(model);
  }, [active?.path, active?.content]);

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
      {showTabs ? (
        <div className="editor-tabbar">
          <div className="tab-strip">
            {openFiles.map((file) => (
              <div
                key={file.path}
                className={`tab${file.path === activePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}`}
                title={file.path}
                onClick={() => onOpenFile(file.path)}
                onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); onCloseFile(file.path); } }}
              >
                <span className="tab-name">{file.name}</span>
                <span className="tab-close" onClick={(event) => { event.stopPropagation(); onCloseFile(file.path); }}>
                  <span className="dot">●</span><span className="x">×</span>
                </span>
              </div>
            ))}
          </div>
          {active ? (
            <div className="editor-tab-actions">
              {saving ? <span className="muted tab-saving">Saving…</span> : null}
              <button className="ghost" onClick={async () => { setSaving(true); await onSaveFile(active.path); setSaving(false); }}>Save</button>
              <button className="ghost" onClick={() => api.fs.revealInExplorer(active.path)}>Reveal</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="editor-wrap"><div ref={hostRef} className="monaco-host" />{!active ? <div className="empty-pad muted">Open file to edit.</div> : null}</div>
    </section>
  );
}
