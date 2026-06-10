import { useEffect, useRef } from 'react';
import type { ExtensionViewContribution } from '../shared/types';
import type { WorkspaceExtensionContext } from './extensionTypes';

interface Props { contribution: ExtensionViewContribution; ctx: WorkspaceExtensionContext; }
export function ExtensionFrame({ contribution, ctx }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== ref.current?.contentWindow) return;
      const msg = event.data as { id?: string; type?: string; payload?: unknown };
      const reply = (ok: boolean, payload?: unknown) => ref.current?.contentWindow?.postMessage({ id: msg.id, type: 'stackdock.response', ok, payload }, '*');
      try {
        switch (msg.type) {
          case 'stackdock.ready': reply(true); break;
          case 'stackdock.getContext': reply(true, { workspace: ctx.workspace, git: ctx.git, sessions: ctx.sessions, activeSessionId: ctx.activeSessionId }); break;
          case 'stackdock.openFile': void ctx.actions.openFile(String(msg.payload ?? '')); reply(true); break;
          case 'stackdock.openTerminalHere': void ctx.actions.openTerminalHere(String(msg.payload ?? ctx.workspace.path)); reply(true); break;
          case 'stackdock.refreshGit': void ctx.actions.refreshGit(); reply(true); break;
          case 'stackdock.revealFolder': void ctx.actions.revealFolder(typeof msg.payload === 'string' ? msg.payload : undefined); reply(true); break;
          default: reply(false, 'Unsupported extension bridge message');
        }
      } catch (error) { reply(false, error instanceof Error ? error.message : String(error)); }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ctx]);
  const entry = contribution.entry ?? 'index.html';
  return <iframe ref={ref} className="extension-frame" title={contribution.title} sandbox="allow-scripts allow-forms" src={`stackdock-extension://${contribution.extensionId}/${entry}?view=${encodeURIComponent(contribution.id)}`} />;
}
