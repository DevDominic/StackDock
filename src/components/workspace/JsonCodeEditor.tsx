import { useEffect, useRef } from 'react';
import '../../lib/monacoEnvironment';
import * as monaco from 'monaco-editor';
import { DEFAULT_THEME_ID } from '../../lib/themeSupport';
import type { StackDockSettings } from '../../shared/types';

const CODE_FONT_FAMILY = '"Monaspace Neon", "Cascadia Code", Consolas, monospace';
const CODE_FONT_FEATURES = '"calt" on, "liga" on, "dlig" on';
const CODE_FONT_VARIATIONS = '"wght" 300, "wdth" 100';

interface Props {
  value: string;
  onChange(value: string): void;
  settings?: StackDockSettings;
  className?: string;
}

export function JsonCodeEditor({ value, onChange, settings, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const model = monaco.editor.createModel(value, 'json', monaco.Uri.parse(`stackdock-settings-json:///${crypto.randomUUID()}.json`));
    const editor = monaco.editor.create(host, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: settings?.editor.fontSize ?? 13,
      fontFamily: settings?.editor.fontFamily || CODE_FONT_FAMILY,
      fontWeight: '300',
      fontLigatures: settings?.code.ligatures === false ? false : CODE_FONT_FEATURES,
      fontVariations: CODE_FONT_VARIATIONS,
      tabSize: settings?.editor.tabSize ?? 2,
      wordWrap: settings?.editor.wordWrap ?? 'off',
      theme: settings?.themeId ?? DEFAULT_THEME_ID,
      scrollBeyondLastLine: false,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      formatOnPaste: true,
      formatOnType: true,
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    return () => { sub.dispose(); editor.dispose(); model.dispose(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: settings?.editor.fontSize ?? 13,
      fontFamily: settings?.editor.fontFamily || CODE_FONT_FAMILY,
      fontLigatures: settings?.code.ligatures === false ? false : CODE_FONT_FEATURES,
      tabSize: settings?.editor.tabSize ?? 2,
      wordWrap: settings?.editor.wordWrap ?? 'off',
      theme: settings?.themeId ?? DEFAULT_THEME_ID,
    });
  }, [settings]);

  return <div ref={hostRef} className={className ?? 'json-code-editor'} />;
}
