import { getExtensionConfig } from '../../../../src/extensions/configuration';
import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { GlobalSessionsSidebar } from './GlobalSessionsSidebar';
import { SessionsSettings } from './SessionsSettings';
import { sessionsExtensionManifest } from '../manifest';
import './sessions.css';

const SESSION_DEFAULTS = { emptySessionsVisible: false, showSessionCwdForAll: false };

export const sessionsExtension: NativeExtension = {
  manifest: sessionsExtensionManifest,
  renderView: (_contribution, ctx) => {
    const config = getExtensionConfig(ctx.settings, sessionsExtensionManifest.id, SESSION_DEFAULTS);
    return (
      <GlobalSessionsSidebar
        workspaces={ctx.workspaces}
        activeWorkspaceId={ctx.workspace.id}
        activeSessionId={ctx.activeSessionId}
        highlightedSessionIds={ctx.highlightedSessionIds}
        sessions={ctx.allSessions}
        profiles={ctx.profiles}
        defaultProfileId={ctx.defaultProfileId}
        emptySessionsVisible={config.emptySessionsVisible === true}
        showSessionCwdForAll={config.showSessionCwdForAll === true}
        onCreateSession={ctx.sessionActions.create}
        onSelectSession={ctx.actions.selectSession}
        onOpenWorkspace={ctx.sessionActions.openWorkspace}
        onCloseSession={ctx.sessionActions.close}
        onCloseSessions={ctx.sessionActions.closeMany}
        onRenameSession={ctx.sessionActions.rename}
        onRestartSession={ctx.sessionActions.restart}
        onDuplicateSession={ctx.sessionActions.duplicate}
        onSetCwd={ctx.sessionActions.setCwd}
        onSplitSession={ctx.sessionActions.split}
        onDetachSession={ctx.sessionActions.detach}
      />
    );
  },
  renderSettings: (ctx) => <SessionsSettings {...ctx} />,
};
