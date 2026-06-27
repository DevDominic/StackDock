import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { app, shell } from 'electron';
import type { LaunchDiagnosticExportOptions, LaunchInfo, ReleaseNotesState, StackDockSettings } from '../src/shared/types';
import { loadAutomationRaw } from './automationStore';
import { getDefaultSettings, loadSettings, saveSettings } from './configStore';
import { getBundledExtensionManifests, loadExtensions } from './extensionService';
import { ensureDataDirs, getAutomationPath, getConfigPath, getDataDir, getLayoutsDir, getLogsDir, getRestoreStatePath, getTerminalSnapshotsDir, getTerminalStatePath, getWorkspacesPath } from './storage';
import { listWorkspaces, resetLayout } from './workspaceStore';

const RELEASE_NOTES_VERSION = '0.1.0';
const safeModeBackupPrefix = 'config.safe-mode-backup';

function releaseStatePath() {
  return path.join(getDataDir(), 'release-state.json');
}

function diagnosticsDir() {
  return path.join(getDataDir(), 'diagnostics');
}

function backupsDir() {
  return path.join(getDataDir(), 'backups');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeModeRequested() {
  return process.env.STACKDOCK_SAFE_MODE === '1' || process.argv.includes('--safe-mode');
}

function redactPath(value: string | undefined, redact = true) {
  if (!value || !redact) return value;
  return path.basename(value) || '<redacted>';
}

async function readTextIfExists(filePath: string) {
  try { return await fs.readFile(filePath, 'utf8'); } catch { return ''; }
}

async function fileExists(filePath: string) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function logsTail() {
  const file = path.join(getLogsDir(), 'app.log');
  const text = await readTextIfExists(file);
  return text.slice(-24 * 1024);
}

async function spawnDetached(command: string, args: string[] = [], options: { cwd?: string; windowsHide?: boolean } = {}) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, detached: true, stdio: 'ignore', windowsHide: options.windowsHide });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function isSafeModeActive() {
  return safeModeRequested();
}

export function applySafeModeSettings(settings: StackDockSettings): StackDockSettings {
  if (!isSafeModeActive()) return settings;
  return {
    ...settings,
    extensions: {
      ...settings.extensions,
      localPackagePaths: [],
      enabled: [],
    },
  };
}

export async function getLaunchInfo(): Promise<LaunchInfo> {
  await ensureDataDirs();
  return {
    version: app.getVersion(),
    releaseNotesVersion: RELEASE_NOTES_VERSION,
    safeMode: isSafeModeActive(),
    dataPath: getDataDir(),
    logsPath: getLogsDir(),
  };
}

export async function getReleaseNotesState(): Promise<ReleaseNotesState> {
  await ensureDataDirs();
  try {
    const parsed = JSON.parse(await fs.readFile(releaseStatePath(), 'utf8')) as Partial<ReleaseNotesState>;
    return { version: RELEASE_NOTES_VERSION, seen: parsed.version === RELEASE_NOTES_VERSION && parsed.seen === true };
  } catch {
    return { version: RELEASE_NOTES_VERSION, seen: false };
  }
}

export async function markReleaseNotesSeen(version = RELEASE_NOTES_VERSION): Promise<ReleaseNotesState> {
  await ensureDataDirs();
  const state = { version, seen: true };
  await fs.writeFile(releaseStatePath(), JSON.stringify(state, null, 2), 'utf8');
  return getReleaseNotesState();
}

