import { create } from 'zustand';
import { api } from '../lib/api';
import type { HeadlessCommandRun, TerminalSessionUpdate, WorkspaceTerminalSession } from '../shared/types';

const HEADLESS_OUTPUT_MAX_CHARS = 128 * 1024;

function stripAnsi(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function isExitEchoLine(line: string) {
  const trimmed = line.trim();
  return trimmed === 'exit' || /^(?:PS\s+)?[A-Za-z]:[\\/].*>\s*exit$/i.test(trimmed);
}

function cleanHeadlessOutput(output: string, command: string) {
  let trimmed = stripAnsi(output);
  if (command) {
    const exactIndex = trimmed.lastIndexOf(command);
    const prefixIndex = exactIndex < 0 ? trimmed.lastIndexOf(command.slice(0, Math.min(command.length, 80))) : -1;
    const commandIndex = exactIndex >= 0 ? exactIndex : prefixIndex;
    if (commandIndex >= 0) trimmed = trimmed.slice(commandIndex + (exactIndex >= 0 ? command.length : 0));
  }
  return trimmed
    .split('\n')
    .filter((line, index) => !(index === 0 && !line.trim()))
    .filter((line) => !isExitEchoLine(line))
    .join('\n');
}

type PiJsonDetection = 'unknown' | 'plain' | 'pi-json';
type PiJsonStreamingProgressKind = 'thinking' | 'toolcall' | 'tool-output';

interface PiJsonRunState {
  pending: string;
  detection: PiJsonDetection;
  progress: string;
  assistantText: string;
  preJsonText: string;
  streamingProgressKind: PiJsonStreamingProgressKind | null;
  toolOutputTextByCallId: Record<string, string>;
}

const piJsonStates = new Map<string, PiJsonRunState>();
const PI_JSON_PROGRESS_MAX_CHARS = 16 * 1024;

function trimStartToLimit(value: string, limit = HEADLESS_OUTPUT_MAX_CHARS) {
  return value.length > limit ? value.slice(-limit) : value;
}

function appendBounded(current: string, next: string, limit = HEADLESS_OUTPUT_MAX_CHARS) {
  return trimStartToLimit(current + next, limit);
}

function appendProgressLine(state: PiJsonRunState, line: string) {
  const clean = stripAnsi(line).trim();
  if (!clean) return;
  const separator = state.progress && !state.progress.endsWith('\n') ? '\n' : '';
  state.progress = appendBounded(`${state.progress}${separator}${clean}`, '', PI_JSON_PROGRESS_MAX_CHARS);
  state.streamingProgressKind = null;
}

function appendProgressDelta(state: PiJsonRunState, kind: PiJsonStreamingProgressKind, value: string) {
  const clean = stripAnsi(value);
  if (!clean) return;
  if (state.streamingProgressKind !== kind && state.progress && !state.progress.endsWith('\n')) {
    state.progress = appendBounded(state.progress, '\n', PI_JSON_PROGRESS_MAX_CHARS);
  }
  state.progress = appendBounded(state.progress, clean, PI_JSON_PROGRESS_MAX_CHARS);
  state.streamingProgressKind = kind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function getDeltaText(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractTextContent(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractTextContent).filter(Boolean).join('');
  if (!isRecord(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return value.content.map(extractTextContent).filter(Boolean).join('');
  return '';
}

function formatToolName(event: Record<string, unknown>) {
  return getString(event.toolName) || getString(event.name) || 'Tool';
}

function formatToolInvocation(event: Record<string, unknown>) {
  const toolName = formatToolName(event);
  const args = isRecord(event.args) ? event.args : isRecord(event.input) ? event.input : null;
  const command = args ? getString(args.command) : '';
  const path = args ? getString(args.path) : '';
  if (command) return `${toolName}: ${command}`;
  if (path) return `${toolName}: ${path}`;
  return toolName;
}

function appendToolExecutionUpdate(state: PiJsonRunState, event: Record<string, unknown>) {
  const text = extractTextContent(event.partialResult ?? event.result ?? event.output);
  if (!text.trim()) return;
  const key = getString(event.toolCallId) || getString(event.id) || formatToolName(event);
  const previous = state.toolOutputTextByCallId[key] ?? '';
  let delta = '';
  if (text.startsWith(previous)) {
    delta = text.slice(previous.length);
    state.toolOutputTextByCallId[key] = text;
  } else if (previous && previous.endsWith(text)) {
    return;
  } else {
    delta = text;
    state.toolOutputTextByCallId[key] = appendBounded(previous, text, PI_JSON_PROGRESS_MAX_CHARS);
  }
  appendProgressDelta(state, 'tool-output', delta.replace(/^\n+/, ''));
}

function isPiJsonEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = getString(value.type);
  if (['agent_start', 'turn_start', 'message_update', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'message_end', 'turn_end', 'agent_end', 'auto_retry_start', 'compaction_start', 'compaction_end'].includes(type)) return true;
  if (isRecord(value.assistantMessageEvent)) return true;
  if (isRecord(value.message) || Array.isArray(value.messages)) return true;
  return false;
}

function extractAssistantText(message: unknown): string {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(extractAssistantText).filter(Boolean).join('');
  if (!isRecord(message)) return '';
  const role = getString(message.role);
  if (role && role !== 'assistant') return '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((block) => {
      if (typeof block === 'string') return block;
      if (!isRecord(block)) return '';
      const type = getString(block.type);
      if (type && type !== 'text' && type !== 'output_text') return '';
      return getString(block.text) || getString(block.content);
    }).join('');
  }
  return '';
}

