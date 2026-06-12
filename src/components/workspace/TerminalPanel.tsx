import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Terminal, type ILink, type ITerminalAddon } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { WebglAddon } from '@xterm/addon-webgl';
import { sanitizeSnapshotReplay } from '../../shared/terminalSnapshot';
import type { StackDockSettings, TerminalAttachment, TerminalAttachmentSource, TerminalSession } from '../../shared/types';
import { api } from '../../lib/api';
import { serializeTerminalAttachments, summarizeTerminalAttachments } from '../../lib/terminalAttachments';

import '@xterm/xterm/css/xterm.css';

interface Props {
  sessions: TerminalSession[];
  activeId: string | null;
  onOpenLink?(url: string): void;
  settings?: StackDockSettings | null;
  isVisible?: boolean;
  onAttachmentError?(message: string): void;
}

// URLs printed by dev servers, loggers, etc. Trailing punctuation is trimmed on
// click so "see http://localhost:5173." doesn't capture the period.
const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]}]+/g;
const CODE_FONT_FAMILY = '"Monaspace Neon", "Cascadia Code", Consolas, monospace';
const CODE_FONT_FEATURES = '"calt" on, "liga" on, "dlig" on';

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

export function TerminalPanel({ sessions, activeId, onOpenLink, settings, isVisible = true, onAttachmentError }: Props) {
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  const visibleSessions = active?.splitGroupId ? sessions.filter((session) => session.splitGroupId === active.splitGroupId) : active ? [active] : [];
  const splitDirection = active?.splitDirection ?? 'row';
  const visibleTerminalIds = isVisible ? visibleSessions.map((session) => session.id) : [];
  const visibleTerminalKey = visibleTerminalIds.join('\0');

  useEffect(() => {
    void api.terminal.setVisible(visibleTerminalIds);
    return () => { void api.terminal.setVisible([]); };
  }, [visibleTerminalKey]);

  return (
    <section className="terminal-workspace">
      <div className="terminal-main">
        {sessions.length ? (
          <div className={visibleSessions.length > 1 ? `terminal-views split-${splitDirection}` : 'terminal-views'}>
            {visibleSessions.map((session) => <TerminalView key={session.id} session={session} focused={session.id === active?.id} onOpenLink={onOpenLink} settings={settings} onAttachmentError={onAttachmentError} />)}
          </div>
        ) : (
          <div className="empty-pad muted">Open terminal from Sessions.</div>
        )}
      </div>
    </section>
  );
}

function TerminalView({ session, focused, onOpenLink, settings, onAttachmentError }: { session: TerminalSession; focused: boolean; onOpenLink?(url: string): void; settings?: StackDockSettings | null; onAttachmentError?(message: string): void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState<string | null>(null);
  const onOpenLinkRef = useRef(onOpenLink);
  const onAttachmentErrorRef = useRef(onAttachmentError);
  onOpenLinkRef.current = onOpenLink;
  onAttachmentErrorRef.current = onAttachmentError;

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
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
        return false;
      }
      return true;
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon as unknown as ITerminalAddon);
    fitAddonRef.current = fitAddon;
    const ligaturesAddon = ligaturesEnabled ? new LigaturesAddon({ fontFeatureSettings: CODE_FONT_FEATURES }) : null;
    let webglAddon: WebglAddon | null = null;
    const loadWebglRenderer = () => {
      try {
        const addon = new WebglAddon();
        // GPU context loss (driver reset, too many contexts, etc.): dispose the
        // addon and xterm falls back to the DOM renderer on its own.
        addon.onContextLoss(() => {
          addon.dispose();
          if (webglAddon === addon) webglAddon = null;
        });
        terminal.loadAddon(addon as unknown as ITerminalAddon);
        webglAddon = addon;
      } catch {
        // WebGL unavailable (headless GPU, blocklisted driver); DOM renderer remains.
      }
    };
    terminalRef.current = terminal;

    let restoredSnapshot = false;
    let replayingSnapshot = false;
    let terminalWriteFrame: number | null = null;
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
      const snapshotOutput = snapshot?.output ? sanitizeSnapshotReplay(snapshot.output) : '';
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
      if (!restoredSnapshot) queuedLiveOutput.push(data);
      else enqueueTerminalWrite(data);
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
            activate: (event: MouseEvent, clicked: string) => { event.preventDefault(); onOpenLinkRef.current?.(clicked); },
            decorations: { pointerCursor: true, underline: true },
          });
        }
        callback(links.length ? links : undefined);
      },
    });

    // Defer open by one frame. React StrictMode mounts, cleans up, then mounts
    // again in dev; opening immediately leaves xterm internal timers alive after
    // dispose and causes "reading 'dimensions'" errors.
    const openFrame = window.requestAnimationFrame(() => {
      if (disposed || !mountRef.current) return;
      terminal.open(mountRef.current);
      opened = true;
      loadWebglRenderer();
      if (ligaturesAddon) terminal.loadAddon(ligaturesAddon as unknown as ITerminalAddon);
      observer = new ResizeObserver(() => window.requestAnimationFrame(() => { void resizeTerminal(); }));
      observer.observe(mountRef.current);
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
      if (terminalWriteFrame != null) window.cancelAnimationFrame(terminalWriteFrame);
      terminalWriteQueue = [];
      disposeData();
      disposeExit();
      dataDisposable.dispose();
      linkProvider.dispose();
      webglAddon?.dispose();
      webglAddon = null;
      ligaturesAddon?.dispose();
      fitAddon.dispose();
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      if (opened) terminal.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
    };
  }, [session.id, settings?.code.ligatures, settings?.terminal.startAtBottom]);

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

  async function insertAttachmentObjects(attachments: TerminalAttachment[]) {
    if (!attachments.length) throw new Error('No attachable files found');
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

  async function insertClipboardImage() {
    try {
      const attachment = await api.attachments.saveClipboardImage('pasted-image');
      if (!attachment) return;
      await insertAttachmentObjects([attachment]);
    } catch (error) {
      reportAttachmentError(error, 'Could not paste image');
    }
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
    const hasFiles = filesFromDataTransfer(event.dataTransfer).length > 0 || Array.from(event.dataTransfer.types).includes('Files');
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
    const files = filesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    setDragOver(false);
    void insertAttachments(files, 'drop');
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      event.preventDefault();
      terminalRef.current?.paste(text);
      terminalRef.current?.focus();
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
      void navigator.clipboard.writeText(terminal.getSelection()).catch(() => undefined);
      terminal.clearSelection();
      return;
    }

    if (!event.shiftKey && key === 'v') {
      if (api.attachments.hasClipboardText()) {
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard.readText().then((text) => {
          if (text) terminal?.paste(text);
          terminal?.focus();
        }).catch(() => undefined);
        return;
      }
      if (!api.attachments.hasClipboardImage()) return;
      event.preventDefault();
      event.stopPropagation();
      void insertClipboardImage();
    }
  }

  return (
    <div
      className={`${focused ? 'terminal-shell focused' : 'terminal-shell'}${dragOver ? ' attachment-drag-over' : ''}`}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <div ref={mountRef} className="terminal-mount" />
      {attachmentStatus ? <div className="terminal-attachment-status">{attachmentStatus}</div> : null}
    </div>
  );
}
