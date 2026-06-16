import { create } from 'zustand';
import type { Workspace, WorkspaceLayout } from '../shared/types';
import { api } from '../lib/api';

function normalizeWorkspacePath(value: string) {
  return value.replace(/[\\/]+$/, '').toLowerCase();
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  addWorkspace(path: string): Promise<void>;
  openWorkspacePath(path: string): Promise<void>;
  createWorkspace(parentPath: string, name: string): Promise<void>;
  duplicateWorkspace(workspace: Workspace): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  closeWorkspace(): void;
  removeWorkspace(id: string): Promise<void>;
  updateWorkspace(workspace: Workspace): Promise<void>;
  loadLayout(workspaceId: string): Promise<WorkspaceLayout | null>;
  saveLayout(layout: WorkspaceLayout): Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,
  error: null,
  async reload() {
    set({ loading: true, error: null });
    try {
      const workspaces = await api.workspaces.list();
      set({ workspaces, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not load workspaces', loading: false });
    }
  },
  async addWorkspace(path) {
    set({ loading: true, error: null });
    try {
      const workspace = await api.workspaces.add(path);
      set({ workspaces: [workspace, ...get().workspaces], activeWorkspaceId: workspace.id, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not add workspace', loading: false });
    }
  },
  async openWorkspacePath(path) {
    set({ loading: true, error: null });
    try {
      const normalized = normalizeWorkspacePath(path);
      const existing = get().workspaces.find((workspace) => normalizeWorkspacePath(workspace.path) === normalized);
      if (existing) {
        set({ loading: false });
        await get().openWorkspace(existing.id);
        return;
      }
      const workspace = await api.workspaces.add(path);
      set({ workspaces: [workspace, ...get().workspaces], activeWorkspaceId: workspace.id, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not open workspace', loading: false });
    }
  },
  async createWorkspace(parentPath, name) {
    set({ loading: true, error: null });
    try {
      const workspace = await api.workspaces.create(parentPath, name);
      set({ workspaces: [workspace, ...get().workspaces], activeWorkspaceId: workspace.id, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not create workspace', loading: false });
    }
  },
  async duplicateWorkspace(workspace) {
    set({ loading: true, error: null });
    try {
      const added = await api.workspaces.add(workspace.path);
      const saved = await api.workspaces.update({ ...added, name: `${workspace.name} Copy`, commands: workspace.commands ?? [], pinned: false });
      set({ workspaces: [saved, ...get().workspaces], loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not duplicate workspace', loading: false });
    }
  },
  async openWorkspace(id) {
    set({ activeWorkspaceId: id });
    const workspace = get().workspaces.find((item) => item.id === id);
    if (!workspace) return;
    await get().updateWorkspace({ ...workspace, lastOpenedAt: new Date().toISOString() });
  },
  closeWorkspace() {
    set({ activeWorkspaceId: null });
  },
  async removeWorkspace(id) {
    set({ loading: true, error: null });
    try {
      await api.workspaces.remove(id);
      set({ workspaces: get().workspaces.filter((workspace) => workspace.id !== id), loading: false });
      if (get().activeWorkspaceId === id) set({ activeWorkspaceId: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not remove workspace', loading: false });
    }
  },
  async updateWorkspace(workspace) {
    const saved = await api.workspaces.update(workspace);
    set({ workspaces: get().workspaces.map((item) => (item.id === saved.id ? saved : item)) });
  },
  async loadLayout(workspaceId) {
    return api.workspaces.loadLayout(workspaceId);
  },
  async saveLayout(layout) {
    return api.workspaces.saveLayout(layout);
  },
}));
