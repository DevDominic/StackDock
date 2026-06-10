import { GlobalSessionsSidebar } from '../../components/workspace/GlobalSessionsSidebar';
import type { NativeExtension } from '../extensionTypes';

export const sessionsExtension: NativeExtension = {
  manifest: { id: 'stackdock.sessions', name: 'Sessions', version: '1.0.0', defaultEnabled: true, source: 'bundled', contributes: { views: [{ id: 'stackdock.sessions.view', extensionId: 'stackdock.sessions', title: 'Sessions', icon: 'sessions', location: 'sessions', order: 5, native: true }] } },
  renderView: (_contribution, ctx) => (
    <GlobalSessionsSidebar
      workspaces={ctx.workspaces}
      activeWorkspaceId={ctx.workspace.id}
      activeSessionId={ctx.activeSessionId}
      sessions={ctx.allSessions}
      profiles={ctx.profiles}
      defaultProfileId={ctx.defaultProfileId}
      emptySessionsVisible={ctx.emptySessionsVisible}
      showSessionCwdForAll={ctx.showSessionCwdForAll}
      onCreateSession={ctx.sessionActions.create}
      onSelectSession={ctx.actions.selectSession}
      onOpenWorkspace={ctx.sessionActions.openWorkspace}
      onCloseSession={ctx.sessionActions.close}
      onRenameSession={ctx.sessionActions.rename}
      onRestartSession={ctx.sessionActions.restart}
      onDuplicateSession={ctx.sessionActions.duplicate}
      onSetCwd={ctx.sessionActions.setCwd}
      onSplitSession={ctx.sessionActions.split}
    />
  ),
};
