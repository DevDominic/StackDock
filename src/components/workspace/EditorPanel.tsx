import { useEffect, useRef, useState } from 'react';
import '../../lib/monacoEnvironment';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { api } from '../../lib/api';
import { languageFor, registerEditorSupport } from '../../lib/editorSupport';
import { DEFAULT_THEME_ID, applyTheme, registerThemes } from '../../lib/themeSupport';
import type { StackDockSettings } from '../../shared/types';

export type MediaKind = 'image' | 'audio' | 'video';

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  mediaKind?: MediaKind;
  mimeType?: string;
  dataUrl?: string;
}

export type EditorDiffMode = 'side-by-side' | 'inline' | 'compare-only';

export interface EditorDiffModel {
  path: string;
  original: string;
  staged?: boolean;
  /** Untracked/new files have no original revision, so the diff is forced to a
   *  full-width unified view rather than a half-blank split. */
  untracked?: boolean;
}

interface Props {
  openFiles: OpenFileTab[];
  activePath: string | null;
  onOpenFile(path: string): void;
  onChangeFile(path: string, content: string): void;
  onSaveFile(path: string): Promise<void>;
  onCloseFile(path: string): void;
  settings?: StackDockSettings;
  diff?: EditorDiffModel | null;
  diffMode?: EditorDiffMode;
  /** Render the built-in file tab strip. Disabled when an outer unified tab bar owns the tabs. */
  showTabs?: boolean;
  /** Whether the editor pane is currently visible. Used to force Monaco layout after tab switches. */
  visible?: boolean;
}

const CODE_FONT_FAMILY = '"Cascadia Code", Consolas, monospace';
const CODE_FONT_FEATURES = '"calt" on, "liga" on, "dlig" on';
const CODE_FONT_VARIATIONS = '"wght" 300, "wdth" 100';

function editorOptions(settings?: StackDockSettings): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
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
  };
}

function getFileModel(file: OpenFileTab) {
  const uri = monaco.Uri.file(file.path);
  let model = monaco.editor.getModel(uri);
  if (!model) model = monaco.editor.createModel(file.content, languageFor(file.path), uri);
  if (model.getValue() !== file.content) model.setValue(file.content);
  monaco.editor.setModelLanguage(model, languageFor(file.path));
  return model;
}

function getOriginalModel(file: OpenFileTab, diff: EditorDiffModel) {
  const uri = monaco.Uri.parse(`stackdock-diff-original:///${encodeURIComponent(file.path)}?${diff.staged ? 'staged' : 'unstaged'}`);
  let model = monaco.editor.getModel(uri);
  if (!model) model = monaco.editor.createModel(diff.original, languageFor(file.path), uri);
  if (model.getValue() !== diff.original) model.setValue(diff.original);
  monaco.editor.setModelLanguage(model, languageFor(file.path));
  return model;
}

function layoutEditor(editor: monaco.editor.IStandaloneCodeEditor | null, host: HTMLDivElement | null) {
  if (!editor || !host) return;
  const rect = host.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) editor.layout({ width: rect.width, height: rect.height });
  else editor.layout();
  editor.render();
}

function layoutDiffEditor(editor: monaco.editor.IStandaloneDiffEditor | null, host: HTMLDivElement | null) {
  if (!editor || !host) return;
  const rect = host.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) editor.layout({ width: rect.width, height: rect.height });
  else editor.layout();
  editor.getOriginalEditor().render();
  editor.getModifiedEditor().render();
}

function MediaPreview({ file }: { file: OpenFileTab }) {
  if (!file.dataUrl || !file.mediaKind) return <div className="empty-pad muted">Preview unavailable.</div>;
  return (
    <div className="media-preview">
      {file.mediaKind === 'image' ? <img src={file.dataUrl} alt={file.name} /> : null}
      {file.mediaKind === 'audio' ? <audio src={file.dataUrl} controls /> : null}
      {file.mediaKind === 'video' ? <video src={file.dataUrl} controls /> : null}
      <div className="media-meta muted">{file.mimeType ?? file.mediaKind}</div>
    </div>
  );
}

function changedLineDecorations(original: string, modified: string) {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const max = Math.max(originalLines.length, modifiedLines.length);
  const originalRanges: monaco.editor.IModelDeltaDecoration[] = [];
  const modifiedRanges: monaco.editor.IModelDeltaDecoration[] = [];
  for (let index = 0; index < max; index += 1) {
    if ((originalLines[index] ?? '') === (modifiedLines[index] ?? '')) continue;
    if (index < originalLines.length) {
      originalRanges.push({ range: new monaco.Range(index + 1, 1, index + 1, 1), options: { isWholeLine: true, className: 'compare-line-removed' } });
    }
    if (index < modifiedLines.length) {
      modifiedRanges.push({ range: new monaco.Range(index + 1, 1, index + 1, 1), options: { isWholeLine: true, className: 'compare-line-added' } });
    }
  }
  return { originalRanges, modifiedRanges };
}

