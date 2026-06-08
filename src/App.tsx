import { useEffect } from 'react';
import { WorkspaceDashboard } from './components/dashboard/WorkspaceDashboard';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { api } from './lib/api';
import { useWorkspaceStore } from './state/workspaceStore';

export default function App() {
  const { workspaces, activeWorkspaceId, loading, error, reload, addWorkspace, createWorkspace, duplicateWorkspace, openWorkspace, closeWorkspace, removeWorkspace, updateWorkspace } = useWorkspaceStore();

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    const folder = await api.app.pickWorkspaceFolder();
    if (folder) await addWorkspace(folder);
  }

  async function handleCreate() {
    const parent = await api.app.pickWorkspaceFolder();
    const name = parent ? window.prompt('Workspace name') : null;
    if (parent && name) await createWorkspace(parent, name);
  }

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  if (activeWorkspace) {
    return <WorkspaceShell workspace={activeWorkspace} workspaces={workspaces} onBack={closeWorkspace} onUpdateWorkspace={updateWorkspace} onOpenWorkspace={openWorkspace} />;
  }

  return (
    <main className="app-shell">
      {error ? <div className="banner error">{error}</div> : null}
      <WorkspaceDashboard
        workspaces={workspaces}
        onAdd={handleAdd}
        onOpen={openWorkspace}
        onRemove={removeWorkspace}
        onUpdate={updateWorkspace}
        onDuplicate={duplicateWorkspace}
        onCreate={handleCreate}
        onTogglePin={async (workspace) => updateWorkspace({ ...workspace, pinned: !workspace.pinned })}
        busy={loading}
      />
    </main>
  );
}
