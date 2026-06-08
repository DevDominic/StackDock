import { useEffect } from 'react';
import { WorkspaceDashboard } from './components/dashboard/WorkspaceDashboard';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { api } from './lib/api';
import { useWorkspaceStore } from './state/workspaceStore';

export default function App() {
  const { workspaces, activeWorkspaceId, loading, error, reload, addWorkspace, openWorkspace, closeWorkspace, removeWorkspace, updateWorkspace } = useWorkspaceStore();

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    const folder = await api.app.pickWorkspaceFolder();
    if (folder) {
      await addWorkspace(folder);
    }
  }

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  if (activeWorkspace) {
    return <WorkspaceShell workspace={activeWorkspace} onBack={closeWorkspace} />;
  }

  return (
    <main className="app-shell">
      {error ? <div className="banner error">{error}</div> : null}
      <WorkspaceDashboard
        workspaces={workspaces}
        onAdd={handleAdd}
        onOpen={openWorkspace}
        onRemove={removeWorkspace}
        onTogglePin={async (workspace) => updateWorkspace({ ...workspace, pinned: !workspace.pinned })}
        busy={loading}
      />
    </main>
  );
}
