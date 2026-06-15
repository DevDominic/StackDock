import path from 'path';
import type { TerminalCommandIntegration, TerminalResumeContext, TerminalSnapshotContext, TerminalStartupCommandContext, TerminalStartupCommandResult, TerminalOutputContext } from '../../../../electron/terminalIntegration';
import { getDataDir } from '../../../../electron/storage';
import type { StackDockSettings, TerminalProfile, TerminalResumeState, TerminalSession, TerminalSnapshot } from '../../../../src/shared/types';
import { piExtensionManifest } from '../manifest';

const PI_EXTENSION_ID = piExtensionManifest.id;
const PI_RESUME_PATTERN = /To resume this session:\s*(pi\s+--session\s+([A-Za-z0-9][A-Za-z0-9._-]{0,200}))/i;
const PI_COMMAND_PATTERN = /^\s*pi(?:\s|$)/i;
const SHELL_META_PATTERN = /[|&;<>]/;
const DIRECT_SESSION_ARG_PATTERN = /(?:^|\s)(?:--session(?:\s|=)|--session-id(?:\s|=)|--fork(?:\s|=)|--resume\b|-r\b|--continue\b|-c\b|--no-session\b)/i;
const NON_INTERACTIVE_ARG_PATTERN = /(?:^|\s)(?:--print\b|-p\b|--mode\s+(?:text|json|rpc)\b)/i;

interface PiConfig {
  stableSessionIds: boolean;
  useStackDockSessionDir: boolean;
}

type LegacyPiCarrier = {
  resumeState?: TerminalResumeState;
  piSessionId?: unknown;
  piResumeCommand?: unknown;
  startupCommand?: string;
};

export const piTerminalProfile: TerminalProfile = {
  id: 'pi',
  name: 'Pi',
  shell: 'cmd.exe',
  args: [],
  startupCommand: 'pi',
};

function getPiConfig(settings: StackDockSettings): PiConfig {
  const config = settings.extensions.config?.[PI_EXTENSION_ID] ?? {};
  return {
    stableSessionIds: config.stableSessionIds !== false,
    useStackDockSessionDir: config.useStackDockSessionDir === true,
  };
}

function quoteArg(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function cleanSessionIdPart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '') || 'session';
}

function stackDockPiSessionId(restoreId: string) {
  return `stackdock.${cleanSessionIdPart(restoreId)}`;
}

function getStackDockPiSessionsDir() {
  return path.join(getDataDir(), 'extensions', PI_EXTENSION_ID, 'sessions');
}

function ownsPiCommand(command: string) {
  return PI_COMMAND_PATTERN.test(command);
}

function isSessionablePiCommand(command: string) {
  const args = command.replace(/^\s*pi(?:\s+|$)/i, '').trim();
  return !args || args.startsWith('-');
}

function isSafeSinglePiCommand(command: string) {
  return ownsPiCommand(command) && !SHELL_META_PATTERN.test(command);
}

function hasDirectSessionArg(command: string) {
  return DIRECT_SESSION_ARG_PATTERN.test(command);
}

