import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

export interface WebTab {
  id: string;
  url: string;
  name: string;
}

interface Props {
  tabs: WebTab[];
  activeId: string | null;
  onTitle(id: string, title: string): void;
  showToolbar?: boolean;
}

// Electron's <webview> is already typed as a JSX intrinsic by @types/react.

// All open web tabs stay mounted and are toggled via CSS so each keeps its own
// navigation history and scroll position across tab switches (same approach the
// terminal and editor use).
export function WebTabPanel({ tabs, activeId, onTitle, showToolbar = true }: Props) {
  return (
    <>
      {tabs.map((tab) => (
        <WebView key={tab.id} tab={tab} visible={tab.id === activeId} onTitle={onTitle} showToolbar={showToolbar} />
      ))}
    </>
  );
}

function WebView({ tab, visible, onTitle, showToolbar }: { tab: WebTab; visible: boolean; onTitle(id: string, title: string): void; showToolbar: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const [currentUrl, setCurrentUrl] = useState(tab.url);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const syncNav = () => {
      try {
        setCurrentUrl(el.getURL());
        setCanBack(el.canGoBack());
        setCanForward(el.canGoForward());
      } catch {
        /* webview not ready yet */
      }
    };
    const onTitleUpdated = (event: { title: string }) => onTitle(tab.id, event.title);
    // External links / window.open inside the page go to the system browser.
    const onNewWindow = (event: { url: string }) => void api.shell.openExternal(event.url).catch(() => undefined);
    el.addEventListener('did-navigate', syncNav);
    el.addEventListener('did-navigate-in-page', syncNav);
    el.addEventListener('page-title-updated', onTitleUpdated);
    el.addEventListener('new-window', onNewWindow);
    return () => {
      el.removeEventListener('did-navigate', syncNav);
      el.removeEventListener('did-navigate-in-page', syncNav);
      el.removeEventListener('page-title-updated', onTitleUpdated);
      el.removeEventListener('new-window', onNewWindow);
    };
  }, [tab.id, onTitle]);

  return (
    <div className="web-tab" style={{ display: visible ? 'flex' : 'none' }}>
      {showToolbar ? (
        <div className="web-toolbar">
          <button className="ghost web-nav" disabled={!canBack} title="Back" onClick={() => ref.current?.goBack()}>←</button>
          <button className="ghost web-nav" disabled={!canForward} title="Forward" onClick={() => ref.current?.goForward()}>→</button>
          <button className="ghost web-nav" title="Reload" onClick={() => ref.current?.reload()}>⟳</button>
          <button className="ghost" title="Open in system browser" onClick={() => void api.shell.openExternal(currentUrl).catch(() => undefined)}>Open externally</button>
        </div>
      ) : null}
      <webview ref={ref} src={tab.url} className="web-frame" />
    </div>
  );
}
