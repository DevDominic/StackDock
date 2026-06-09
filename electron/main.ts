import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import os from 'os';
import path from 'path';
import { addWorkspace, createWorkspace, listWorkspaces, loadLayout, loadRestoreState, removeWorkspace, saveLayout, saveRestoreState, updateWorkspace } from './workspaceStore';
import { createFile, createFolder, deletePath, readDirectory, readFile, readFileDataUrl, renamePath, revealInExplorer, writeFile } from './fileService';
import { addAll, commit, discardFile, getGitDiff, getGitFileContents, getGitStatus, stageFile, unstageFile } from './gitService';
import { createTerminal, forgetTerminalSnapshot, getTerminalProfiles, getTerminalSnapshot, killTerminal, loadOpenTerminalState, resizeTerminal, saveOpenTerminalState, setTerminalWindow, setVisibleTerminals, writeTerminal } from './terminalManager';
import { ensureDataDirs } from './storage';
import { logError } from './log';
import { loadSettings, saveSettings } from './configStore';
import { loadAutomation, loadAutomationRaw, saveAutomationRaw } from './automationStore';
import { inspectAttachmentPath, savePastedImageAttachment } from './attachmentService';
import { assertAbsolutePath, assertLayoutLike, assertNonEmptyString, assertNumber, assertRestoreStateLike, assertSafeFileName, assertString, assertTerminalAttachmentOptions, assertTerminalAttachmentSource, assertTerminalSessionContext, assertWorkspaceLike } from './validation';

let mainWindow: BrowserWindow | null = null;
let quittingAfterSnapshotFlush = false;
let closingAfterTerminalSave = false;
const watchedWorkspaces = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>();
const noisyWatchSegments = new Set(['node_modules', 'dist', 'build', 'target', '.cache', '.git']);
const nativeWindowControls = isWindows11();

// Make dev Electron sessions attachable by browser automation tools such as
// dev-only by default; packaged builds can opt in explicitly with
// STACKDOCK_REMOTE_DEBUGGING_PORT if needed for QA.
const remoteDebuggingPort = process.env.STACKDOCK_REMOTE_DEBUGGING_PORT ?? (!app.isPackaged ? '9222' : '');
if (remoteDebuggingPort) app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort);
const automationMode = process.env.STACKDOCK_AGENT_BROWSER === '1' || process.argv.includes('--agent-browser');

function isWindows11() {
  if (process.platform !== 'win32') return false;
  const build = Number(os.release().split('.')[2] ?? 0);
  return build >= 22000;
}

function windowControlsStyle() {
  return nativeWindowControls ? 'native' : 'custom';
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0b0d12',
    title: 'StackDock',
    autoHideMenuBar: true,
    ...(nativeWindowControls
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#1e2227', symbolColor: '#abb2bf', height: 42 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  setTerminalWindow(mainWindow);

  if (!app.isPackaged) {
    await mainWindow.loadURL('http://localhost:5173');
    if (process.env.STACKDOCK_OPEN_DEVTOOLS !== '0') mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const reload = key === 'f5' || ((input.control || input.meta) && key === 'r');
    const devtools = key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');
    if (reload) {
      event.preventDefault();
      if (input.shift) mainWindow?.webContents.reloadIgnoringCache();
      else mainWindow?.webContents.reload();
    } else if (devtools) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.on('close', (event) => {
    if (closingAfterTerminalSave) return;
    event.preventDefault();
    closingAfterTerminalSave = true;
    const saveWithTimeout = Promise.race([
      saveOpenTerminalState(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('saveOpenTerminalState timeout')), 3000)),
    ]);
    void saveWithTimeout.catch((error) => logError('saveOpenTerminalState', error)).finally(() => mainWindow?.close());
  });

  mainWindow.on('closed', () => {
    closingAfterTerminalSave = false;
    mainWindow = null;
    setTerminalWindow(null);
  });
}

function notifyWorkspaceChange() {
  mainWindow?.webContents.send('workspace:changed');
}

function watchWorkspace(rootPath: string) {
  if (watchedWorkspaces.has(rootPath)) return;
  try {
    const state = { watcher: watch(rootPath, { recursive: true }, (_eventType, filename) => {
      if (filename) {
        const firstSegment = filename.split(/[\\/]/)[0];
        if (firstSegment && noisyWatchSegments.has(firstSegment)) return;
      }
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => mainWindow?.webContents.send('fs:changed', { rootPath }), 150);
    }), timer: null as NodeJS.Timeout | null };
    state.watcher.on('error', (error) => {
      void logError('watchWorkspace', error);
      state.watcher.close();
      watchedWorkspaces.delete(rootPath);
    });
    watchedWorkspaces.set(rootPath, state);
  } catch (error) {
    void logError('watchWorkspace', error);
  }
}

