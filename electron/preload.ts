import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import os from 'os';
import type { StackDockApi } from '../src/shared/types';
import { getWindowControlsConfig } from '../src/shared/windowControls';

const controlsConfig = getWindowControlsConfig(process.platform, os.release());

function applyWindowControlsStyle() {
  document.documentElement.dataset.windowControls = controlsConfig.style;
  document.documentElement.dataset.windowPlatform = controlsConfig.platform;
  document.documentElement.dataset.windowControlsPosition = controlsConfig.position;
}

if (document.documentElement) applyWindowControlsStyle();
else window.addEventListener('DOMContentLoaded', applyWindowControlsStyle, { once: true });

function invokeExtension(extensionId: string, command: string, args: unknown[] = []) {
  if (typeof extensionId !== 'string' || !extensionId.trim()) return Promise.reject(new Error('extensionId must be non-empty'));
  if (typeof command !== 'string' || !command.trim()) return Promise.reject(new Error('command must be non-empty'));
  if (!Array.isArray(args)) return Promise.reject(new Error('args must be an array'));
  return ipcRenderer.invoke('extensions:invoke', extensionId, command, args);
}

const api: StackDockApi = {
  app: {
    pickWorkspaceFolder: () => ipcRenderer.invoke('app:pickWorkspaceFolder'),
    importJsonFile: () => ipcRenderer.invoke('app:importJsonFile'),
    getLaunchInfo: () => ipcRenderer.invoke('app:getLaunchInfo'),
    getReleaseNotesState: () => ipcRenderer.invoke('app:getReleaseNotesState'),
    markReleaseNotesSeen: (version) => ipcRenderer.invoke('app:markReleaseNotesSeen', version),
    exportDiagnostics: (options) => ipcRenderer.invoke('app:exportDiagnostics', options),
    exportSettingsBackup: () => ipcRenderer.invoke('app:exportSettingsBackup'),
    resetSettings: () => ipcRenderer.invoke('app:resetSettings'),
    resetWorkspaceLayout: (workspaceId) => ipcRenderer.invoke('app:resetWorkspaceLayout', workspaceId),
    enableSafeMode: () => ipcRenderer.invoke('app:enableSafeMode'),
    openLogsFolder: () => ipcRenderer.invoke('app:openLogsFolder'),
    openExternalTerminal: (cwd) => ipcRenderer.invoke('app:openExternalTerminal', cwd),
    minimizeWindow: () => ipcRenderer.invoke('app:minimizeWindow'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('app:toggleMaximizeWindow'),
    closeWindow: () => ipcRenderer.invoke('app:closeWindow'),
    isWindowMaximized: () => ipcRenderer.invoke('app:isWindowMaximized'),
    windowControlsStyle: () => Promise.resolve(controlsConfig.style),
    windowControlsConfig: () => Promise.resolve(controlsConfig),
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
    pathExists: (targetPath) => ipcRenderer.invoke('fs:pathExists', targetPath),
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
    // TODO: Deprecated compatibility shim; use extensions.invoke('stackdock.git', ...).
    status: (targetPath) => invokeExtension('stackdock.git', 'status', [targetPath]),
    branches: (targetPath) => invokeExtension('stackdock.git', 'branches', [targetPath]),
    diff: (targetPath, filePath, staged) => invokeExtension('stackdock.git', 'diff', [targetPath, filePath, staged]),
    fileContents: (targetPath, filePath, staged) => invokeExtension('stackdock.git', 'fileContents', [targetPath, filePath, staged]),
    stage: (targetPath, filePath) => invokeExtension('stackdock.git', 'stage', [targetPath, filePath]),
    unstage: (targetPath, filePath) => invokeExtension('stackdock.git', 'unstage', [targetPath, filePath]),
    discard: (targetPath, filePath) => invokeExtension('stackdock.git', 'discard', [targetPath, filePath]),
    ignore: (targetPath, filePath) => invokeExtension('stackdock.git', 'ignore', [targetPath, filePath]),
    commit: (targetPath, message) => invokeExtension('stackdock.git', 'commit', [targetPath, message]),
    addAll: (targetPath) => invokeExtension('stackdock.git', 'addAll', [targetPath]),
    switchBranch: (targetPath, branch) => invokeExtension('stackdock.git', 'switchBranch', [targetPath, branch]),
    push: (targetPath) => invokeExtension('stackdock.git', 'push', [targetPath]),
    pull: (targetPath) => invokeExtension('stackdock.git', 'pull', [targetPath]),
    pullMerge: (targetPath) => invokeExtension('stackdock.git', 'pullMerge', [targetPath]),
    abortMerge: (targetPath) => invokeExtension('stackdock.git', 'abortMerge', [targetPath]),
    fetch: (targetPath) => invokeExtension('stackdock.git', 'fetch', [targetPath]),
    ignored: (targetPath, paths) => invokeExtension('stackdock.git', 'ignored', [targetPath, paths]),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    defaults: () => ipcRenderer.invoke('settings:defaults'),
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
    invoke: invokeExtension,
  },
  attachments: {
    getPathForFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
    hasClipboardImage: () => !clipboard.readImage().isEmpty(),
    hasClipboardText: () => clipboard.readText().length > 0,
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (text) => clipboard.writeText(text),
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
    update: (id, patch) => ipcRenderer.invoke('terminal:update', id, patch),
    restoreState: () => ipcRenderer.invoke('terminal:restoreState'),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    ready: (id) => ipcRenderer.invoke('terminal:ready', id),
    setVisible: (ids) => ipcRenderer.invoke('terminal:setVisible', ids),
    kill: (id, preserveSnapshot) => ipcRenderer.invoke('terminal:kill', id, preserveSnapshot),
    snapshot: (idOrRestoreId) => ipcRenderer.invoke('terminal:snapshot', idOrRestoreId),
    forgetSnapshot: (idOrRestoreId) => ipcRenderer.invoke('terminal:forgetSnapshot', idOrRestoreId),
  },
  onTerminalData(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.off('terminal:data', listener);
  },
  onTerminalHeadlessData(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => callback(payload);
    ipcRenderer.on('terminal:headlessData', listener);
    return () => ipcRenderer.off('terminal:headlessData', listener);
  },
  onTerminalExit(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number | null }) => callback(payload);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.off('terminal:exit', listener);
  },
  onTerminalHeadlessResult(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; label?: string; command: string; output: string; exitCode: number | null; timedOut?: boolean }) => callback(payload);
    ipcRenderer.on('terminal:headlessResult', listener);
    return () => ipcRenderer.off('terminal:headlessResult', listener);
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
