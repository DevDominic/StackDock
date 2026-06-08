import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from 'xterm';
import type { TerminalProfile, TerminalSession } from '../../shared/types';
import { api } from '../../lib/api';

import 'xterm/css/xterm.css';

const LAST_PROFILE_KEY = 'stackdock.lastProfileId';

interface Props {
  sessions: TerminalSession[];
  activeId: string | null;
  profiles: TerminalProfile[];
  onCreate(profileId?: string, name?: string, startupCommand?: string): Promise<void>;
  onActivate(id: string): void;
  onRename(id: string, name: string): void;
  onClose(id: string): void;
}

export function TerminalPanel({ sessions, activeId, profiles, onCreate, onActivate, onRename, onClose }: Props) {
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastProfileId, setLastProfileId] = useState<string | null>(() => localStorage.getItem(LAST_PROFILE_KEY));
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the type picker on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  // "New" defaults to the last chosen profile, falling back to the first (terminal default).
  const defaultProfile = profiles.find((profile) => profile.id === lastProfileId) ?? profiles[0] ?? null;

  function createWith(profile: TerminalProfile | null) {
    if (profile) {
      setLastProfileId(profile.id);
      localStorage.setItem(LAST_PROFILE_KEY, profile.id);
    }
    void onCreate(profile?.id, profile?.name);
  }

  return (
    <section className="terminal-workspace">
      <div className="terminal-main">
        {sessions.length ? (
          <div className="terminal-views">
            {sessions.map((session) => (
              <TerminalView key={session.id} session={session} active={session.id === active?.id} onRename={onRename} />
            ))}
          </div>
        ) : (
          <div className="empty-pad muted">Open terminal.</div>
        )}
      </div>

      <aside className="session-sidebar">
        <div className="session-header">
          <strong>Sessions</strong>
          <div className="new-session" ref={menuRef}>
            <button className="new-session-main" onClick={() => createWith(defaultProfile)}>New</button>
            <button
              className="new-session-caret"
              aria-label="Choose terminal type"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ▾
            </button>
            {menuOpen ? (
              <div className="new-session-menu" role="menu">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    className="new-session-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      createWith(profile);
                    }}
                  >
                    {profile.name}
                    {profile.id === defaultProfile?.id ? <span className="check">✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="session-list">
          {sessions.map((session, index) => (
            <button key={session.id} className={session.id === active?.id ? 'session-tab active' : 'session-tab'} onClick={() => onActivate(session.id)}>
              <span className="session-index">{index + 1}</span>
              <span className="session-name">{session.name}</span>
              <span className="tab-close" onClick={(event) => {
                event.stopPropagation();
                onClose(session.id);
              }}>×</span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function TerminalView({ session, active, onRename }: { session: TerminalSession; active: boolean; onRename(id: string, name: string): void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [label, setLabel] = useState(session.name);

  useEffect(() => {
    setLabel(session.name);
  }, [session.name]);

  useEffect(() => {
    const terminal = new Terminal({
      fontSize: 14,
      cursorBlink: true,
      theme: { background: '#000000' },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    if (mountRef.current) {
      terminal.open(mountRef.current);
      fitAddon.fit();
    }

    const disposeData = api.onTerminalData(({ id, data }) => {
      if (id === session.id) terminal.write(data);
    });
    const disposeExit = api.onTerminalExit(({ id, exitCode }) => {
      if (id === session.id) terminal.writeln(`\r\n[process exited ${exitCode ?? 0}]`);
    });

    terminal.onData((data) => {
      api.terminal.write(session.id, data);
    });

    const resize = () => {
      fitAddon.fit();
      api.terminal.resize(session.id, terminal.cols, terminal.rows);
    };
    const observer = new ResizeObserver(() => resize());
    if (mountRef.current) observer.observe(mountRef.current);
    resize();

    return () => {
      observer.disconnect();
      disposeData();
      disposeExit();
      terminal.dispose();
    };
  }, [session.id]);

  useEffect(() => {
    if (!active) return;
    window.requestAnimationFrame(() => {
      fitRef.current?.fit();
      const terminal = terminalRef.current;
      if (terminal) void api.terminal.resize(session.id, terminal.cols, terminal.rows);
      terminal?.focus();
    });
  }, [active, session.id]);

  return (
    <div className="terminal-shell" style={{ display: active ? 'flex' : 'none' }}>
      <div className="terminal-meta pad">
        <input
          className="terminal-name"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => onRename(session.id, label.trim() || session.name)}
        />
        <span className="muted">{session.cwd}</span>
      </div>
      <div ref={mountRef} className="terminal-mount" />
    </div>
  );
}
