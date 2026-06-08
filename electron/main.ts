import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import { addWorkspace, createWorkspace, listWorkspaces, loadLayout, removeWorkspace, saveLayout, updateWorkspace } from './workspaceStore';
import { createFile, createFolder, deletePath, readDirectory, readFile, renamePath, revealInExplorer, writeFile } from './fileService';
import { addAll, commit, discardFile, getGitDiff, getGitStatus, stageFile, unstageFile } from './gitService';
import { createTerminal, getTerminalProfiles, killTerminal, resizeTerminal, setTerminalWindow, writeTerminal } from './terminalManager';
import { ensureDataDirs } from './storage';
import { logError } from './log';
import { loadSettings, saveSettings } from './configStore';
import { assertAbsolutePath, assertLayoutLike, assertNonEmptyString, assertNumber, assertSafeFileName, assertString, assertWorkspaceLike } from './validation';

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0b0d12',
    title: 'StackDock',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setTerminalWindow(mainWindow);

  if (!app.isPackaged) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    setTerminalWindow(null);
  });
}

function notifyWorkspaceChange() {
  mainWindow?.webContents.send('workspace:changed');
}

function registerIpc() {
  ipcMain.handle('app:pickWorkspaceFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

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
  ipcMain.handle('fs:writeFile', async (_event, targetPath: unknown, content: unknown) => writeFile(assertAbsolutePath(targetPath, 'targetPath'), assertString(content, 'content')));
  ipcMain.handle('fs:createFile', async (_event, targetPath: unknown) => createFile(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:createFolder', async (_event, targetPath: unknown) => createFolder(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:renamePath', async (_event, oldPath: unknown, newPath: unknown) => renamePath(assertAbsolutePath(oldPath, 'oldPath'), assertAbsolutePath(newPath, 'newPath')));
  ipcMain.handle('fs:deletePath', async (_event, targetPath: unknown) => deletePath(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('fs:revealInExplorer', async (_event, targetPath: unknown) => revealInExplorer(assertAbsolutePath(targetPath, 'targetPath')));

  ipcMain.handle('git:status', async (_event, targetPath: unknown) => getGitStatus(assertAbsolutePath(targetPath, 'targetPath')));
  ipcMain.handle('git:diff', async (_event, targetPath: unknown, filePath?: unknown, staged?: boolean) => getGitDiff(assertAbsolutePath(targetPath, 'targetPath'), filePath == null ? undefined : assertNonEmptyString(filePath, 'filePath'), staged));
  ipcMain.handle('git:stage', async (_event, targetPath: unknown, filePath: unknown) => stageFile(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath')));
  ipcMain.handle('git:unstage', async (_event, targetPath: unknown, filePath: unknown) => unstageFile(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath')));
  ipcMain.handle('git:discard', async (_event, targetPath: unknown, filePath: unknown) => discardFile(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(filePath, 'filePath')));
  ipcMain.handle('git:commit', async (_event, targetPath: unknown, message: unknown) => commit(assertAbsolutePath(targetPath, 'targetPath'), assertNonEmptyString(message, 'message')));
  ipcMain.handle('git:addAll', async (_event, targetPath: unknown) => addAll(assertAbsolutePath(targetPath, 'targetPath')));

  ipcMain.handle('settings:load', async () => loadSettings());
  ipcMain.handle('settings:save', async (_event, settings) => saveSettings(settings));

  ipcMain.handle('terminal:profiles', async () => getTerminalProfiles());
  ipcMain.handle('terminal:create', async (_event, profileId: unknown, cwd: unknown, name?: unknown, startupCommand?: unknown) => createTerminal(assertNonEmptyString(profileId, 'profileId'), assertAbsolutePath(cwd, 'cwd'), name == null ? undefined : assertNonEmptyString(name, 'name'), startupCommand == null ? undefined : assertNonEmptyString(startupCommand, 'startupCommand')));
  ipcMain.handle('terminal:write', async (_event, id: unknown, data: unknown) => writeTerminal(assertNonEmptyString(id, 'id'), assertNonEmptyString(data, 'data')));
  ipcMain.handle('terminal:resize', async (_event, id: unknown, cols: unknown, rows: unknown) => resizeTerminal(assertNonEmptyString(id, 'id'), assertNumber(cols, 'cols', 2, 500), assertNumber(rows, 'rows', 1, 500)));
  ipcMain.handle('terminal:kill', async (_event, id: unknown) => killTerminal(assertNonEmptyString(id, 'id')));
}

app.whenReady().then(async () => {
  await ensureDataDirs();
  registerIpc();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
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

