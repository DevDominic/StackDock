import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Terminal, type ILink, type ITerminalAddon } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { sanitizeSnapshotReplay } from '../../shared/terminalSnapshot';
import type { StackDockSettings, TerminalAttachment, TerminalAttachmentSource, TerminalSession } from '../../shared/types';
import { api } from '../../lib/api';
import { removeSerializedAttachmentToken, serializeTerminalAttachments, summarizeTerminalAttachments } from '../../lib/terminalAttachments';
import { createTerminalMarkdownState, flushTerminalMarkdownState, formatTerminalMarkdownChunk, shouldFormatTerminalMarkdown } from '../../lib/terminalMarkdown';
import { useToast } from '../common/ToastProvider';

import '@xterm/xterm/css/xterm.css';

interface Props {
  sessions: TerminalSession[];
  activeId: string | null;
  onOpenLink?(url: string): void;
  settings?: StackDockSettings | null;
  isVisible?: boolean;
  onAttachmentError?(message: string): void;
  renderSmartInputActions?(session: TerminalSession, insertText: (text: string) => void): ReactNode;
}

// URLs printed by dev servers, loggers, etc. Trailing punctuation is trimmed on
// click so "see http://localhost:5173." doesn't capture the period.
const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]}]+/g;
const CODE_FONT_FAMILY = '"Cascadia Code", Consolas, monospace';
const CODE_FONT_FEATURES = '"calt" on, "liga" on, "dlig" on';
const EXPLORER_PATH_MIME = 'application/x-stackdock-explorer-path';

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function terminalThemeFromCss() {
  return {
    background: cssVar('--terminal-bg', '#000000'),
    foreground: cssVar('--terminal-fg', '#ffffff'),
    cursor: cssVar('--terminal-cursor', '#ffffff'),
    selectionBackground: cssVar('--terminal-selection', 'rgba(255,255,255,.2)'),
    black: cssVar('--terminal-ansi-black', '#000000'),
    red: cssVar('--terminal-ansi-red', '#cd3131'),
    green: cssVar('--terminal-ansi-green', '#0dbc79'),
    yellow: cssVar('--terminal-ansi-yellow', '#e5e510'),
    blue: cssVar('--terminal-ansi-blue', '#2472c8'),
    magenta: cssVar('--terminal-ansi-magenta', '#bc3fbc'),
    cyan: cssVar('--terminal-ansi-cyan', '#11a8cd'),
    white: cssVar('--terminal-ansi-white', '#e5e5e5'),
    brightBlack: cssVar('--terminal-ansi-bright-black', '#666666'),
    brightRed: cssVar('--terminal-ansi-bright-red', '#f14c4c'),
    brightGreen: cssVar('--terminal-ansi-bright-green', '#23d18b'),
    brightYellow: cssVar('--terminal-ansi-bright-yellow', '#f5f543'),
    brightBlue: cssVar('--terminal-ansi-bright-blue', '#3b8eea'),
    brightMagenta: cssVar('--terminal-ansi-bright-magenta', '#d670d6'),
    brightCyan: cssVar('--terminal-ansi-bright-cyan', '#29b8db'),
    brightWhite: cssVar('--terminal-ansi-bright-white', '#e5e5e5'),
  };
}

