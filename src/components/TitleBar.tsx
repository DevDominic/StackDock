import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { WindowControlsPosition, WindowPlatform } from '../shared/types';

interface Props {
  title?: string;
  subtitle?: string;
}

function readWindowControlsLayout(): { platform: WindowPlatform; position: WindowControlsPosition } {
  const dataset = document.documentElement.dataset;
  const platform = dataset.windowPlatform;
  const position = dataset.windowControlsPosition;
  return {
    platform: platform === 'macos' || platform === 'linux' || platform === 'other' ? platform : 'windows',
    position: position === 'left' ? 'left' : 'right',
  };
}

export function WindowControls() {
  const [{ platform, position }] = useState(readWindowControlsLayout);
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

  const isMac = platform === 'macos';
  const maximizeLabel = maximized ? 'Restore' : isMac ? 'Zoom' : 'Maximize';
  const controlsClassName = `window-controls ${platform} ${position}`;

  if (isMac) {
    return (
      <div className={controlsClassName}>
        <button className="window-control close" onClick={() => void api.app.closeWindow()} title="Close" aria-label="Close">×</button>
        <button className="window-control minimize" onClick={() => void api.app.minimizeWindow()} title="Minimize" aria-label="Minimize">—</button>
        <button className="window-control maximize" onClick={() => void toggleMaximize()} title={maximizeLabel} aria-label={maximizeLabel}>{maximized ? '❐' : '□'}</button>
      </div>
    );
  }

  return (
    <div className={controlsClassName}>
      <button className="window-control minimize" onClick={() => void api.app.minimizeWindow()} title="Minimize" aria-label="Minimize">—</button>
      <button className="window-control maximize" onClick={() => void toggleMaximize()} title={maximizeLabel} aria-label={maximizeLabel}>{maximized ? '❐' : '□'}</button>
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
