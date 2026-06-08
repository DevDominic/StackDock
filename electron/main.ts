import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import { addWorkspace, listWorkspaces, loadLayout, removeWorkspace, saveLayout, updateWorkspace } from './workspaceStore';
import { createFile, createFolder, deletePath, readDirectory, readFile, renamePath, revealInExplorer, writeFile } from './fileService';
import { addAll, commit, discardFile, getGitDiff, getGitStatus, stageFile, unstageFile } from './gitService';
import { createTerminal, getTerminalProfiles, killTerminal, resizeTerminal, setTerminalWindow, writeTerminal } from './terminalManager';
import { ensureDataDirs } from './storage';
import { logError } from './log';

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
  ipcMain.handle('workspaces:add', async (_event, folderPath: string) => {
    const workspace = await addWorkspace(folderPath);
    notifyWorkspaceChange();
    return workspace;
  });
  ipcMain.handle('workspaces:update', async (_event, workspace) => {
    const result = await updateWorkspace(workspace);
    notifyWorkspaceChange();
    return result;
  });
  ipcMain.handle('workspaces:remove', async (_event, id: string) => {
    await removeWorkspace(id);
    notifyWorkspaceChange();
  });
  ipcMain.handle('workspaces:loadLayout', async (_event, workspaceId: string) => loadLayout(workspaceId));
  ipcMain.handle('workspaces:saveLayout', async (_event, layout) => saveLayout(layout));

  ipcMain.handle('fs:readDirectory', async (_event, targetPath: string) => readDirectory(targetPath));
  ipcMain.handle('fs:readFile', async (_event, targetPath: string) => readFile(targetPath));
  ipcMain.handle('fs:writeFile', async (_event, targetPath: string, content: string) => writeFile(targetPath, content));
  ipcMain.handle('fs:createFile', async (_event, targetPath: string) => createFile(targetPath));
  ipcMain.handle('fs:createFolder', async (_event, targetPath: string) => createFolder(targetPath));
  ipcMain.handle('fs:renamePath', async (_event, oldPath: string, newPath: string) => renamePath(oldPath, newPath));
  ipcMain.handle('fs:deletePath', async (_event, targetPath: string) => deletePath(targetPath));
  ipcMain.handle('fs:revealInExplorer', async (_event, targetPath: string) => revealInExplorer(targetPath));

  ipcMain.handle('git:status', async (_event, targetPath: string) => getGitStatus(targetPath));
  ipcMain.handle('git:diff', async (_event, targetPath: string, filePath?: string, staged?: boolean) => getGitDiff(targetPath, filePath, staged));
  ipcMain.handle('git:stage', async (_event, targetPath: string, filePath: string) => stageFile(targetPath, filePath));
  ipcMain.handle('git:unstage', async (_event, targetPath: string, filePath: string) => unstageFile(targetPath, filePath));
  ipcMain.handle('git:discard', async (_event, targetPath: string, filePath: string) => discardFile(targetPath, filePath));
  ipcMain.handle('git:commit', async (_event, targetPath: string, message: string) => commit(targetPath, message));
  ipcMain.handle('git:addAll', async (_event, targetPath: string) => addAll(targetPath));

  ipcMain.handle('terminal:profiles', async () => getTerminalProfiles());
  ipcMain.handle('terminal:create', async (_event, profileId: string, cwd: string, name?: string, startupCommand?: string) => createTerminal(profileId, cwd, name, startupCommand));
  ipcMain.handle('terminal:write', async (_event, id: string, data: string) => writeTerminal(id, data));
  ipcMain.handle('terminal:resize', async (_event, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows));
  ipcMain.handle('terminal:kill', async (_event, id: string) => killTerminal(id));
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

