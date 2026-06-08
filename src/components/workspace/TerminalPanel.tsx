import { useEffect, useRef } from 'react';
import { Terminal, type ILink } from 'xterm';
import type { StackDockSettings, TerminalSession } from '../../shared/types';
import { api } from '../../lib/api';

import 'xterm/css/xterm.css';

interface Props {
  sessions: TerminalSession[];
  activeId: string | null;
  onOpenLink?(url: string): void;
  settings?: StackDockSettings | null;
}

// URLs printed by dev servers, loggers, etc. Trailing punctuation is trimmed on
// click so "see http://localhost:5173." doesn't capture the period.
const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]}]+/g;

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function terminalThemeFromCss() {
  return {
    background: cssVar('--terminal-bg', '#000000'),
    foreground: cssVar('--terminal-fg', '#ffffff'),
    cursor: cssVar('--terminal-cursor', '#ffffff'),
    selectionBackground: cssVar('--terminal-selection', 'rgba(255,255,255,.2)'),
  };
}

export function TerminalPanel({ sessions, activeId, onOpenLink, settings }: Props) {
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  const visibleSessions = active?.splitGroupId ? sessions.filter((session) => session.splitGroupId === active.splitGroupId) : active ? [active] : [];
  const splitDirection = active?.splitDirection ?? 'row';

  return (
    <section className="terminal-workspace">
      <div className="terminal-main">
        {sessions.length ? (
          <div className={visibleSessions.length > 1 ? `terminal-views split-${splitDirection}` : 'terminal-views'}>
            {visibleSessions.map((session) => <TerminalView key={session.id} session={session} focused={session.id === active?.id} onOpenLink={onOpenLink} settings={settings} />)}
          </div>
        ) : (
          <div className="empty-pad muted">Open terminal from Sessions.</div>
        )}
      </div>
    </section>
  );
}

function TerminalView({ session, focused, onOpenLink, settings }: { session: TerminalSession; focused: boolean; onOpenLink?(url: string): void; settings?: StackDockSettings | null }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;

  const resizeTerminal = () => {
    const mount = mountRef.current;
    const terminal = terminalRef.current;
    if (!mount || !terminal) return;
    const rect = mount.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const cols = Math.max(2, Math.floor((rect.width - 16) / 8));
    const rows = Math.max(1, Math.floor((rect.height - 16) / 17));
    if (cols === terminal.cols && rows === terminal.rows) return;
    try {
      terminal.resize(cols, rows);
      void api.terminal.resize(session.id, cols, rows);
    } catch {
      // xterm can briefly lack render dimensions while a parent tab is hidden.
      // Next resize/focus retries safely.
    }
  };

  useEffect(() => {
    let disposed = false;
    let opened = false;
    let observer: ResizeObserver | null = null;

    const terminal = new Terminal({
      fontSize: settings?.terminal.fontSize ?? 14,
      fontFamily: settings?.terminal.fontFamily,
      cursorBlink: settings?.terminal.cursorBlink ?? true,
      theme: terminalThemeFromCss(),
    });
    terminalRef.current = terminal;

    const disposeData = api.onTerminalData(({ id, data }) => {
      if (id === session.id) terminal.write(data);
    });
    const disposeExit = api.onTerminalExit(({ id, exitCode }) => {
      if (id === session.id) terminal.writeln(`\r\n[process exited ${exitCode ?? 0}]`);
    });
    const dataDisposable = terminal.onData((data) => {
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
      observer = new ResizeObserver(() => window.requestAnimationFrame(() => resizeTerminal()));
      observer.observe(mountRef.current);
      resizeTerminal();
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(openFrame);
      observer?.disconnect();
      disposeData();
      disposeExit();
      dataDisposable.dispose();
      linkProvider.dispose();
      if (opened) terminal.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = terminalThemeFromCss();
    terminal.options.fontSize = settings?.terminal.fontSize ?? 14;
    terminal.options.fontFamily = settings?.terminal.fontFamily ?? 'Consolas, monospace';
    terminal.options.cursorBlink = settings?.terminal.cursorBlink ?? true;
    window.requestAnimationFrame(() => resizeTerminal());
  }, [settings?.themeId, settings?.importedThemes, settings?.terminal.fontSize, settings?.terminal.fontFamily, settings?.terminal.cursorBlink]);

  useEffect(() => {
    if (!focused) return;
    window.requestAnimationFrame(() => {
      resizeTerminal();
      terminalRef.current?.focus();
    });
  }, [focused, session.id]);

  return (
    <div className={focused ? 'terminal-shell focused' : 'terminal-shell'}>
      <div ref={mountRef} className="terminal-mount" />
    </div>
  );
}
