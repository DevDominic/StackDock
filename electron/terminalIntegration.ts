import type { TerminalResumeState, TerminalSession, TerminalSnapshot } from '../src/shared/types';

export type MaybePromise<T> = T | Promise<T>;
export type TerminalCommandSource = 'interactive' | 'startup' | 'resume' | 'headless' | 'programmatic';

export interface TerminalStartupCommandContext {
  restoreId: string;
  cwd: string;
  name?: string;
}

export type TerminalInteractiveCommandContext = TerminalStartupCommandContext;

export interface TerminalCommandHookContext extends TerminalStartupCommandContext {
  source: TerminalCommandSource;
  session?: TerminalSession;
  snapshot?: TerminalSnapshot;
  profileId?: string;
  shell?: string;
}

export interface TerminalStartupCommandResult {
  command: string;
  resumeState?: TerminalResumeState;
}

export type TerminalInteractiveCommandResult = TerminalStartupCommandResult;
export type TerminalCommandHookResult = TerminalStartupCommandResult;

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
  beforeShellCommand?(command: string, ctx: TerminalCommandHookContext): MaybePromise<TerminalCommandHookResult | undefined>;
  resolveStartupCommand?(command: string, ctx: TerminalStartupCommandContext): MaybePromise<TerminalStartupCommandResult | undefined>;
  resolveInteractiveCommand?(command: string, ctx: TerminalInteractiveCommandContext): MaybePromise<TerminalInteractiveCommandResult | undefined>;
  captureResumeState?(ctx: TerminalOutputContext): TerminalResumeState | undefined;
  buildResumeCommand?(ctx: TerminalResumeContext): string | undefined;
  detectSnapshotResumeState?(ctx: TerminalSnapshotContext): TerminalResumeState | undefined;
  ownsCommand?(command: string): boolean;
}
