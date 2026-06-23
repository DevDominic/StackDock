import { useEffect, useRef } from 'react';
import type { ExtensionViewContribution, ExtensionStatusBarContribution } from '../shared/types';
import type { WorkspaceExtensionContext } from './extensionTypes';
import { getExtensionConfig } from './configuration';
import { api } from '../lib/api';

type FrameContribution = ExtensionViewContribution | ExtensionStatusBarContribution;

interface Props { contribution: FrameContribution; ctx: WorkspaceExtensionContext; className?: string; }
export function ExtensionFrame({ contribution, ctx, className = 'extension-frame' }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      if (event.source !== ref.current?.contentWindow) return;
      const expectedOrigin = `stackdock-extension://${contribution.extensionId}`;
      if (event.origin !== expectedOrigin && event.origin !== 'null') return;
      const msg = event.data as { id?: string; type?: string; payload?: unknown };
      const replyOrigin = event.origin === 'null' ? '*' : expectedOrigin;
      const reply = (ok: boolean, payload?: unknown) => ref.current?.contentWindow?.postMessage({ id: msg.id, type: 'stackdock.response', ok, payload }, replyOrigin);
      const payload = (msg.payload && typeof msg.payload === 'object' ? msg.payload : {}) as Record<string, unknown>;
      try {
        switch (msg.type) {
          case 'stackdock.ready': reply(true); break;
          case 'stackdock.getContext': {
            reply(true, {
              workspace: ctx.workspace,
              git: ctx.git,
              sessions: ctx.sessions,
              activeSessionId: ctx.activeSessionId,
              config: getExtensionConfig(ctx.settings, contribution.extensionId),
            });
            break;
          }
          case 'stackdock.openFile': void ctx.actions.openFile(String(msg.payload ?? '')); reply(true); break;
          case 'stackdock.openTerminalHere': void ctx.actions.openTerminalHere(String(msg.payload ?? ctx.workspace.path)); reply(true); break;
          case 'stackdock.refreshGit': void ctx.actions.refreshGit(); reply(true); break;
          case 'stackdock.revealFolder': void ctx.actions.revealFolder(typeof msg.payload === 'string' ? msg.payload : undefined); reply(true); break;
          case 'stackdock.shell.openExternal': await api.shell.openExternal(String(msg.payload ?? payload.url ?? '')); reply(true); break;
          case 'stackdock.fs.readDirectory': reply(true, await api.fs.readDirectory(String(payload.path ?? ctx.workspace.path))); break;
          case 'stackdock.fs.readFile': reply(true, await api.fs.readFile(String(payload.path ?? ''))); break;
          case 'stackdock.terminal.create': reply(true, await api.terminal.create(String(payload.profileId ?? ctx.defaultProfileId ?? ctx.profiles[0]?.id ?? 'default'), String(payload.cwd ?? ctx.workspace.path), typeof payload.name === 'string' ? payload.name : undefined, typeof payload.startupCommand === 'string' ? payload.startupCommand : undefined, typeof payload.restoreId === 'string' ? payload.restoreId : undefined, { workspaceId: ctx.workspace.id, workspaceName: ctx.workspace.name, workspacePath: ctx.workspace.path })); break;
          case 'stackdock.terminal.kill': await api.terminal.kill(String(payload.id ?? msg.payload ?? '')); reply(true); break;
          case 'stackdock.terminal.select': ctx.actions.selectSession(String(payload.id ?? msg.payload ?? '')); reply(true); break;
          default: reply(false, 'Unsupported extension bridge message');
        }
      } catch (error) { reply(false, error instanceof Error ? error.message : String(error)); }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ctx]);
  const entry = contribution.entry ?? 'index.html';
  return <iframe ref={ref} className={className} title={'title' in contribution ? contribution.title : contribution.label ?? contribution.id} sandbox="allow-scripts allow-forms allow-same-origin" src={`stackdock-extension://${contribution.extensionId}/${entry}?view=${encodeURIComponent(contribution.id)}`} />;
}