function registerIpc() {
  ipcMain.handle('app:pickWorkspaceFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('app:importJsonFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON files', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    const filePath = result.filePaths[0];
    if (!filePath) return null;
    return { path: filePath, content: await fs.readFile(filePath, 'utf8') };
  });
  ipcMain.handle('app:minimizeWindow', async () => { mainWindow?.minimize(); });
  ipcMain.handle('app:toggleMaximizeWindow', async () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('app:closeWindow', async () => { mainWindow?.close(); });
  ipcMain.handle('app:isWindowMaximized', async () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('app:windowControlsStyle', async () => windowControlsStyle());
  ipcMain.handle('app:setTitleBarOverlay', async (_event, options: unknown) => {
    if (!mainWindow || !nativeWindowControls) return;
    const value = options && typeof options === 'object' ? options as { color?: unknown; symbolColor?: unknown; height?: unknown } : {};
    const color = typeof value.color === 'string' ? value.color : '#1e2227';
    const symbolColor = typeof value.symbolColor === 'string' ? value.symbolColor : '#abb2bf';
    const height = typeof value.height === 'number' ? Math.max(32, Math.min(64, Math.round(value.height))) : 42;
    mainWindow.setTitleBarOverlay({ color, symbolColor, height });
  });
  ipcMain.handle('app:loadRestoreState', async () => loadRestoreState());
  ipcMain.handle('app:saveRestoreState', async (_event, state: unknown) => saveRestoreState(assertRestoreStateLike(state)));

  ipcMain.handle('workspaces:list', async () => listWorkspaces());
  ipcMain.handle('workspaces:add', async (_event, folderPath: unknown) => {
    const workspace = await addWorkspace(assertAbsolutePath(folderPath, 'folderPath'));
    notifyWorkspaceChange();
    return workspace;
  });
  ipcMain.handle('workspaces:create', async (_event, parentPath: unknown, name: unknown) => {
    const workspace = await createWorkspace(assertAbsolutePath(parentPath, 'parentPath'), assertSafeFileName(name, 'name'));
    notifyWorkspaceChange();
    return workspace;
  });
  ipcMain.handle('workspaces:update', async (_event, workspace) => {
    const result = await updateWorkspace(assertWorkspaceLike(workspace));
    notifyWorkspaceChange();
    return result;
  });
  ipcMain.handle('workspaces:remove', async (_event, id: unknown) => {
    await removeWorkspace(assertNonEmptyString(id, 'id'));
    notifyWorkspaceChange();
  });
  ipcMain.handle('workspaces:loadLayout', async (_event, workspaceId: unknown) => loadLayout(assertNonEmptyString(workspaceId, 'workspaceId')));
  ipcMain.handle('workspaces:saveLayout', async (_event, layout) => saveLayout(assertLayoutLike(layout)));

  ipcMain.handle('fs:readDirectory', async (_event, targetPath: unknown, options?: { showHidden?: boolean }) => readDirectory(assertAbsolutePath(targetPath, 'targetPath'), options));
  ipcMain.handle('fs:readFile', async (_event, targetPath: unknown) => readFile(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:readFileDataUrl', async (_event, targetPath: unknown) => readFileDataUrl(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:watchWorkspace', async (_event, targetPath: unknown) => watchWorkspace(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:writeFile', async (_event, targetPath: unknown, content: unknown) => writeFile(assertAbsolutePath(targetPath, 'targetPath'), assertString(content, 'content')));
  ipcMain.handle('fs:createFile', async (_event, targetPath: unknown) => createFile(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:createFolder', async (_event, targetPath: unknown) => createFolder(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:renamePath', async (_event, oldPath: unknown, newPath: unknown) => renamePath(assertAbsolutePath(oldPath, 'oldPath'), assertAbsolutePath(newPath, 'newPath')));
  ipcMain.handle('fs:deletePath', async (_event, targetPath: unknown) => deletePath(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:revealInExplorer', async (_event, targetPath: unknown) => revealInExplorer(assertAbsolutePath(targetPath, 'targetPath')));

  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    const target = assertNonEmptyString(url, 'url');
    if (!/^https?:\/\//i.test(target)) throw new Error('Only http(s) URLs can be opened externally');
    await shell.openExternal(target);
  });

  ipcMain.handle('git:status', async (_event, targetPath: unknown) => getGitStatus(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('git:diff', async (_event, targetPath: unknown, filePath?: unknown, staged?: boolean) => getGitDiff(assertAbsolutePath(targetPath, 'targetPath'), filePath == null ? undefined : assertNonEmptyString(filePath, 'filePath'), staged));
  ipcMain.handle('git:fileContents', async (_event, targetPath: unknown, filePath: unknown, staged?: boolean) => getGitFileContents(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath'), staged));
  ipcMain.handle('git:stage', async (_event, targetPath: unknown, filePath: unknown) => stageFile(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath')));
  ipcMain.handle('git:unstage', async (_event, targetPath: unknown, filePath: unknown) => unstageFile(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath')));
  ipcMain.handle('git:discard', async (_event, targetPath: unknown, filePath: unknown) => discardFile(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath')));
  ipcMain.handle('git:commit', async (_event, targetPath: unknown, message: unknown) => commit(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(message, 'message')));
  ipcMain.handle('git:addAll', async (_event, targetPath: unknown) => addAll(assertAbsolutePath(targetPath, 'targetPath')));

  ipcMain.handle('settings:load', async () => loadSettings());
  ipcMain.handle('settings:save', async (_event, settings) => saveSettings(settings));

  ipcMain.handle('automation:load', async () => loadAutomation());
  ipcMain.handle('automation:loadRaw', async () => loadAutomationRaw());
  ipcMain.handle('automation:saveRaw', async (_event, content: unknown) => saveAutomationRaw(assertString(content, 'content')));

  ipcMain.handle('attachments:inspectPath', async (_event, targetPath: unknown, source: unknown, options?: unknown) => inspectAttachmentPath(assertAbsolutePath(targetPath, 'targetPath'), assertTerminalAttachmentSource(source, 'source'), assertTerminalAttachmentOptions(options)));
  ipcMain.handle('attachments:savePastedImage', async (_event, dataUrl: unknown, name?: unknown, options?: unknown) => savePastedImageAttachment(assertNonEmptyString(dataUrl, 'dataUrl'), name == null ? undefined : assertNonEmptyString(name, 'name'), assertTerminalAttachmentOptions(options)));

  ipcMain.handle('terminal:profiles', async () => getTerminalProfiles());
  ipcMain.handle('terminal:create', async (_event, profileId: unknown, cwd: unknown, name?: unknown, startupCommand?: unknown, restoreId?: unknown, context?: unknown) => createTerminal(
    assertNonEmptyString(profileId, 'profileId'),
    assertAbsolutePath(cwd, 'cwd'),
    name == null ? undefined : assertNonEmptyString(name, 'name'),
    startupCommand == null || (typeof startupCommand === 'string' && !startupCommand.trim()) ? undefined : assertNonEmptyString(startupCommand, 'startupCommand'),
    restoreId == null ? undefined : assertNonEmptyString(restoreId, 'restoreId'),
    assertTerminalSessionContext(context),
  ));
  ipcMain.handle('terminal:restoreState', async () => loadOpenTerminalState());
  ipcMain.handle('terminal:write', async (_event, id: unknown, data: unknown) => writeTerminal(assertNonEmptyString(id, 'id'), assertString(data, 'data')));
  ipcMain.handle('terminal:resize', async (_event, id: unknown, cols: unknown, rows: unknown) => resizeTerminal(assertNonEmptyString(id, 'id'), assertNumber(cols, 'cols', 2, 500), assertNumber(rows, 'rows', 1, 500)));
  ipcMain.handle('terminal:setVisible', async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('ids must be an array');
    setVisibleTerminals(ids.map((id, index) => assertNonEmptyString(id, `ids[${index}]`)));
  });
  ipcMain.handle('terminal:kill', async (_event, id: unknown) => killTerminal(assertNonEmptyString(id, 'id')));
  ipcMain.handle('terminal:snapshot', async (_event, idOrRestoreId: unknown) => getTerminalSnapshot(assertNonEmptyString(idOrRestoreId, 'idOrRestoreId')));
  ipcMain.handle('terminal:forgetSnapshot', async (_event, idOrRestoreId: unknown) => forgetTerminalSnapshot(assertNonEmptyString(idOrRestoreId, 'idOrRestoreId')));
}

app.whenReady().then(async () => {
  // Drop the default OS application menu (File / Edit / View / …). StackDock
  // ships its own in-app topbar, so the native menu bar is just noise.
  Menu.setApplicationMenu(null);
  await ensureDataDirs();
  registerIpc();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', (event) => {
  if (quittingAfterSnapshotFlush) return;
  event.preventDefault();
  quittingAfterSnapshotFlush = true;
  void saveOpenTerminalState().catch((error) => logError('saveOpenTerminalState', error)).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  void logError('uncaughtException', error);
});

process.on('unhandledRejection', (error) => {
  void logError('unhandledRejection', error);
});

