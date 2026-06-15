import type { TerminalSession } from '../shared/types';

export interface TerminalMarkdownState {
  inFence: boolean;
  pending: string;
}

const FENCE_PATTERN = /^\s*```([A-Za-z0-9_-]+)?\s*$/;
const CONTROL_EXCEPT_NEWLINES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const ANSI_ESCAPE = '\x1b';
const FENCE_STYLE = '\x1b[2;36m';
const INLINE_CODE_STYLE = '\x1b[96m';
const CODE_BLOCK_STYLE = '\x1b[48;5;236;38;5;252m';
const RESET = '\x1b[0m';
const PI_INTEGRATION_ID = 'stackdock.pi';

interface LinePart {
  body: string;
  ending: string;
}

export function createTerminalMarkdownState(): TerminalMarkdownState {
  return { inFence: false, pending: '' };
}

export function shouldFormatTerminalMarkdown(session: TerminalSession): boolean {
  return session.profileId === 'pi'
    || session.resumeState?.integrationId === PI_INTEGRATION_ID
    || /^\s*pi(?:\s|$)/i.test(session.startupCommand ?? '');
}

function splitCompleteLines(value: string): { lines: LinePart[]; pending: string } {
  const lines: LinePart[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\r' && char !== '\n') continue;
    const body = value.slice(start, index);
    let ending = char;
    if (char === '\r' && value[index + 1] === '\n') {
      ending = '\r\n';
      index += 1;
    }
    lines.push({ body, ending });
    start = index + 1;
  }
  return { lines, pending: value.slice(start) };
}

function containsTerminalControl(value: string) {
  return value.includes(ANSI_ESCAPE) || CONTROL_EXCEPT_NEWLINES.test(value);
}

function styleInlineCode(value: string) {
  if (!value.includes('`')) return value;
  return value.replace(/`([^`\r\n]+)`/g, `${INLINE_CODE_STYLE}\`$1\`${RESET}`);
}

function formatLine(part: LinePart, state: TerminalMarkdownState) {
  const { body, ending } = part;
  if (containsTerminalControl(body)) return `${body}${ending}`;

  if (FENCE_PATTERN.test(body)) {
    state.inFence = !state.inFence;
    return `${FENCE_STYLE}${body}${RESET}${ending}`;
  }

  if (state.inFence) return `${CODE_BLOCK_STYLE}${body}${RESET}${ending}`;
  return `${styleInlineCode(body)}${ending}`;
}

export function formatTerminalMarkdownChunk(input: string, state: TerminalMarkdownState): string {
  if (!input) return '';
  const combined = state.pending + input;
  const { lines, pending } = splitCompleteLines(combined);
  state.pending = pending;
  return lines.map((line) => formatLine(line, state)).join('');
}

export function flushTerminalMarkdownState(state: TerminalMarkdownState): string {
  if (!state.pending) return '';
  const pending = state.pending;
  state.pending = '';
  return formatLine({ body: pending, ending: '' }, state);
}
