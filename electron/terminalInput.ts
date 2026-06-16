import type { TerminalCommandHookContext, TerminalCommandIntegration, TerminalCommandSource } from './terminalIntegration';
import type { TerminalResumeState, TerminalSession, TerminalSnapshot } from '../src/shared/types';

export interface TerminalInputTransformEntry {
  session: TerminalSession;
  terminalIntegrations: TerminalCommandIntegration[];
  inputLine: string;
}

function mergeResumeState(current: TerminalResumeState | undefined, next: TerminalResumeState | undefined): TerminalResumeState | undefined {
  if (!next) return current;
  if (!current || current.integrationId !== next.integrationId) return next;
  return { ...current, ...next };
}

export function applyTerminalInputResumeState(session: TerminalSession, snapshot: TerminalSnapshot, resumeState: TerminalResumeState | undefined) {
  if (!resumeState) return;
  session.resumeState = mergeResumeState(session.resumeState, resumeState);
  snapshot.resumeState = mergeResumeState(snapshot.resumeState, session.resumeState);
}

export async function runTerminalCommandHooks(entry: TerminalInputTransformEntry, command: string, snapshot: TerminalSnapshot, context: Partial<TerminalCommandHookContext> & { source: TerminalCommandSource }) {
  const restoreId = entry.session.restoreId ?? entry.session.id;
  let current = command;
  const baseCtx: TerminalCommandHookContext = {
    restoreId,
    cwd: entry.session.cwd,
    name: entry.session.name,
    profileId: entry.session.profileId,
    session: entry.session,
    snapshot,
    ...context,
  };
  for (const integration of entry.terminalIntegrations) {
    try {
      const result = integration.beforeShellCommand
        ? await integration.beforeShellCommand(current, baseCtx)
        : baseCtx.source === 'interactive'
          ? await integration.resolveInteractiveCommand?.(current, baseCtx)
          : ['startup', 'resume', 'headless'].includes(baseCtx.source)
            ? await integration.resolveStartupCommand?.(current, baseCtx)
            : undefined;
      if (result) {
        current = result.command;
        applyTerminalInputResumeState(entry.session, snapshot, result.resumeState);
      }
    } catch (error) {
      console.warn(`[terminal] command hook failed (${integration.id})`, error);
    }
  }
  return current;
}

export async function resolveTerminalInteractiveCommand(entry: TerminalInputTransformEntry, command: string, snapshot: TerminalSnapshot) {
  return runTerminalCommandHooks(entry, command, snapshot, { source: 'interactive' });
}

export async function transformTerminalInput(entry: TerminalInputTransformEntry, data: string, snapshot: TerminalSnapshot) {
  let output = '';
  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const typed = entry.inputLine;
      const resolved = await resolveTerminalInteractiveCommand(entry, typed, snapshot);
      if (resolved.startsWith(typed)) output += `${resolved.slice(typed.length)}${char}`;
      else {
        console.warn('[terminal] command hook replacement ignored because it does not preserve typed prefix');
        output += char;
      }
      entry.inputLine = '';
    } else if (char === '\u0003') {
      entry.inputLine = '';
      output += char;
    } else if (char === '\b' || char === '\u007f') {
      entry.inputLine = entry.inputLine.slice(0, -1);
      output += char;
    } else if (char >= ' ' && char !== '\u007f') {
      entry.inputLine += char;
      output += char;
    } else {
      output += char;
    }
  }
  return output;
}