function extractEventFinalText(event: Record<string, unknown>) {
  const messageText = extractAssistantText(event.message);
  if (messageText) return messageText;
  if (Array.isArray(event.messages)) {
    return event.messages.map(extractAssistantText).filter(Boolean).join('\n');
  }
  return '';
}

function formatPiJsonEvent(event: unknown, state: PiJsonRunState): Partial<HeadlessCommandRun> {
  if (!isRecord(event)) return {};
  const type = getString(event.type);
  if (type === 'agent_start') appendProgressLine(state, 'Agent started');
  else if (type === 'turn_start') appendProgressLine(state, 'Thinking…');
  else if (type === 'tool_execution_start') appendProgressLine(state, `Running ${formatToolInvocation(event)}…`);
  else if (type === 'tool_execution_update') appendToolExecutionUpdate(state, event);
  else if (type === 'tool_execution_end') {
    appendToolExecutionUpdate(state, event);
    appendProgressLine(state, `${formatToolName(event)} ${event.isError ? 'failed' : 'completed'}`);
  }
  else if (type === 'auto_retry_start') appendProgressLine(state, 'Retrying…');
  else if (type === 'compaction_start') appendProgressLine(state, 'Compacting context…');
  else if (type === 'compaction_end') appendProgressLine(state, 'Context compacted');

  const assistantEvent = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : isRecord(event.message_update) && isRecord(event.message_update.assistantMessageEvent) ? event.message_update.assistantMessageEvent : null;
  if (type === 'message_update' && assistantEvent) {
    const eventType = getString(assistantEvent.type);
    const delta = getDeltaText(assistantEvent.delta);
    if (eventType === 'thinking_delta') {
      const text = delta || getString(assistantEvent.thinking_delta);
      if (text) appendProgressDelta(state, 'thinking', text);
      else appendProgressLine(state, 'Thinking…');
    }
    if (eventType === 'text_delta') state.assistantText = appendBounded(state.assistantText, delta || getString(assistantEvent.text_delta));
    if (eventType === 'toolcall_delta') {
      const text = delta || getString(assistantEvent.toolcall_delta);
      if (text) appendProgressDelta(state, 'toolcall', text);
      else appendProgressLine(state, 'Tool call updated');
    }
  }

  if (type === 'message_end' || type === 'turn_end' || type === 'agent_end') {
    const finalText = extractEventFinalText(event);
    if (finalText) state.assistantText = trimStartToLimit(finalText);
  }

  return { outputFormat: 'pi-json', progress: state.progress, output: state.assistantText };
}

