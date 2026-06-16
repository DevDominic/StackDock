import type { TerminalSession } from '../shared/types';

export interface TerminalMarkdownState {
  inFence: boolean;
  pending: string;
  fenceLanguage?: string;
}

const FENCE_PATTERN = /^\s*```([A-Za-z0-9_-]+)?\s*$/;
const CONTROL_EXCEPT_NEWLINES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const ANSI_ESCAPE = '\x1b';
const ANSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const FENCE_STYLE = '\x1b[2;36m';
const INLINE_CODE_STYLE = '\x1b[96m';
const CODE_BLOCK_STYLE = '\x1b[48;5;236;38;5;252m';
const JS_KEYWORD_STYLE = '\x1b[38;5;81m';
const JS_STRING_STYLE = '\x1b[38;5;214m';
const JS_COMMENT_STYLE = '\x1b[38;5;244m';
const JS_NUMBER_STYLE = '\x1b[38;5;141m';
const RESET = '\x1b[0m';
const PI_INTEGRATION_ID = 'stackdock.pi';
const JS_LIKE_LANGUAGES = new Set(['js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'node']);
const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export', 'extends',
  'false', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
]);

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

function stripTerminalSequences(value: string) {
  return value.replace(ANSI_SEQUENCE, '');
}

function containsUnsupportedControl(value: string) {
  return CONTROL_EXCEPT_NEWLINES.test(stripTerminalSequences(value));
}

function styleInlineCode(value: string) {
  if (!value.includes('`')) return value;
  return value.replace(/`([^`\r\n]+)`/g, `${INLINE_CODE_STYLE}\`$1\`${RESET}`);
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_$]/.test(char);
}

function highlightJavaScriptLine(value: string) {
  let output = '';
  for (let index = 0; index < value.length;) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '/' && next === '/') {
      output += `${JS_COMMENT_STYLE}${value.slice(index)}${RESET}`;
      break;
    }

    if (char === '/' && next === '*') {
      const end = value.indexOf('*/', index + 2);
      const stop = end === -1 ? value.length : end + 2;
      output += `${JS_COMMENT_STYLE}${value.slice(index, stop)}${RESET}`;
      index = stop;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      let stop = index + 1;
      while (stop < value.length) {
        if (value[stop] === '\\') {
          stop += 2;
          continue;
        }
        if (value[stop] === char) {
          stop += 1;
          break;
        }
        stop += 1;
      }
      output += `${JS_STRING_STYLE}${value.slice(index, stop)}${RESET}`;
      index = stop;
      continue;
    }

    if (/\d/.test(char)) {
      let stop = index + 1;
      while (stop < value.length && /[\d._A-Fa-fxob]/.test(value[stop])) stop += 1;
      output += `${JS_NUMBER_STYLE}${value.slice(index, stop)}${RESET}`;
      index = stop;
      continue;
    }

    if (isIdentifierStart(char)) {
      let stop = index + 1;
      while (stop < value.length && isIdentifierPart(value[stop])) stop += 1;
      const token = value.slice(index, stop);
      output += JS_KEYWORDS.has(token) ? `${JS_KEYWORD_STYLE}${token}${RESET}` : token;
      index = stop;
      continue;
    }

    output += char;
    index += 1;
  }
  return output;
}

function styleCodeBlockBody(body: string, language: string | undefined) {
  const highlighted = language && JS_LIKE_LANGUAGES.has(language.toLowerCase()) && !containsTerminalControl(body)
    ? highlightJavaScriptLine(body)
    : body;
  return highlighted.split(RESET).join(`${RESET}${CODE_BLOCK_STYLE}`);
}

function formatLine(part: LinePart, state: TerminalMarkdownState) {
  const { body, ending } = part;
  const visibleBody = containsTerminalControl(body) ? stripTerminalSequences(body) : body;
  const fenceMatch = visibleBody.match(FENCE_PATTERN);
  if (fenceMatch) {
    if (state.inFence) {
      state.inFence = false;
      state.fenceLanguage = undefined;
      return `${FENCE_STYLE}${body}${RESET}${ending}`;
    }

    state.inFence = true;
    state.fenceLanguage = fenceMatch[1];
    return `${FENCE_STYLE}${body}${RESET}${ending}`;
  }

  if (containsUnsupportedControl(body)) return `${body}${ending}`;

  if (state.inFence) return `${CODE_BLOCK_STYLE}${styleCodeBlockBody(body, state.fenceLanguage)}${RESET}${ending}`;
  return `${styleInlineCode(body)}${ending}`;
}

export function formatTerminalMarkdownChunk(input: string, state: TerminalMarkdownState): string {
  if (!input) return '';
  const combined = state.pending + input;
  const { lines, pending } = splitCompleteLines(combined);
  state.pending = pending;
  return lines.map((line) => formatLine(line, state)).join('');
}

function isPotentialFenceFragment(value: string) {
  const visible = containsTerminalControl(value) ? stripTerminalSequences(value) : value;
  return /^\s*`{1,3}[A-Za-z0-9_-]*$/.test(visible);
}

export function flushTerminalMarkdownState(state: TerminalMarkdownState): string {
  if (!state.pending) return '';
  if (isPotentialFenceFragment(state.pending)) return '';
  const pending = state.pending;
  state.pending = '';
  return formatLine({ body: pending, ending: '' }, state);
}
