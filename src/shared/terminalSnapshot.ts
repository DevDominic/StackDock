const CSI_FINAL_BYTE = /[\x40-\x7e]/;
const CONTROL_EXCEPT_TEXT = /[\x00-\x07\x0e-\x1a\x1c-\x1f\x7f-\x9f]/g;
// Queries the old shell sent that xterm would *answer* on replay (DA, DSR/CPR,
// DECRQM, XTVERSION, OSC color queries). The answers would be piped to the new
// pty as keyboard input, so the queries must never reach the parser.
const TERMINAL_QUERY_SEQUENCES = /\x1b\[(?:0|>0?|=0?)?c|\x1b\[\??[56]n|\x1b\[\??\d+(?:;\d+)*\$p|\x1b\[>0?q|\x1b\](?:1[0-2]|4;\d+);\?(?:\x07|\x1b\\)/g;
// A DA response that already leaked into scrollback as echoed input on a prior
// run renders as literal "[?1;2c" text (ESC swallowed by the shell).
const ECHOED_DA_RESPONSE = /(?<!\x1b)\[\?[0-9;]+c/g;
const LEADING_DA_RESPONSE = /^\x1b\[\?[0-9;]*c/i;
const LEADING_CSI_TAIL = /^(?:\[?\?[0-9;]*|[?;0-9]+)c/i;
const LEADING_ORPHAN_CSI_TAIL = /^[\[\]?;0-9]{1,32}[\x40-\x7e]/;

function trimUtf8Start(bytes: Uint8Array) {
  let start = 0;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start);
}

function stripLeadingBoundaryFragment(value: string) {
  let text = value.replace(CONTROL_EXCEPT_TEXT, '');

  while (text) {
    const before = text;
    text = text.replace(LEADING_DA_RESPONSE, '');
    text = text.replace(LEADING_CSI_TAIL, '');

    if (text.startsWith('\x1b[')) {
      const finalIndex = text.slice(2).search(CSI_FINAL_BYTE);
      if (finalIndex === -1) return '';
      const sequence = text.slice(0, finalIndex + 3);
      if (/^\x1b\[\?[0-9;]*c$/i.test(sequence)) text = text.slice(sequence.length);
    } else if (text.startsWith('\x1b]')) {
      const bel = text.indexOf('\x07', 2);
      const st = text.indexOf('\x1b\\', 2);
      const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
      if (end === -1) return '';
      break;
    } else if (LEADING_ORPHAN_CSI_TAIL.test(text)) {
      text = text.replace(LEADING_ORPHAN_CSI_TAIL, '');
    }

    if (text === before) break;
  }

  return text.replace(/^\x1b$/, '');
}

export function sanitizeSnapshotReplay(raw: string) {
  if (!raw) return '';
  return stripLeadingBoundaryFragment(raw.replace(TERMINAL_QUERY_SEQUENCES, '').replace(ECHOED_DA_RESPONSE, ''));
}

export function trimSnapshotOutput(raw: string, maxBytes: number) {
  if (!raw || maxBytes <= 0) return '';
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length <= maxBytes) return sanitizeSnapshotReplay(raw);
  const window = trimUtf8Start(bytes.subarray(bytes.length - maxBytes));
  return sanitizeSnapshotReplay(new TextDecoder('utf-8', { fatal: false }).decode(window));
}

export function buildRestoredScrollbackBarrier(rows: number, resumeCommand?: string) {
  const safeRows = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
  const resumeNotice = resumeCommand?.trim() ? `\x1b[2m[resuming session with: ${resumeCommand.trim()}]\x1b[0m\r\n` : '';
  return `\x1b[0m\r\n\x1b[2m──── restored scrollback; live output follows ────\x1b[0m\r\n${resumeNotice}${'\r\n'.repeat(safeRows)}\x1b[H\x1b[J`;
}