function commandLooksLikePiJson(command: string) {
  return /(^|[\s"'`])pi(?:\.cmd|\.exe)?(?=$|[\s"'`])/.test(command) && /--mode(?:=|\s+)json\b/.test(command);
}

function getPiJsonState(id: string, command: string) {
  let state = piJsonStates.get(id);
  if (!state) {
    state = { pending: '', detection: commandLooksLikePiJson(command) ? 'pi-json' : 'unknown', progress: '', assistantText: '', preJsonText: '', streamingProgressKind: null, toolOutputTextByCallId: {} };
    piJsonStates.set(id, state);
  }
  return state;
}

function appendPiJsonChunk(id: string, chunk: string, command: string, flush = false): Partial<HeadlessCommandRun> | null {
  const state = getPiJsonState(id, command);
  const incoming = stripAnsi(chunk);
  state.pending += incoming;
  const lines = state.pending.split('\n');
  state.pending = flush ? '' : lines.pop() ?? '';
  const completeLines = flush ? lines : lines;
  let patch: Partial<HeadlessCommandRun> | null = state.detection === 'pi-json' ? { outputFormat: 'pi-json', progress: state.progress, output: state.assistantText } : null;

  for (const line of completeLines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!isPiJsonEvent(parsed)) throw new Error('not pi json');
      if (state.detection !== 'pi-json' && state.preJsonText.trim()) {
        appendProgressLine(state, state.preJsonText);
        state.preJsonText = '';
      }
      state.detection = 'pi-json';
      patch = { ...patch, ...formatPiJsonEvent(parsed, state) };
    } catch {
      if (state.detection === 'pi-json') {
        appendProgressLine(state, line);
        patch = { outputFormat: 'pi-json', progress: state.progress, output: state.assistantText };
      } else {
        state.detection = 'plain';
        state.preJsonText = appendBounded(state.preJsonText, `${line}\n`, PI_JSON_PROGRESS_MAX_CHARS);
      }
    }
  }

  if (flush && state.pending.trim()) {
    if (state.detection === 'pi-json') appendProgressLine(state, state.pending);
    state.pending = '';
  }

  return patch;
}

function extractPiJsonFinalOutput(output: string) {
  let finalText = '';
  let detected = false;
  for (const line of stripAnsi(output).split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!isPiJsonEvent(parsed) || !isRecord(parsed)) continue;
      detected = true;
      const type = getString(parsed.type);
      if (type === 'message_end' || type === 'turn_end' || type === 'agent_end') {
        const text = extractEventFinalText(parsed);
        if (text) finalText = text;
      }
    } catch {
      // Ignore non-JSON result lines here; completion fallback handles them.
    }
  }
  return { detected, finalText: trimStartToLimit(finalText) };
}

interface CreateInput { workspaceId: string; workspaceName: string; workspacePath: string; profileId: string; cwd?: string; name?: string; startupCommand?: string; restoreId?: string; headless?: boolean; keepAlive?: boolean; commandLabel?: string; }
interface SessionState {
  sessions: WorkspaceTerminalSession[];
  headlessRuns: HeadlessCommandRun[];
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  createSession(input: CreateInput): Promise<WorkspaceTerminalSession>;
  closeSession(id: string): Promise<void>;
  appendHeadlessOutput(id: string, data: string): void;
  completeHeadlessRun(id: string, result: { output: string; exitCode: number | null; timedOut?: boolean; label?: string }): void;
  removeHeadlessRun(id: string): void;
  removeSessionLocal(id: string): void;
  renameSession(id: string, name: string): Promise<void>;
  updateSessionMetadata(id: string, patch: TerminalSessionUpdate): Promise<void>;
  replaceSession(id: string, next: WorkspaceTerminalSession): void;
  setActiveSession(id: string): void;
  setActiveWorkspace(id: string | null): void;
  getWorkspaceSessions(workspaceId: string): WorkspaceTerminalSession[];
}

function pickNextActiveSession(sessions: WorkspaceTerminalSession[], preferredWorkspaceId?: string | null, previousActiveSessionId?: string | null) {
  const sameWorkspace = preferredWorkspaceId ? sessions.find((session) => session.workspaceId === preferredWorkspaceId && session.id !== previousActiveSessionId) : null;
  return sameWorkspace ?? sessions.find((session) => session.id !== previousActiveSessionId) ?? sessions[0] ?? null;
}

