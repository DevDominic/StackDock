import { lazy, Suspense, useEffect, useState } from 'react';
import { WorkspaceDashboard } from './components/dashboard/WorkspaceDashboard';
import { api } from './lib/api';
import { useWorkspaceStore } from './state/workspaceStore';
import { applyTheme } from './lib/themeSupport';
import type { StackDockSettings } from './shared/types';

const WorkspaceShell = lazy(() => import('./components/workspace/WorkspaceShell.js').then((module) => ({ default: module.WorkspaceShell })));

export default function App() {
  const { workspaces, activeWorkspaceId, loading, error, reload, addWorkspace, createWorkspace, duplicateWorkspace, openWorkspace, closeWorkspace, removeWorkspace, updateWorkspace } = useWorkspaceStore();
  const [settings, setSettings] = useState<StackDockSettings | null>(null);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let active = true;
    api.settings.load().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      applyTheme(loaded.themeId, loaded.importedThemes);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  function handleSettingsApplied(next: StackDockSettings) {
    setSettings(next);
    applyTheme(next.themeId, next.importedThemes);
  }

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
    return (
      <Suspense fallback={<main className="app-shell"><div className="empty-pad muted">Loading workspace…</div></main>}>
        <WorkspaceShell workspace={activeWorkspace} workspaces={workspaces} settings={settings} onSettingsApplied={handleSettingsApplied} onBack={closeWorkspace} onUpdateWorkspace={updateWorkspace} onOpenWorkspace={openWorkspace} />
      </Suspense>
    );
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
        settings={settings}
        onSettingsApplied={handleSettingsApplied}
      />
    </main>
  );
}