export async function exportDiagnostics(options: LaunchDiagnosticExportOptions = {}) {
  await ensureDataDirs();
  await fs.mkdir(diagnosticsDir(), { recursive: true });
  const redact = options.redactPaths !== false;
  const settings = await loadSettings();
  const workspaces = await listWorkspaces();
  const extensions = await loadExtensions(applySafeModeSettings(settings));
  const automationRaw = await loadAutomationRaw().catch(() => '');
  const diagnostics = {
    exportedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      safeMode: isSafeModeActive(),
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpus: os.cpus().length,
    },
    workspace: options.workspaceId ? {
      id: options.workspaceId,
      name: options.workspaceName,
      path: redactPath(options.workspacePath, redact),
    } : null,
    paths: {
      data: redactPath(getDataDir(), redact),
      config: redactPath(getConfigPath(), redact),
      logs: redactPath(getLogsDir(), redact),
    },
    settings: {
      themeId: settings.themeId,
      terminalProfiles: settings.terminalProfiles.map((profile) => ({ id: profile.id, name: profile.name, shell: redactPath(profile.shell, redact), args: profile.args })),
      extensions: {
        localPackageCount: settings.extensions.localPackagePaths.length,
        localPackagePaths: settings.extensions.localPackagePaths.map((item) => redactPath(item, redact)),
        enabled: settings.extensions.enabled,
        disabled: settings.extensions.disabled,
      },
      terminal: settings.terminal,
      keybindCount: Object.keys(settings.keybinds).length,
    },
    workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, path: redactPath(workspace.path, redact), trusted: workspace.trusted !== false, pinned: workspace.pinned === true })),
    extensions: {
      loaded: extensions.extensions.map((extension) => ({ id: extension.id, name: extension.name, version: extension.version, source: extension.source })),
      errors: extensions.errors,
    },
    automation: {
      bytes: automationRaw.length,
      path: redactPath(getAutomationPath(), redact),
    },
    files: {
      config: await fileExists(getConfigPath()),
      workspaces: await fileExists(getWorkspacesPath()),
      restoreState: await fileExists(getRestoreStatePath()),
      terminalState: await fileExists(getTerminalStatePath()),
      terminalSnapshots: await fileExists(getTerminalSnapshotsDir()),
      layouts: await fileExists(getLayoutsDir()),
    },
    logsTail: await logsTail(),
  };
  const filePath = path.join(diagnosticsDir(), `stackdock-diagnostics-${stamp()}.json`);
  await fs.writeFile(filePath, JSON.stringify(diagnostics, null, 2), 'utf8');
  return { path: filePath };
}

export async function exportSettingsBackup() {
  await ensureDataDirs();
  await fs.mkdir(backupsDir(), { recursive: true });
  const target = path.join(backupsDir(), `config-${stamp()}.json`);
  const source = getConfigPath();
  if (await fileExists(source)) await fs.copyFile(source, target);
  else await fs.writeFile(target, JSON.stringify(getDefaultSettings(), null, 2), 'utf8');
  return { path: target };
}

export async function resetSettingsToDefaults() {
  return saveSettings(getDefaultSettings());
}

export async function resetWorkspaceLayout(workspaceId: string) {
  await resetLayout(workspaceId);
}

export async function enableSafeModeForNextLaunch() {
  await ensureDataDirs();
  const backup = path.join(backupsDir(), `${safeModeBackupPrefix}-${stamp()}.json`);
  await fs.mkdir(backupsDir(), { recursive: true });
  const current = await loadSettings();
  await fs.writeFile(backup, JSON.stringify(current, null, 2), 'utf8');
  const bundledIds = new Set(getBundledExtensionManifests().map((manifest) => manifest.id));
  const next: StackDockSettings = {
    ...current,
    extensions: {
      ...current.extensions,
      localPackagePaths: [],
      enabled: current.extensions.enabled.filter((id) => bundledIds.has(id)),
    },
  };
  await saveSettings(next);
  return { backupPath: backup };
}

export async function openLogsFolder() {
  await ensureDataDirs();
  const result = await shell.openPath(getLogsDir());
  if (result) throw new Error(result);
}

export async function openExternalTerminal(cwd: string) {
  if (process.platform === 'win32') {
    const cdCommand = `cd /d "${cwd.replace(/"/g, '""')}"`;
    await spawnDetached('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', cdCommand], { windowsHide: false });
    return;
  }
  if (process.platform === 'darwin') {
    await spawnDetached('open', ['-a', 'Terminal', cwd]);
    return;
  }
  const candidates = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal'];
  for (const command of candidates) {
    try {
      await spawnDetached(command, [], { cwd });
      return;
    } catch {
      // Try the next common terminal command.
    }
  }
  throw new Error('Could not open external terminal');
}