function persistActiveSession(session: WorkspaceTerminalSession | null, workspaceIdFallback?: string | null) {
  if (session) {
    void api.app.saveRestoreState({ lastWorkspaceId: session.workspaceId, lastTerminalRestoreId: session.restoreId, lastTerminalRuntimeId: session.id }).catch(() => undefined);
  } else if (workspaceIdFallback) {
    void api.app.saveRestoreState({ lastWorkspaceId: workspaceIdFallback }).catch(() => undefined);
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  headlessRuns: [],
  activeSessionId: null,
  activeWorkspaceId: null,
  async createSession(input) {
    if (!input.headless && input.restoreId) {
      const existing = get().sessions.find((session) => session.restoreId === input.restoreId);
      if (existing) {
        set({ activeSessionId: existing.id, activeWorkspaceId: existing.workspaceId });
        persistActiveSession(existing);
        return existing;
      }
    }
    const terminal = await api.terminal.create(input.profileId, input.cwd ?? input.workspacePath, input.name, input.startupCommand, input.restoreId, { workspaceId: input.workspaceId, workspaceName: input.workspaceName, workspacePath: input.workspacePath, headless: input.headless, keepAlive: input.keepAlive, commandLabel: input.commandLabel });
    const session: WorkspaceTerminalSession = { ...terminal, workspaceId: input.workspaceId, workspaceName: input.workspaceName, workspacePath: input.workspacePath };
    if (input.headless) {
      const run: HeadlessCommandRun = {
        id: session.id,
        restoreId: session.restoreId,
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        workspacePath: input.workspacePath,
        label: input.commandLabel ?? input.name ?? session.name,
        command: session.startupCommand ?? input.startupCommand ?? '',
        cwd: input.cwd ?? input.workspacePath,
        startedAt: Date.now(),
        output: '',
      };
      set({ headlessRuns: [...get().headlessRuns.filter((item) => item.id !== run.id), run] });
      return session;
    }
    set({ sessions: [...get().sessions, session], activeSessionId: session.id, activeWorkspaceId: session.workspaceId });
    persistActiveSession(session);
    return session;
  },
  async closeSession(id) {
    const current = get();
    const closing = current.sessions.find((session) => session.id === id);
    await api.terminal.kill(id);
    if (closing?.restoreId) await api.terminal.forgetSnapshot(closing.restoreId).catch(() => undefined);
    const next = get().sessions.filter((session) => session.id !== id);
    if (get().activeSessionId !== id) {
      set({ sessions: next });
      return;
    }
    const picked = pickNextActiveSession(next, closing?.workspaceId ?? current.activeWorkspaceId, id);
    const fallbackWorkspaceId = picked?.workspaceId ?? closing?.workspaceId ?? current.activeWorkspaceId;
    set({ sessions: next, activeSessionId: picked?.id ?? null, activeWorkspaceId: fallbackWorkspaceId ?? null });
    persistActiveSession(picked, fallbackWorkspaceId);
  },
  appendHeadlessOutput(id, data) {
    set({ headlessRuns: get().headlessRuns.map((run) => {
      if (run.id !== id) return run;
      const piPatch = appendPiJsonChunk(id, data, run.command);
      if (piPatch?.outputFormat === 'pi-json') return { ...run, ...piPatch };
      return { ...run, output: cleanHeadlessOutput((run.output + data).slice(-HEADLESS_OUTPUT_MAX_CHARS), run.command), outputFormat: run.outputFormat ?? 'plain' };
    }) });
  },
  completeHeadlessRun(id, result) {
    set({ headlessRuns: get().headlessRuns.map((run) => {
      if (run.id !== id) return run;
      const piPatch = appendPiJsonChunk(id, '', run.command, true);
      const piState = piJsonStates.get(id);
      const finalResult = extractPiJsonFinalOutput(result.output);
      if ((piPatch?.outputFormat === 'pi-json' || piState?.detection === 'pi-json' || finalResult.detected)) {
        const parsedOutput = (finalResult.finalText || piPatch?.output || piState?.assistantText || run.output).trim();
        const fallback = cleanHeadlessOutput((result.output || piState?.progress || '').slice(-HEADLESS_OUTPUT_MAX_CHARS), run.command).trim();
        piJsonStates.delete(id);
        return { ...run, ...piPatch, label: result.label ?? run.label, output: parsedOutput || fallback, progress: piPatch?.progress ?? piState?.progress ?? run.progress, outputFormat: 'pi-json', completedAt: Date.now(), exitCode: result.exitCode, timedOut: result.timedOut };
      }
      piJsonStates.delete(id);
      const liveOutput = run.output.trim();
      const finalOutput = cleanHeadlessOutput((liveOutput || result.output).slice(-HEADLESS_OUTPUT_MAX_CHARS), run.command);
      return { ...run, label: result.label ?? run.label, output: finalOutput, completedAt: Date.now(), exitCode: result.exitCode, timedOut: result.timedOut };
    }) });
  },
  removeHeadlessRun(id) { piJsonStates.delete(id); set({ headlessRuns: get().headlessRuns.filter((run) => run.id !== id) }); },
  removeSessionLocal(id) {
    const current = get();
    const removing = current.sessions.find((session) => session.id === id);
    const next = current.sessions.filter((session) => session.id !== id);
    if (current.activeSessionId !== id) {
      set({ sessions: next });
      return;
    }
    const picked = pickNextActiveSession(next, removing?.workspaceId ?? current.activeWorkspaceId, id);
    const fallbackWorkspaceId = picked?.workspaceId ?? removing?.workspaceId ?? current.activeWorkspaceId;
    set({ sessions: next, activeSessionId: picked?.id ?? null, activeWorkspaceId: fallbackWorkspaceId ?? null });
    persistActiveSession(picked, fallbackWorkspaceId);
  },
  async renameSession(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await get().updateSessionMetadata(id, { name: trimmed });
  },
  async updateSessionMetadata(id, patch) {
    const current = get();
    const previous = current.sessions.find((session) => session.id === id);
    if (!previous) return;
    const applyPatch = (session: WorkspaceTerminalSession): WorkspaceTerminalSession => {
      const next: WorkspaceTerminalSession = { ...session };
      if (patch.name !== undefined) next.name = patch.name.trim();
      if (patch.splitGroupId !== undefined) {
        if (patch.splitGroupId === null) delete next.splitGroupId;
        else next.splitGroupId = patch.splitGroupId;
      }
      if (patch.splitDirection !== undefined) {
        if (patch.splitDirection === null) delete next.splitDirection;
        else next.splitDirection = patch.splitDirection;
      }
      if (patch.splitGroupOrder !== undefined) {
        if (patch.splitGroupOrder === null) delete next.splitGroupOrder;
        else next.splitGroupOrder = patch.splitGroupOrder;
      }
      return next;
    };
    set({ sessions: current.sessions.map((session) => session.id === id ? applyPatch(session) : session) });
    try {
      const updated = await api.terminal.update(id, patch);
      set({ sessions: get().sessions.map((session) => session.id === id ? { ...session, ...updated, workspaceId: session.workspaceId, workspaceName: session.workspaceName, workspacePath: session.workspacePath } : session) });
    } catch {
      // Keep the optimistic renderer/layout update even if the live terminal
      // record is unavailable; workspace layout persistence will still carry
      // rename/split metadata for restored or already-exited terminal records.
    }
  },
  replaceSession(id, next) {
    set({ sessions: get().sessions.map((session) => session.id === id ? next : session), activeSessionId: next.id, activeWorkspaceId: next.workspaceId });
    persistActiveSession(next);
  },
  setActiveSession(id) {
    const session = get().sessions.find((item) => item.id === id);
    set({ activeSessionId: id, activeWorkspaceId: session?.workspaceId ?? get().activeWorkspaceId });
    if (session) persistActiveSession(session);
  },
  setActiveWorkspace(id) {
    const activeSession = get().sessions.find((session) => session.id === get().activeSessionId && session.workspaceId === id) ?? null;
    set({ activeWorkspaceId: id });
    if (id) persistActiveSession(activeSession, id);
  },
  getWorkspaceSessions(workspaceId) { return get().sessions.filter((session) => session.workspaceId === workspaceId); },
}));
