import fs from 'fs/promises';
import type { AutomationConfig, PaletteCommand, WorkspaceSetup } from '../src/shared/types';
import { ensureDataDirs, getAutomationPath } from './storage';

export function getDefaultAutomation(): AutomationConfig {
  return { commands: [], workspaces: {} };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'command';
}

function normalizeCommand(value: unknown): PaletteCommand | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label : typeof record.name === 'string' ? record.name : '';
  const command = typeof record.command === 'string' ? record.command : '';
  if (!label.trim() || !command.trim()) return null;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : slugify(label);
  const cwd = typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd : undefined;
  return cwd ? { id, label, command, cwd } : { id, label, command };
}

function normalizeCommands(value: unknown): PaletteCommand[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCommand).filter((command): command is PaletteCommand => command !== null);
}

function normalizeSetup(value: unknown): WorkspaceSetup {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const setup: WorkspaceSetup = {};
  if (typeof record.defaultTerminalProfile === 'string' && record.defaultTerminalProfile.trim()) setup.defaultTerminalProfile = record.defaultTerminalProfile.trim();
  if (typeof record.newSessionCommand === 'string' && record.newSessionCommand.trim()) setup.newSessionCommand = record.newSessionCommand;
  const commands = normalizeCommands(record.commands);
  if (commands.length) setup.commands = commands;
  return setup;
}

export function normalizeAutomation(raw: unknown): AutomationConfig {
  if (!raw || typeof raw !== 'object') return getDefaultAutomation();
  const record = raw as Record<string, unknown>;
  const workspaces: Record<string, WorkspaceSetup> = {};
  if (record.workspaces && typeof record.workspaces === 'object') {
    for (const [key, value] of Object.entries(record.workspaces as Record<string, unknown>)) {
      workspaces[key] = normalizeSetup(value);
    }
  }
  return { commands: normalizeCommands(record.commands), workspaces };
}

export async function loadAutomation(): Promise<AutomationConfig> {
  await ensureDataDirs();
  try {
    return normalizeAutomation(JSON.parse(await fs.readFile(getAutomationPath(), 'utf8')));
  } catch {
    return getDefaultAutomation();
  }
}

export async function loadAutomationRaw(): Promise<string> {
  await ensureDataDirs();
  try {
    return await fs.readFile(getAutomationPath(), 'utf8');
  } catch {
    return JSON.stringify(getDefaultAutomation(), null, 2);
  }
}

export async function saveAutomationRaw(content: string): Promise<AutomationConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Config must be a JSON object with "commands" and "workspaces"');
  const normalized = normalizeAutomation(parsed);
  await ensureDataDirs();
  await fs.writeFile(getAutomationPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}
