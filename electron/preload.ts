import { contextBridge, ipcRenderer } from 'electron';
import type { StackDockApi } from '../src/shared/types';

const api: StackDockApi = {
  app: {
    pickWorkspaceFolder: () => ipcRenderer.invoke('app:pickWorkspaceFolder'),
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    add: (folderPath) => ipcRenderer.invoke('workspaces:add', folderPath),
    update: (workspace) => ipcRenderer.invoke('workspaces:update', workspace),
    remove: (id) => ipcRenderer.invoke('workspaces:remove', id),
    loadLayout: (workspaceId) => ipcRenderer.invoke('workspaces:loadLayout', workspaceId),
    saveLayout: (layout) => ipcRenderer.invoke('workspaces:saveLayout', layout),
  },
  fs: {
    readDirectory: (targetPath) => ipcRenderer.invoke('fs:readDirectory', targetPath),
    readFile: (targetPath) => ipcRenderer.invoke('fs:readFile', targetPath),
    writeFile: (targetPath, content) => ipcRenderer.invoke('fs:writeFile', targetPath, content),
    createFile: (targetPath) => ipcRenderer.invoke('fs:createFile', targetPath),
    createFolder: (targetPath) => ipcRenderer.invoke('fs:createFolder', targetPath),
    renamePath: (oldPath, newPath) => ipcRenderer.invoke('fs:renamePath', oldPath, newPath),
    deletePath: (targetPath) => ipcRenderer.invoke('fs:deletePath', targetPath),
    revealInExplorer: (targetPath) => ipcRenderer.invoke('fs:revealInExplorer', targetPath),
  },
  git: {
    status: (targetPath) => ipcRenderer.invoke('git:status', targetPath),
    diff: (targetPath, filePath, staged) => ipcRenderer.invoke('git:diff', targetPath, filePath, staged),
    stage: (targetPath, filePath) => ipcRenderer.invoke('git:stage', targetPath, filePath),
    unstage: (targetPath, filePath) => ipcRenderer.invoke('git:unstage', targetPath, filePath),
    discard: (targetPath, filePath) => ipcRenderer.invoke('git:discard', targetPath, filePath),
    commit: (targetPath, message) => ipcRenderer.invoke('git:commit', targetPath, message),
    addAll: (targetPath) => ipcRenderer.invoke('git:addAll', targetPath),
  },
  terminal: {
    profiles: () => ipcRenderer.invoke('terminal:profiles'),
    create: (profileId, cwd, name, startupCommand) => ipcRenderer.invoke('terminal:create', profileId, cwd, name, startupCommand),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
  },
  onTerminalData(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.off('terminal:data', listener);
  },
  onTerminalExit(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number | null }) => callback(payload);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.off('terminal:exit', listener);
  },
  onWorkspaceChanged(callback) {
    const listener = () => callback();
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.off('workspace:changed', listener);
  },
};

contextBridge.exposeInMainWorld('stackdock', api);