function isNonInteractivePiCommand(command: string) {
  return NON_INTERACTIVE_ARG_PATTERN.test(command);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripQuotes(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function getLongArg(command: string, name: string) {
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:=("[^"]*"|'[^']*'|\\S+)|\\s+("[^"]*"|'[^']*'|\\S+))`, 'i');
  const match = command.match(pattern);
  return stripQuotes(match?.[1] ?? match?.[2]);
}

function hasLongArg(command: string, name: string) {
  return new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s|=|$)`, 'i').test(command);
}

function appendArgs(command: string, args: string[]) {
  return [command.trim(), ...args].filter(Boolean).join(' ');
}

function buildPiResumeCommand(sessionId: string | undefined, storagePath: string | undefined, fallback?: string) {
  if (sessionId?.trim()) {
    const args = ['--session-id', quoteArg(sessionId.trim())];
    if (storagePath?.trim()) args.push('--session-dir', quoteArg(storagePath.trim()));
    return appendArgs('pi', args);
  }
  if (!fallback?.trim()) return undefined;
  if (storagePath?.trim() && !hasLongArg(fallback, '--session-dir')) return appendArgs(fallback, ['--session-dir', quoteArg(storagePath.trim())]);
  return fallback.trim();
}

function stateFromCommand(command: string, storagePath?: string): TerminalResumeState | undefined {
  if (!ownsPiCommand(command)) return undefined;
  const sessionId = getLongArg(command, '--session-id');
  const commandSessionDir = getLongArg(command, '--session-dir') ?? storagePath;
  if (sessionId) return { integrationId: PI_EXTENSION_ID, sessionId, storagePath: commandSessionDir, resumeCommand: buildPiResumeCommand(sessionId, commandSessionDir) };
  return undefined;
}

function stateFromCarrier(source: LegacyPiCarrier | null | undefined): TerminalResumeState | undefined {
  const resumeState = source?.resumeState;
  if (resumeState?.integrationId === PI_EXTENSION_ID) return resumeState;
  const legacySessionId = typeof source?.piSessionId === 'string' ? source.piSessionId : undefined;
  const legacyResumeCommand = typeof source?.piResumeCommand === 'string' ? source.piResumeCommand : undefined;
  if (legacySessionId) return { integrationId: PI_EXTENSION_ID, sessionId: legacySessionId, resumeCommand: buildPiResumeCommand(legacySessionId, undefined) };
  if (legacyResumeCommand && !hasLongArg(legacyResumeCommand, '--name')) return { integrationId: PI_EXTENSION_ID, resumeCommand: legacyResumeCommand };
  return undefined;
}

function resolveState(session?: TerminalSession | null, snapshot?: TerminalSnapshot | null) {
  return stateFromCarrier(session as LegacyPiCarrier | null | undefined) ?? stateFromCarrier(snapshot as LegacyPiCarrier | null | undefined);
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function detectPiSnapshotOutput(output?: string) {
  if (!output) return false;
  const text = stripAnsi(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const tail = text.split('\n').slice(-80).join('\n');
  const versionIndex = tail.search(/\bpi\s+v\d+\.\d+\.\d+/i);
  const statusMatch = tail.match(/Model scope:|caveman level:|OpenAI cache|\bMCP:\s*\d+\/\d+/i);
  if (versionIndex < 0 || !statusMatch) return false;
  const afterPiUi = tail.slice(Math.max(versionIndex, statusMatch.index ?? 0));
  return !/(?:^|\n)\s*(?:PS\s+)?[A-Za-z]:\\[^\n>]*>\s*$|(?:^|\n)\s*[^\n]*[$#]\s*$/m.test(afterPiUi);
}

function resolveStartupCommand(command: string, ctx: TerminalStartupCommandContext, config: PiConfig): TerminalStartupCommandResult | undefined {
  const trimmed = command.trim();
  if (!trimmed || !isSafeSinglePiCommand(trimmed)) return undefined;

  const commandSessionDir = getLongArg(trimmed, '--session-dir');
  const storagePath = commandSessionDir ?? (config.useStackDockSessionDir ? getStackDockPiSessionsDir() : undefined);
  const directState = stateFromCommand(trimmed, storagePath);
  if (directState || hasDirectSessionArg(trimmed) || isNonInteractivePiCommand(trimmed)) return { command: trimmed, resumeState: directState };
  if (!isSessionablePiCommand(trimmed) || !config.stableSessionIds) return { command: trimmed };

  const sessionId = stackDockPiSessionId(ctx.restoreId);
  const args = ['--session-id', quoteArg(sessionId)];
  if (storagePath && !hasLongArg(trimmed, '--session-dir')) args.push('--session-dir', quoteArg(storagePath));
  const nextCommand = appendArgs(trimmed, args);
  return {
    command: nextCommand,
    resumeState: {
      integrationId: PI_EXTENSION_ID,
      sessionId,
      storagePath,
      resumeCommand: buildPiResumeCommand(sessionId, storagePath),
    },
  };
}

function captureResumeState(ctx: TerminalOutputContext): TerminalResumeState | undefined {
  const match = ctx.data.match(PI_RESUME_PATTERN) ?? ctx.recentOutput.match(PI_RESUME_PATTERN);
  if (!match?.[2]) return undefined;
  const existing = resolveState(ctx.session, ctx.snapshot);
  const sessionId = match[2];
  const storagePath = existing?.storagePath;
  return {
    integrationId: PI_EXTENSION_ID,
    sessionId,
    storagePath,
    resumeCommand: buildPiResumeCommand(sessionId, storagePath, match[1].replace(/\s+/g, ' ').trim()),
  };
}

function buildResumeCommand(ctx: TerminalResumeContext): string | undefined {
  if (!detectPiSnapshotOutput(ctx.snapshot?.output)) return undefined;
  const state = resolveState(ctx.session, ctx.snapshot);
  if (state?.sessionId) return buildPiResumeCommand(state.sessionId, state.storagePath, state.resumeCommand);
  return undefined;
}

function detectSnapshotResumeState(ctx: TerminalSnapshotContext): TerminalResumeState | undefined {
  const existing = stateFromCarrier(ctx.snapshot as LegacyPiCarrier);
  if (existing?.sessionId) return existing;
  return undefined;
}

export function createPiTerminalIntegration(settings: StackDockSettings): TerminalCommandIntegration {
  const config = getPiConfig(settings);
  return {
    id: PI_EXTENSION_ID,
    ownsCommand: ownsPiCommand,
    resolveStartupCommand: (command, ctx) => resolveStartupCommand(command, ctx, config),
    resolveInteractiveCommand: (command, ctx) => resolveStartupCommand(command, ctx, config),
    captureResumeState,
    buildResumeCommand,
    detectSnapshotResumeState,
  };
}
