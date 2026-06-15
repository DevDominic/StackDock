import type { TerminalResumeState, TerminalSession, TerminalSnapshot } from '../src/shared/types';

export interface TerminalStartupCommandContext {
  restoreId: string;
  cwd: string;
  name?: string;
}

export type TerminalInteractiveCommandContext = TerminalStartupCommandContext;

export interface TerminalStartupCommandResult {
  command: string;
  resumeState?: TerminalResumeState;
}

export type TerminalInteractiveCommandResult = TerminalStartupCommandResult;

export interface TerminalOutputContext {
  data: string;
  recentOutput: string;
  session: TerminalSession;
  snapshot: TerminalSnapshot;
}

export interface TerminalResumeContext {
  session: TerminalSession;
  snapshot?: TerminalSnapshot | null;
}

export interface TerminalSnapshotContext {
  snapshot: TerminalSnapshot;
}

export interface TerminalCommandIntegration {
  id: string;
  resolveStartupCommand?(command: string, ctx: TerminalStartupCommandContext): TerminalStartupCommandResult | undefined;
  resolveInteractiveCommand?(command: string, ctx: TerminalInteractiveCommandContext): TerminalInteractiveCommandResult | undefined;
  captureResumeState?(ctx: TerminalOutputContext): TerminalResumeState | undefined;
  buildResumeCommand?(ctx: TerminalResumeContext): string | undefined;
  detectSnapshotResumeState?(ctx: TerminalSnapshotContext): TerminalResumeState | undefined;
  ownsCommand?(command: string): boolean;
}