export function EditorPanel({ openFiles, activePath, onOpenFile, onChangeFile, onSaveFile, onCloseFile, settings, diff, diffMode = 'side-by-side', showTabs = true, visible = true }: Props) {
  const active = openFiles.find((file) => file.path === activePath) ?? null;
  const activeDiff = active && !active.mediaKind && diff?.path === active.path ? diff : null;
  // An untracked/new file has no original revision to diff against. Any diff
  // mode would render a blank "Original" pane (wasting half the width) and let
  // Monaco's diff gutter draw revert arrows over non-existent lines, which
  // throws "Illegal value for lineNumber". So bypass the diff editor entirely
  // and show the new file as a plain, full-width preview in the normal editor.
  const showAsDiff = !!activeDiff && !activeDiff.untracked;
  const [saving, setSaving] = useState(false);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const diffHostRef = useRef<HTMLDivElement | null>(null);
  const compareOriginalHostRef = useRef<HTMLDivElement | null>(null);
  const compareModifiedHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const compareOriginalRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const compareModifiedRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const compareOriginalDecorationsRef = useRef<string[]>([]);
  const compareModifiedDecorationsRef = useRef<string[]>([]);
  const modelSubscriptionRef = useRef<monaco.IDisposable | null>(null);
  const activePathRef = useRef<string | null>(null);
  const onChangeFileRef = useRef(onChangeFile);

  useEffect(() => {
    onChangeFileRef.current = onChangeFile;
  }, [onChangeFile]);

  useEffect(() => {
    if (!editorHostRef.current || editorRef.current) return;
    registerEditorSupport(settings?.importedThemes ?? []);
    applyTheme(settings?.themeId ?? DEFAULT_THEME_ID, settings?.importedThemes ?? []);
    editorRef.current = monaco.editor.create(editorHostRef.current, editorOptions(settings));
    return () => {
      modelSubscriptionRef.current?.dispose();
      modelSubscriptionRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
      compareOriginalRef.current?.dispose();
      compareOriginalRef.current = null;
      compareModifiedRef.current?.dispose();
      compareModifiedRef.current = null;
    };
  }, []);

  useEffect(() => {
    registerThemes(settings?.importedThemes ?? []);
    applyTheme(settings?.themeId ?? DEFAULT_THEME_ID, settings?.importedThemes ?? []);
    const nextOptions = editorOptions(settings);
    editorRef.current?.updateOptions(nextOptions);
    diffEditorRef.current?.updateOptions({ ...nextOptions, renderSideBySide: diffMode === 'side-by-side' });
    compareOriginalRef.current?.updateOptions({ ...nextOptions, readOnly: true, lineNumbersMinChars: 3 });
    compareModifiedRef.current?.updateOptions({ ...nextOptions, lineNumbersMinChars: 3 });
  }, [settings?.editor.fontSize, settings?.editor.fontFamily, settings?.editor.tabSize, settings?.editor.wordWrap, settings?.code.ligatures, settings?.themeId, settings?.importedThemes, diffMode]);

  useEffect(() => {
    activePathRef.current = active?.path ?? null;
    const editor = editorRef.current;
    if (!editor) return;

    modelSubscriptionRef.current?.dispose();
    modelSubscriptionRef.current = null;

    if (!active || active.mediaKind) {
      editor.setModel(null);
      diffEditorRef.current?.setModel(null);
      compareOriginalRef.current?.setModel(null);
      compareModifiedRef.current?.setModel(null);
      return;
    }

    const modifiedModel = getFileModel(active);
    modelSubscriptionRef.current = modifiedModel.onDidChangeContent(() => {
      const path = activePathRef.current;
      if (path) onChangeFileRef.current(path, modifiedModel.getValue());
    });

    if (showAsDiff && activeDiff) {
      editor.setModel(null);
      const originalModel = getOriginalModel(active, activeDiff);
      if (diffMode === 'compare-only') {
        diffEditorRef.current?.setModel(null);
        if (!compareOriginalRef.current && compareOriginalHostRef.current) {
          compareOriginalRef.current = monaco.editor.create(compareOriginalHostRef.current, { ...editorOptions(settings), readOnly: true, lineNumbersMinChars: 3 });
        }
        if (!compareModifiedRef.current && compareModifiedHostRef.current) {
          compareModifiedRef.current = monaco.editor.create(compareModifiedHostRef.current, { ...editorOptions(settings), lineNumbersMinChars: 3 });
        }
        compareOriginalRef.current?.setModel(originalModel);
        compareModifiedRef.current?.setModel(modifiedModel);
        const decorations = changedLineDecorations(originalModel.getValue(), modifiedModel.getValue());
        compareOriginalDecorationsRef.current = compareOriginalRef.current?.deltaDecorations(compareOriginalDecorationsRef.current, decorations.originalRanges) ?? [];
        compareModifiedDecorationsRef.current = compareModifiedRef.current?.deltaDecorations(compareModifiedDecorationsRef.current, decorations.modifiedRanges) ?? [];
        if (visible) requestAnimationFrame(() => requestAnimationFrame(() => {
          layoutEditor(compareOriginalRef.current, compareOriginalHostRef.current);
          layoutEditor(compareModifiedRef.current, compareModifiedHostRef.current);
        }));
      } else {
        compareOriginalRef.current?.setModel(null);
        compareModifiedRef.current?.setModel(null);
        if (!diffEditorRef.current && diffHostRef.current) {
          diffEditorRef.current = monaco.editor.createDiffEditor(diffHostRef.current, {
            ...editorOptions(settings),
            renderSideBySide: diffMode === 'side-by-side',
            originalEditable: false,
          });
        }
        diffEditorRef.current?.setModel({ original: originalModel, modified: modifiedModel });
        diffEditorRef.current?.updateOptions({ renderSideBySide: diffMode === 'side-by-side' });
        if (visible) requestAnimationFrame(() => requestAnimationFrame(() => layoutDiffEditor(diffEditorRef.current, diffHostRef.current)));
      }
    } else {
      compareOriginalRef.current?.setModel(null);
      compareModifiedRef.current?.setModel(null);
      diffEditorRef.current?.setModel(null);
      editor.setModel(modifiedModel);
      if (visible) requestAnimationFrame(() => requestAnimationFrame(() => layoutEditor(editor, editorHostRef.current)));
    }
  }, [active?.path, active?.content, activeDiff?.path, activeDiff?.original, activeDiff?.staged, showAsDiff, diffMode, visible]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      layoutEditor(editorRef.current, editorHostRef.current);
      layoutDiffEditor(diffEditorRef.current, diffHostRef.current);
      layoutEditor(compareOriginalRef.current, compareOriginalHostRef.current);
      layoutEditor(compareModifiedRef.current, compareModifiedHostRef.current);
    }));
    return () => cancelAnimationFrame(frame);
  }, [visible, active?.path, activeDiff?.path, showAsDiff, diffMode]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!visible) return;
      requestAnimationFrame(() => {
        layoutEditor(editorRef.current, editorHostRef.current);
        layoutDiffEditor(diffEditorRef.current, diffHostRef.current);
        layoutEditor(compareOriginalRef.current, compareOriginalHostRef.current);
        layoutEditor(compareModifiedRef.current, compareModifiedHostRef.current);
      });
    });
    if (editorHostRef.current) observer.observe(editorHostRef.current);
    if (diffHostRef.current) observer.observe(diffHostRef.current);
    if (compareOriginalHostRef.current) observer.observe(compareOriginalHostRef.current);
    if (compareModifiedHostRef.current) observer.observe(compareModifiedHostRef.current);
    return () => observer.disconnect();
  }, [visible]);

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
    <section className={`panel editor-panel${showAsDiff ? ' diff-active' : ''}`}>
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
                <span className="tab-name">{file.name}{file.dirty ? '*' : ''}</span>
                <span className="tab-close" onClick={(event) => { event.stopPropagation(); onCloseFile(file.path); }}>
                  <span className="dot">●</span><span className="x">×</span>
                </span>
              </div>
            ))}
          </div>
          {active ? (
            <div className="editor-tab-actions">
              {saving ? <span className="muted tab-saving">Saving…</span> : null}
              <button className="ghost" onClick={() => api.fs.revealInExplorer(active.path)}>Reveal</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="editor-wrap">
        {active?.mediaKind ? <MediaPreview file={active} /> : null}
        <div ref={editorHostRef} className="monaco-host" style={{ display: !active?.mediaKind && !showAsDiff ? 'block' : 'none' }} />
        <div ref={diffHostRef} className="monaco-host monaco-diff-host" style={{ display: !active?.mediaKind && showAsDiff && diffMode !== 'compare-only' ? 'block' : 'none' }} />
        <div className="compare-only-grid" style={{ display: showAsDiff && diffMode === 'compare-only' ? 'grid' : 'none' }}>
          <div className="compare-pane"><div className="compare-pane-title muted">Original</div><div ref={compareOriginalHostRef} className="monaco-host compare-host" /></div>
          <div className="compare-pane"><div className="compare-pane-title muted">Modified</div><div ref={compareModifiedHostRef} className="monaco-host compare-host" /></div>
        </div>
        {!active ? <div className="empty-pad muted">Open file to edit.</div> : null}
      </div>
    </section>
  );
}
