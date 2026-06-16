import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { WorkspaceDashboard } from './components/dashboard/WorkspaceDashboard';
import { TitleBar } from './components/TitleBar';
import { api } from './lib/api';
import { useWorkspaceStore } from './state/workspaceStore';
import { applyTheme } from './lib/themeSupport';
import type { StackDockSettings } from './shared/types';
import { ExtensionProvider } from './extensions/ExtensionProvider';
import { usePromptDialog } from './components/common/PromptProvider';

const WorkspaceShell = lazy(() => import('./components/workspace/WorkspaceShell.js').then((module) => ({ default: module.WorkspaceShell })));

function applyUiFont(settings: StackDockSettings) {
  document.documentElement.style.setProperty('--ui-font', settings.ui.fontFamily);
  document.documentElement.style.setProperty('--ui-font-size', `${settings.ui.fontSize}px`);
}

export default function App() {
  const { workspaces, activeWorkspaceId, loading, error, reload, addWorkspace, openWorkspacePath, createWorkspace, duplicateWorkspace, openWorkspace, closeWorkspace, removeWorkspace, updateWorkspace } = useWorkspaceStore();
  const [settings, setSettings] = useState<StackDockSettings | null>(null);
  const promptDialog = usePromptDialog();
  const restoredRef = useRef(false);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let active = true;
    api.settings.load().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      applyUiFont(loaded);
      applyTheme(loaded.themeId, loaded.importedThemes);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (restoredRef.current || loading || activeWorkspaceId || !workspaces.length || !settings) return;
    restoredRef.current = true;
    api.app.loadRestoreState().then((state) => {
      if (state.lastWorkspaceId && workspaces.some((workspace) => workspace.id === state.lastWorkspaceId)) return openWorkspace(state.lastWorkspaceId);
    }).catch(() => undefined);
  }, [activeWorkspaceId, loading, openWorkspace, settings, workspaces]);

  function handleSettingsApplied(next: StackDockSettings) {
    setSettings(next);
    applyUiFont(next);
    applyTheme(next.themeId, next.importedThemes);
  }

  async function handleAdd() {
    const folder = await api.app.pickWorkspaceFolder();
    if (folder) await addWorkspace(folder);
  }

  async function handleCreate() {
    const parent = await api.app.pickWorkspaceFolder();
    const name = parent ? await promptDialog.input({ title: 'Workspace name', placeholder: 'My project', confirmLabel: 'Create' }) : null;
    if (parent && name?.trim()) await createWorkspace(parent, name.trim());
  }

  async function handleOpenWorkspacePicker() {
    const folder = await api.app.pickWorkspaceFolder();
    if (!folder) return false;
    await openWorkspacePath(folder);
    return true;
  }

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  if (activeWorkspace) {
    return (
      <div className="root-shell">
        <Suspense fallback={<main className="app-shell"><div className="empty-pad muted">Loading workspace…</div></main>}>
          <ExtensionProvider><WorkspaceShell workspace={activeWorkspace} workspaces={workspaces} settings={settings} onSettingsApplied={handleSettingsApplied} onBack={closeWorkspace} onUpdateWorkspace={updateWorkspace} onOpenWorkspace={openWorkspace} onOpenWorkspacePicker={handleOpenWorkspacePicker} /></ExtensionProvider>
        </Suspense>
      </div>
    );
  }

  return (
    <div className="root-shell">
      <TitleBar title="StackDock" />
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
    </div>
  );
}
