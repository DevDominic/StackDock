import type { TerminalCommandIntegration } from './terminalIntegration';
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

export function resolveTerminalInteractiveCommand(entry: TerminalInputTransformEntry, command: string, snapshot: TerminalSnapshot) {
  const restoreId = entry.session.restoreId ?? entry.session.id;
  for (const integration of entry.terminalIntegrations) {
    const result = integration.resolveInteractiveCommand?.(command, { restoreId, cwd: entry.session.cwd, name: entry.session.name });
    if (result) {
      applyTerminalInputResumeState(entry.session, snapshot, result.resumeState);
      return result.command;
    }
  }
  return command;
}

export function transformTerminalInput(entry: TerminalInputTransformEntry, data: string, snapshot: TerminalSnapshot) {
  let output = '';
  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const typed = entry.inputLine;
      const resolved = resolveTerminalInteractiveCommand(entry, typed, snapshot);
      output += `${resolved.startsWith(typed) ? resolved.slice(typed.length) : resolved}${char}`;
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
