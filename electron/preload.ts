import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import os from 'os';
import type { StackDockApi, WindowControlsStyle } from '../src/shared/types';

function isWindows11() {
  if (process.platform !== 'win32') return false;
  const build = Number(os.release().split('.')[2] ?? 0);
  return build >= 22000;
}

const controlsStyle: WindowControlsStyle = isWindows11() ? 'native' : 'custom';

function applyWindowControlsStyle() {
  document.documentElement.dataset.windowControls = controlsStyle;
}

if (document.documentElement) applyWindowControlsStyle();
else window.addEventListener('DOMContentLoaded', applyWindowControlsStyle, { once: true });

const api: StackDockApi = {
  app: {
    pickWorkspaceFolder: () => ipcRenderer.invoke('app:pickWorkspaceFolder'),
    importJsonFile: () => ipcRenderer.invoke('app:importJsonFile'),
    minimizeWindow: () => ipcRenderer.invoke('app:minimizeWindow'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('app:toggleMaximizeWindow'),
    closeWindow: () => ipcRenderer.invoke('app:closeWindow'),
    isWindowMaximized: () => ipcRenderer.invoke('app:isWindowMaximized'),
    windowControlsStyle: () => Promise.resolve(controlsStyle),
    setTitleBarOverlay: (options) => ipcRenderer.invoke('app:setTitleBarOverlay', options),
    loadRestoreState: () => ipcRenderer.invoke('app:loadRestoreState'),
    saveRestoreState: (state) => ipcRenderer.invoke('app:saveRestoreState', state),
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    add: (folderPath) => ipcRenderer.invoke('workspaces:add', folderPath),
    create: (parentPath, name) => ipcRenderer.invoke('workspaces:create', parentPath, name),
    update: (workspace) => ipcRenderer.invoke('workspaces:update', workspace),
    remove: (id) => ipcRenderer.invoke('workspaces:remove', id),
    loadLayout: (workspaceId) => ipcRenderer.invoke('workspaces:loadLayout', workspaceId),
    saveLayout: (layout) => ipcRenderer.invoke('workspaces:saveLayout', layout),
  },
  fs: {
    readDirectory: (targetPath) => ipcRenderer.invoke('fs:readDirectory', targetPath),
    readFile: (targetPath) => ipcRenderer.invoke('fs:readFile', targetPath),
    readFileDataUrl: (targetPath) => ipcRenderer.invoke('fs:readFileDataUrl', targetPath),
    watchWorkspace: (targetPath) => ipcRenderer.invoke('fs:watchWorkspace', targetPath),
    writeFile: (targetPath, content) => ipcRenderer.invoke('fs:writeFile', targetPath, content),
    createFile: (targetPath) => ipcRenderer.invoke('fs:createFile', targetPath),
    createFolder: (targetPath) => ipcRenderer.invoke('fs:createFolder', targetPath),
    renamePath: (oldPath, newPath) => ipcRenderer.invoke('fs:renamePath', oldPath, newPath),
    deletePath: (targetPath) => ipcRenderer.invoke('fs:deletePath', targetPath),
    revealInExplorer: (targetPath) => ipcRenderer.invoke('fs:revealInExplorer', targetPath),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  },
  git: {
    status: (targetPath) => ipcRenderer.invoke('git:status', targetPath),
    branches: (targetPath) => ipcRenderer.invoke('git:branches', targetPath),
    diff: (targetPath, filePath, staged) => ipcRenderer.invoke('git:diff', targetPath, filePath, staged),
    fileContents: (targetPath, filePath, staged) => ipcRenderer.invoke('git:fileContents', targetPath, filePath, staged),
    stage: (targetPath, filePath) => ipcRenderer.invoke('git:stage', targetPath, filePath),
    unstage: (targetPath, filePath) => ipcRenderer.invoke('git:unstage', targetPath, filePath),
    discard: (targetPath, filePath) => ipcRenderer.invoke('git:discard', targetPath, filePath),
    commit: (targetPath, message) => ipcRenderer.invoke('git:commit', targetPath, message),
    addAll: (targetPath) => ipcRenderer.invoke('git:addAll', targetPath),
    switchBranch: (targetPath, branch) => ipcRenderer.invoke('git:switchBranch', targetPath, branch),
    push: (targetPath) => ipcRenderer.invoke('git:push', targetPath),
    pull: (targetPath) => ipcRenderer.invoke('git:pull', targetPath),
    fetch: (targetPath) => ipcRenderer.invoke('git:fetch', targetPath),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  automation: {
    load: () => ipcRenderer.invoke('automation:load'),
    loadRaw: () => ipcRenderer.invoke('automation:loadRaw'),
    saveRaw: (content) => ipcRenderer.invoke('automation:saveRaw', content),
  },
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    reload: () => ipcRenderer.invoke('extensions:reload'),
    addLocalPackage: (targetPath) => ipcRenderer.invoke('extensions:addLocalPackage', targetPath),
    removeLocalPackage: (targetPath) => ipcRenderer.invoke('extensions:removeLocalPackage', targetPath),
  },
  attachments: {
    getPathForFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
    hasClipboardImage: () => !clipboard.readImage().isEmpty(),
    hasClipboardText: () => clipboard.readText().length > 0,
    inspectPath: (targetPath, source, options) => ipcRenderer.invoke('attachments:inspectPath', targetPath, source, options),
    savePastedImage: (dataUrl, name, options) => ipcRenderer.invoke('attachments:savePastedImage', dataUrl, name, options),
    saveClipboardImage: (name, options) => {
      const image = clipboard.readImage();
      if (image.isEmpty()) return Promise.resolve(null);
      return ipcRenderer.invoke('attachments:savePastedImage', image.toDataURL(), name, options);
    },
  },
  terminal: {
    profiles: () => ipcRenderer.invoke('terminal:profiles'),
    create: (profileId, cwd, name, startupCommand, restoreId, context) => ipcRenderer.invoke('terminal:create', profileId, cwd, name, startupCommand, restoreId, context),
    restoreState: () => ipcRenderer.invoke('terminal:restoreState'),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    setVisible: (ids) => ipcRenderer.invoke('terminal:setVisible', ids),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    snapshot: (idOrRestoreId) => ipcRenderer.invoke('terminal:snapshot', idOrRestoreId),
    forgetSnapshot: (idOrRestoreId) => ipcRenderer.invoke('terminal:forgetSnapshot', idOrRestoreId),
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
  onFileSystemChanged(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { rootPath: string }) => callback(payload);
    ipcRenderer.on('fs:changed', listener);
    return () => ipcRenderer.off('fs:changed', listener);
  },
  onOpenUrlRequest(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { url: string; sessionId?: string }) => callback(payload);
    ipcRenderer.on('web:openUrlRequest', listener);
    return () => ipcRenderer.off('web:openUrlRequest', listener);
  },
};

contextBridge.exposeInMainWorld('stackdock', api);