function getCliCursorVisibilityState(data: string, previousTail: string) {
  const text = `${previousTail}${data}`;
  const altEnter = /\x1b\[\?(?:47|1047|1048|1049)h/.test(text);
  const altExit = /\x1b\[\?(?:47|1047|1048|1049)l/.test(text);
  const cursorHidden = /\x1b\[\?25l/.test(text);
  const cursorShown = /\x1b\[\?25h/.test(text);
  return {
    altScreen: altEnter ? true : altExit ? false : undefined,
    appCursorHidden: cursorHidden ? true : cursorShown ? false : undefined,
    tail: text.slice(-32),
  };
}

export function TerminalPanel({ sessions, activeId, onOpenLink, settings, isVisible = true, onAttachmentError, renderSmartInputActions }: Props) {
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  const visibleSessions = active?.splitGroupId ? sessions.filter((session) => session.splitGroupId === active.splitGroupId) : active ? [active] : [];
  const splitDirection = active?.splitDirection ?? 'row';

  return (
    <section className="terminal-workspace">
      <div className="terminal-main">
        {sessions.length ? (
          <div className={visibleSessions.length > 1 ? `terminal-views split-${splitDirection}` : 'terminal-views'}>
            {visibleSessions.map((session) => <TerminalView key={session.id} session={session} focused={session.id === active?.id} onOpenLink={onOpenLink} settings={settings} onAttachmentError={onAttachmentError} renderSmartInputActions={renderSmartInputActions} />)}
          </div>
        ) : (
          <div className="empty-pad muted">Open terminal from Sessions.</div>
        )}
      </div>
    </section>
  );
}

function TerminalView({ session, focused, onOpenLink, settings, onAttachmentError, renderSmartInputActions }: { session: TerminalSession; focused: boolean; onOpenLink?(url: string): void; settings?: StackDockSettings | null; onAttachmentError?(message: string): void; renderSmartInputActions?(session: TerminalSession, insertText: (text: string) => void): ReactNode }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const smartInputTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const smartInputHoldRef = useRef<{ key: string; startedAt: number } | null>(null);
  const { showToast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState<string | null>(null);
  const [smartInputText, setSmartInputText] = useState('');
  const [stagedAttachments, setStagedAttachments] = useState<Array<TerminalAttachment & { token: string; thumbUrl?: string }>>([]);
  const [terminalMenu, setTerminalMenu] = useState<{ x: number; y: number; canCopy: boolean; canPaste: boolean } | null>(null);
  const [hideTerminalCursor, setHideTerminalCursor] = useState(false);
  const cliCursorStateRef = useRef({ altScreen: false, appCursorHidden: false, tail: '' });
  const onOpenLinkRef = useRef(onOpenLink);
  const onAttachmentErrorRef = useRef(onAttachmentError);
  onOpenLinkRef.current = onOpenLink;
  onAttachmentErrorRef.current = onAttachmentError;
  const smartInputEnabled = settings?.terminal.smartInput?.enabled === true;
  const smartInputEnterToSend = settings?.terminal.smartInput?.enterToSend !== false;
  const smartInputSendEnter = settings?.terminal.smartInput?.sendEnter === true;

  const resizeTerminal = async () => {
    const mount = mountRef.current;
    const terminal = terminalRef.current;
    if (!mount || !terminal) return;
    const rect = mount.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    try {
      fitAddonRef.current?.fit();
      await api.terminal.resize(session.id, terminal.cols, terminal.rows);
    } catch {
      // xterm can briefly lack render dimensions while a parent tab is hidden.
      // Next resize/focus retries safely.
    }
  };

  useEffect(() => {
    let disposed = false;
    let opened = false;
    let observer: ResizeObserver | null = null;

    const ligaturesEnabled = settings?.code.ligatures !== false;
    const startAtBottom = settings?.terminal.startAtBottom === true;
    const terminal = new Terminal({
      fontSize: settings?.terminal.fontSize ?? 14,
      fontFamily: settings?.terminal.fontFamily || CODE_FONT_FAMILY,
      fontWeight: '300',
      fontWeightBold: '300',
      allowProposedApi: true,
      cursorBlink: settings?.terminal.cursorBlink ?? true,
      theme: terminalThemeFromCss(),
    });
    // Let app-level shortcuts win over the shell: returning false stops xterm
    // from sending the key to the PTY (no stray ^P), while the DOM event still
    // bubbles to the window handler that opens the session switcher.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        void api.terminal.write(session.id, '\x1b[13;2u');
        return false;
      }
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
        return false;
      }
      return true;
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon as unknown as ITerminalAddon);
    fitAddonRef.current = fitAddon;
    const ligaturesAddon = ligaturesEnabled ? new LigaturesAddon({ fontFeatureSettings: CODE_FONT_FEATURES }) : null;
    terminalRef.current = terminal;

    let restoredSnapshot = false;
    let replayingSnapshot = false;
    let terminalWriteFrame: number | null = null;
    const markdownFormattingEnabled = settings?.terminal.markdownFormatting !== false && shouldFormatTerminalMarkdown(session);
    const markdownState = createTerminalMarkdownState();
    const formatDisplayOutput = (data: string) => markdownFormattingEnabled ? formatTerminalMarkdownChunk(data, markdownState) + flushTerminalMarkdownState(markdownState) : data;
    let terminalWriteInProgress = false;
    let terminalWriteQueue: string[] = [];
    const queuedLiveOutput: string[] = [];
    const flushTerminalWriteQueue = () => {
      terminalWriteFrame = null;
      if (disposed || terminalWriteInProgress || !terminalWriteQueue.length) return;
      const data = terminalWriteQueue.join('');
      terminalWriteQueue = [];
      terminalWriteInProgress = true;
      terminal.write(data, () => {
        terminalWriteInProgress = false;
        if (!disposed && terminalWriteQueue.length && terminalWriteFrame == null) {
          terminalWriteFrame = window.requestAnimationFrame(flushTerminalWriteQueue);
        }
      });
    };
    const enqueueTerminalWrite = (data: string) => {
      if (!data) return;
      terminalWriteQueue.push(data);
      if (!terminalWriteInProgress && terminalWriteFrame == null) {
        terminalWriteFrame = window.requestAnimationFrame(flushTerminalWriteQueue);
      }
    };
    const flushLiveOutput = () => {
      restoredSnapshot = true;
      while (queuedLiveOutput.length) enqueueTerminalWrite(queuedLiveOutput.shift()!);
    };
    // Hold the replay until xterm is opened and fitted: writing while the
    // terminal is still at its default 80x24 wraps the snapshot at the wrong
    // column and counts the rows padding below against the wrong viewport.
    let markOpenedAndFitted!: () => void;
    const openedAndFitted = new Promise<void>((resolve) => { markOpenedAndFitted = resolve; });
    void openedAndFitted.then(() => api.terminal.snapshot(session.restoreId ?? session.id)).then((snapshot) => {
      if (disposed) return;
      const snapshotOutput = snapshot?.output ? formatDisplayOutput(sanitizeSnapshotReplay(snapshot.output)) : '';
      const finishReplay = () => {
        replayingSnapshot = false;
        if (disposed) return;
        void api.terminal.ready(session.id).catch(() => undefined);
        flushLiveOutput();
      };
      if (snapshotOutput) {
        // Replay bypasses the rAF queue so the write callback marks exactly when
        // parsing finished; onData stays muted until then so xterm's answers to
        // any replayed queries never reach the live pty as input.
        // The snapshot is the main process's serialized headless buffer at the
        // real fitted geometry, including the restored-scrollback separator,
        // resume notice, and blank viewport that protect against ConPTY's CUP
        // 1;1 repaint — so it is written verbatim.
        replayingSnapshot = true;
        terminal.write(snapshotOutput, finishReplay);
      } else if (startAtBottom) {
        replayingSnapshot = true;
        terminal.write('\r\n'.repeat(Math.max(0, terminal.rows - 1)), finishReplay);
      } else {
        finishReplay();
      }
    }).catch(() => {
      if (!disposed) {
        void api.terminal.ready(session.id).catch(() => undefined);
        flushLiveOutput();
      }
    });

    const disposeData = api.onTerminalData(({ id, data }) => {
      if (id !== session.id) return;
      const nextCliCursorState = getCliCursorVisibilityState(data, cliCursorStateRef.current.tail);
      cliCursorStateRef.current = {
        altScreen: nextCliCursorState.altScreen ?? cliCursorStateRef.current.altScreen,
        appCursorHidden: nextCliCursorState.appCursorHidden ?? cliCursorStateRef.current.appCursorHidden,
        tail: nextCliCursorState.tail,
      };
      const shouldHideCursor = cliCursorStateRef.current.altScreen || cliCursorStateRef.current.appCursorHidden;
      setHideTerminalCursor((current) => current === shouldHideCursor ? current : shouldHideCursor);
      const displayData = formatDisplayOutput(data);
      if (!restoredSnapshot) queuedLiveOutput.push(displayData);
      else enqueueTerminalWrite(displayData);
    });
    const disposeExit = api.onTerminalExit(({ id, exitCode }) => {
      if (id === session.id) enqueueTerminalWrite(`\r\n[process exited ${exitCode ?? 0}]`);
    });
    const dataDisposable = terminal.onData((data) => {
      if (replayingSnapshot) return;
      void api.terminal.write(session.id, data);
    });
    const linkProvider = terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) return callback(undefined);
        const text = line.translateToString(true);
        const links: ILink[] = [];
        URL_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = URL_PATTERN.exec(text)) !== null) {
          const url = match[0].replace(/[.,;:!?)\]}'"]+$/, '');
          if (!url) continue;
          const startX = match.index + 1;
          links.push({
            text: url,
            range: { start: { x: startX, y: bufferLineNumber }, end: { x: startX + url.length - 1, y: bufferLineNumber } },
            activate: (event: MouseEvent, clicked: string) => {
              event.preventDefault();
              if (event.ctrlKey || event.metaKey) {
                void api.shell.openExternal(clicked).catch(() => undefined);
                return;
              }
              onOpenLinkRef.current?.(clicked);
            },
            decorations: { pointerCursor: true, underline: true },
          });
        }
        callback(links.length ? links : undefined);
      },
    });

    const settleFit = () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => { void resizeTerminal(); }));

    // Defer open by one frame. React StrictMode mounts, cleans up, then mounts
    // again in dev; opening immediately leaves xterm internal timers alive after
    // dispose and causes "reading 'dimensions'" errors.
    const openFrame = window.requestAnimationFrame(() => {
      if (disposed || !mountRef.current) return;
      terminal.open(mountRef.current);
      opened = true;
      if (ligaturesAddon) terminal.loadAddon(ligaturesAddon as unknown as ITerminalAddon);
      observer = new ResizeObserver(() => window.requestAnimationFrame(() => { void resizeTerminal(); }));
      observer.observe(mountRef.current);
      settleFit();
      document.fonts?.ready.then(() => { if (!disposed) settleFit(); }).catch(() => undefined);
      document.fonts?.addEventListener('loadingdone', settleFit);
      void resizeTerminal().finally(() => {
        if (!disposed) markOpenedAndFitted();
      });
    });

    return () => {
      disposed = true;
      // Settle the gate so the pending replay Promise.all can't outlive the view.
      markOpenedAndFitted();
      window.cancelAnimationFrame(openFrame);
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', settleFit);
      if (terminalWriteFrame != null) window.cancelAnimationFrame(terminalWriteFrame);
      terminalWriteQueue = [];
      disposeData();
      disposeExit();
      cliCursorStateRef.current = { altScreen: false, appCursorHidden: false, tail: '' };
      setHideTerminalCursor(false);
      dataDisposable.dispose();
      linkProvider.dispose();
      ligaturesAddon?.dispose();
      fitAddon.dispose();
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      if (opened) terminal.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
    };
  }, [session.id, settings?.code.ligatures, settings?.terminal.startAtBottom, settings?.terminal.markdownFormatting]);

  useEffect(() => {
    onAttachmentErrorRef.current = onAttachmentError;
  }, [onAttachmentError]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = terminalThemeFromCss();
    terminal.options.fontSize = settings?.terminal.fontSize ?? 14;
    terminal.options.fontFamily = settings?.terminal.fontFamily || CODE_FONT_FAMILY;
    terminal.options.fontWeight = '300';
    terminal.options.fontWeightBold = '300';
    terminal.options.cursorBlink = settings?.terminal.cursorBlink ?? true;
    window.requestAnimationFrame(() => { void resizeTerminal(); });
  }, [settings?.themeId, settings?.importedThemes, settings?.terminal.fontSize, settings?.terminal.fontFamily, settings?.terminal.cursorBlink]);

  useEffect(() => {
    if (!focused) return;
    window.requestAnimationFrame(() => {
      void resizeTerminal();
      terminalRef.current?.focus();
    });
  }, [focused, session.id]);

  function showAttachmentStatus(message: string) {
    setAttachmentStatus(message);
    window.setTimeout(() => setAttachmentStatus((current) => current === message ? null : current), 2600);
  }

  function reportAttachmentError(error: unknown, fallback = 'Could not attach file') {
    const message = error instanceof Error ? error.message : String(error || fallback);
    setAttachmentStatus(message);
    onAttachmentErrorRef.current?.(message);
  }

  async function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read pasted image'));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read pasted image'));
      reader.readAsDataURL(file);
    });
  }

  async function attachmentFromFile(file: File, source: TerminalAttachmentSource): Promise<TerminalAttachment | null> {
    const filePath = api.attachments.getPathForFile(file);
    if (filePath) return api.attachments.inspectPath(filePath, source);
    if (file.type.toLowerCase().startsWith('image/')) return api.attachments.savePastedImage(await fileToDataUrl(file), file.name || 'pasted-image');
    return null;
  }

  function insertSmartInputText(text: string) {
    if (!text) return;
    setSmartInputText((current) => `${current}${text}`);
  }

  async function sendSmartInput() {
    if (!smartInputText) return;
    await api.terminal.write(session.id, smartInputSendEnter ? `${smartInputText}\r` : smartInputText);
    setSmartInputText('');
    setStagedAttachments([]);
    window.requestAnimationFrame(() => smartInputTextareaRef.current?.focus());
  }

  function stageAttachmentObjects(attachments: TerminalAttachment[]) {
    if (!attachments.length) throw new Error('No attachable files found');
    const staged = attachments.map((attachment) => ({
      ...attachment,
      token: serializeTerminalAttachments([attachment], { formatter: 'auto' }),
      thumbUrl: attachment.isImage ? api.attachments.readImageThumbnailDataUrl(attachment.path) || undefined : undefined,
    }));
    setStagedAttachments((current) => [...current, ...staged]);
    setSmartInputText((current) => `${current}${staged.map((attachment) => attachment.token).join('')}`);
    showAttachmentStatus(summarizeTerminalAttachments(attachments));
  }

  async function insertAttachmentObjects(attachments: TerminalAttachment[]) {
    if (!attachments.length) throw new Error('No attachable files found');
    if (smartInputEnabled) {
      stageAttachmentObjects(attachments);
      return;
    }
    const text = serializeTerminalAttachments(attachments, { formatter: 'auto' });
    await api.terminal.write(session.id, text);
    terminalRef.current?.focus();
    showAttachmentStatus(summarizeTerminalAttachments(attachments));
  }

  async function insertAttachments(files: File[], source: TerminalAttachmentSource) {
    if (!files.length) return;
    try {
      const attachments = (await Promise.all(files.map((file) => attachmentFromFile(file, source)))).filter(Boolean) as TerminalAttachment[];
      await insertAttachmentObjects(attachments);
    } catch (error) {
      reportAttachmentError(error);
    }
  }

  async function insertAttachmentPaths(paths: string[]) {
    if (!paths.length) return;
    try {
      const attachments = await Promise.all(paths.map((targetPath) => api.attachments.inspectPath(targetPath, 'drop')));
      await insertAttachmentObjects(attachments);
    } catch (error) {
      reportAttachmentError(error);
    }
  }

  function explorerPathsFromDataTransfer(dataTransfer: DataTransfer | null) {
    const raw = dataTransfer?.getData(EXPLORER_PATH_MIME);
    if (!raw) return [];
    try {
      const entry = JSON.parse(raw) as { path?: unknown; isDirectory?: unknown };
      if (typeof entry.path !== 'string' || !entry.path.trim()) return [];
      return [entry.path];
    } catch {
      return [];
    }
  }

  function clipboardHasPasteableContent() {
    return api.attachments.hasClipboardText() || api.attachments.hasClipboardImage();
  }

  async function copySelection() {
    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) {
      showToast('No terminal selection to copy', 'info');
      return false;
    }

    try {
      api.attachments.writeClipboardText(terminal.getSelection());
      terminal.clearSelection();
      terminal.focus();
      showToast('Copied terminal selection', 'success');
      return true;
    } catch {
      terminal.focus();
      showToast('Could not copy terminal selection', 'error');
      return false;
    }
  }

  function attachmentTextMarkers(attachment: TerminalAttachment & { token: string }) {
    const quotedReference = serializeTerminalAttachments([attachment], { formatter: 'auto', trailingText: '' });
    return [attachment.token.trim(), quotedReference, attachment.referencePath, attachment.path, attachment.originalPath].filter(Boolean) as string[];
  }

  function textContainsAttachment(text: string, attachment: TerminalAttachment & { token: string }) {
    return attachmentTextMarkers(attachment).some((marker) => text.includes(marker));
  }

  function removeStagedAttachment(id: string) {
    const target = stagedAttachments.find((attachment) => attachment.id === id);
    if (!target) return;
    setStagedAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setSmartInputText((current) => removeSerializedAttachmentToken(current, target.token));
  }

  function openStagedAttachment(attachment: TerminalAttachment) {
    void api.shell.openPath(attachment.path).catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'));
  }

  async function insertClipboardImage() {
    try {
      const attachment = await api.attachments.saveClipboardImage('pasted-image');
      if (!attachment) return false;
      await insertAttachmentObjects([attachment]);
      return true;
    } catch (error) {
      reportAttachmentError(error, 'Could not paste image');
      return false;
    }
  }

  async function pasteClipboard() {
    const terminal = terminalRef.current;
    if (api.attachments.hasClipboardText()) {
      try {
        const text = api.attachments.readClipboardText();
        if (text) {
          if (smartInputEnabled) insertSmartInputText(text);
          else {
            terminal?.paste(text);
            terminal?.focus();
          }
          showToast('Pasted from clipboard', 'success');
          return true;
        }
      } catch {
        terminal?.focus();
        showToast('Could not paste from clipboard', 'error');
        return false;
      }
    } else if (api.attachments.hasClipboardImage()) {
      const attached = await insertClipboardImage();
      if (attached) showToast('Attached clipboard image', 'success');
      terminal?.focus();
      return attached;
    }

    terminal?.focus();
    showToast('Clipboard is empty', 'info');
    return false;
  }

  function filesFromDataTransfer(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) return [];
    const itemFiles = Array.from(dataTransfer.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];
    return itemFiles.length ? itemFiles : Array.from(dataTransfer.files ?? []);
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    const hasExplorerPath = Array.from(event.dataTransfer.types).includes(EXPLORER_PATH_MIME);
    const hasFiles = hasExplorerPath || filesFromDataTransfer(event.dataTransfer).length > 0 || Array.from(event.dataTransfer.types).includes('Files');
    if (!hasFiles) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const explorerPaths = explorerPathsFromDataTransfer(event.dataTransfer);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (!explorerPaths.length && !files.length) return;
    event.preventDefault();
    setDragOver(false);
    if (explorerPaths.length) void insertAttachmentPaths(explorerPaths);
    else void insertAttachments(files, 'drop');
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.terminal-smart-input')) return;
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      event.preventDefault();
      if (smartInputEnabled) insertSmartInputText(text);
      else {
        terminalRef.current?.paste(text);
        terminalRef.current?.focus();
      }
      return;
    }
    const files = filesFromDataTransfer(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void insertAttachments(files, 'paste-file');
  }

  function handleKeyDownCapture(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const terminal = terminalRef.current;

    if (!event.shiftKey && key === 'c' && terminal?.hasSelection()) {
      event.preventDefault();
      event.stopPropagation();
      void copySelection();
      return;
    }

    if (!event.shiftKey && key === 'v' && clipboardHasPasteableContent()) {
      event.preventDefault();
      event.stopPropagation();
      void pasteClipboard();
    }
  }

  function handleSmartInputPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = filesFromDataTransfer(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void insertAttachments(files, 'paste-file');
  }

  function setSmartInputSelection(start: number, end = start) {
    window.requestAnimationFrame(() => smartInputTextareaRef.current?.setSelectionRange(start, end));
  }

  function moveSmartInputCaretByLine(textarea: HTMLTextAreaElement, direction: -1 | 1) {
    const text = textarea.value;
    const pos = textarea.selectionStart;
    const lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    const column = pos - lineStart;
    if (direction < 0) {
      if (lineStart === 0) return 0;
      const previousLineEnd = lineStart - 1;
      const previousLineStart = text.lastIndexOf('\n', Math.max(0, previousLineEnd - 1)) + 1;
      return Math.min(previousLineStart + column, previousLineEnd);
    }
    const lineEnd = text.indexOf('\n', pos);
    if (lineEnd < 0) return text.length;
    const nextLineEnd = text.indexOf('\n', lineEnd + 1);
    return Math.min(lineEnd + 1 + column, nextLineEnd < 0 ? text.length : nextLineEnd);
  }

  function accelerateSmartInputNavigation(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const editableKeys = new Set(['Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    if (!editableKeys.has(event.key) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      smartInputHoldRef.current = null;
      return false;
    }
    const now = performance.now();
    const hold = smartInputHoldRef.current?.key === event.key ? smartInputHoldRef.current : { key: event.key, startedAt: now };
    smartInputHoldRef.current = hold;
    if (!event.repeat || now - hold.startedAt < 420) return false;

    event.preventDefault();
    const textarea = event.currentTarget;
    const step = now - hold.startedAt > 1200 ? 12 : 5;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (event.key === 'Backspace') {
      const deleteStart = start === end ? Math.max(0, start - step) : start;
      const next = `${textarea.value.slice(0, deleteStart)}${textarea.value.slice(end)}`;
      setSmartInputText(next);
      setSmartInputSelection(deleteStart);
      return true;
    }

    const nextPosition = event.key === 'ArrowLeft'
      ? Math.max(0, start - step)
      : event.key === 'ArrowRight'
        ? Math.min(textarea.value.length, end + step)
        : moveSmartInputCaretByLine(textarea, event.key === 'ArrowUp' ? -1 : 1);
    setSmartInputSelection(nextPosition);
    return true;
  }

  function handleSmartInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (accelerateSmartInputNavigation(event)) return;
    if (event.key !== 'Enter' || !smartInputEnterToSend || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    void sendSmartInput();
  }

  function handleSmartInputKeyUp() {
    smartInputHoldRef.current = null;
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 180;
    const menuHeight = 90;
    const rect = event.currentTarget.getBoundingClientRect();
    setTerminalMenu({
      x: Math.min(Math.max(0, event.clientX - rect.left), Math.max(0, rect.width - menuWidth)),
      y: Math.min(Math.max(0, event.clientY - rect.top), Math.max(0, rect.height - menuHeight)),
      canCopy: !!terminalRef.current?.hasSelection(),
      canPaste: clipboardHasPasteableContent(),
    });
    terminalRef.current?.focus();
  }

  useEffect(() => {
    if (!stagedAttachments.length) return;
    const nextAttachments = stagedAttachments.filter((attachment) => textContainsAttachment(smartInputText, attachment));
    if (nextAttachments.length !== stagedAttachments.length) setStagedAttachments(nextAttachments);
  }, [smartInputText, stagedAttachments]);

  useEffect(() => {
    if (!terminalMenu) return;
    const close = () => setTerminalMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [terminalMenu]);

  return (
    <div
      className={`${focused ? 'terminal-shell focused' : 'terminal-shell'}${dragOver ? ' attachment-drag-over' : ''}${hideTerminalCursor ? ' hide-terminal-cursor' : ''}`}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onKeyDownCapture={handleKeyDownCapture}
      onContextMenu={handleContextMenu}
      onMouseDown={() => terminalRef.current?.focus()}
    >
      <div className="terminal-mount">
        <div ref={mountRef} className="terminal-xterm-inner" />
      </div>
      {smartInputEnabled ? (
        <div className="terminal-smart-input" onMouseDown={(event) => event.stopPropagation()}>
          {stagedAttachments.length ? (
            <div className="terminal-smart-input-chips ws-chips" aria-label="Staged attachments">
              {stagedAttachments.map((attachment) => (
                <span key={attachment.id} className={`terminal-smart-input-chip chip${attachment.thumbUrl ? ' image' : ''}`} title={`${attachment.path}\nDouble-click to open`} onDoubleClick={() => openStagedAttachment(attachment)}>
                  {attachment.thumbUrl ? <img className="terminal-smart-input-chip-thumb" src={attachment.thumbUrl} alt="" /> : <span aria-hidden>{attachment.isDirectory ? '📁' : attachment.isImage ? '🖼️' : '📄'}</span>}
                  <span className="terminal-smart-input-chip-name">{attachment.name}</span>
                  <button type="button" className="terminal-smart-input-chip-remove" aria-label={`Remove ${attachment.name}`} onClick={() => removeStagedAttachment(attachment.id)}>×</button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="terminal-smart-input-row">
            <textarea
              ref={smartInputTextareaRef}
              className="terminal-smart-input-textarea"
              value={smartInputText}
              rows={1}
              placeholder={smartInputEnterToSend ? `Type a command… Enter to ${smartInputSendEnter ? 'run' : 'send'}, Shift+Enter for newline` : `Type a command… Click Send to ${smartInputSendEnter ? 'run' : 'send'}`}
              onChange={(event) => setSmartInputText(event.target.value)}
              onKeyDown={handleSmartInputKeyDown}
              onKeyUp={handleSmartInputKeyUp}
              onBlur={handleSmartInputKeyUp}
              onPaste={handleSmartInputPaste}
            />
            <div className="terminal-smart-input-actions">
              {renderSmartInputActions?.(session, insertSmartInputText)}
              <button className="primary" disabled={!smartInputText} onClick={() => void sendSmartInput()}>Send</button>
            </div>
          </div>
        </div>
      ) : null}
      {attachmentStatus ? <div className="terminal-attachment-status">{attachmentStatus}</div> : null}
      {terminalMenu ? (
        <div className="context-menu terminal-context-menu" style={{ top: terminalMenu.y, left: terminalMenu.x }} onMouseDown={(event) => event.stopPropagation()}>
          <button className="context-menu-item" disabled={!terminalMenu.canCopy} onClick={() => { setTerminalMenu(null); void copySelection(); }}>Copy</button>
          <button className="context-menu-item" disabled={!terminalMenu.canPaste} onClick={() => { setTerminalMenu(null); void pasteClipboard(); }}>Paste</button>
        </div>
      ) : null}
    </div>
  );
}
