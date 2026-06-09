import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Props {
  title?: string;
  subtitle?: string;
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    const update = () => { void api.app.isWindowMaximized().then((value) => { if (active) setMaximized(value); }).catch(() => undefined); };
    update();
    window.addEventListener('resize', update);
    return () => { active = false; window.removeEventListener('resize', update); };
  }, []);

  async function toggleMaximize() {
    setMaximized(await api.app.toggleMaximizeWindow());
  }

  return (
    <div className="window-controls">
      <button className="window-control" onClick={() => void api.app.minimizeWindow()} title="Minimize" aria-label="Minimize">—</button>
      <button className="window-control" onClick={() => void toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore' : 'Maximize'}>{maximized ? '❐' : '□'}</button>
      <button className="window-control close" onClick={() => void api.app.closeWindow()} title="Close" aria-label="Close">×</button>
    </div>
  );
}

export function TitleBar({ title = 'StackDock', subtitle }: Props) {
  return (
    <header className="window-titlebar">
      <div className="window-titlebar-drag">
        <div className="window-titlebar-brand" aria-hidden>⚓</div>
        <div className="window-titlebar-copy">
          <div className="window-titlebar-title">{title}</div>
          {subtitle ? <div className="window-titlebar-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <WindowControls />
    </header>
  );
}
