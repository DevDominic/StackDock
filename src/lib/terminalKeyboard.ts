export interface TerminalKeyboardLikeEvent {
  type?: string;
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

const CSI_U_CODEPOINTS: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 127,
  Escape: 27,
  Esc: 27,
  ' ': 32,
  Space: 32,
  Spacebar: 32,
};

function modifiedKeyCodepoint(key: string) {
  if (key.length === 1) return key.codePointAt(0) ?? null;
  return CSI_U_CODEPOINTS[key] ?? null;
}

function csiUModifierValue(event: TerminalKeyboardLikeEvent) {
  return 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
}

function shouldEncodeModifiedKey(event: TerminalKeyboardLikeEvent, codepoint: number) {
  const hasCtrl = event.ctrlKey === true;
  const hasAlt = event.altKey === true;
  const hasShift = event.shiftKey === true;

  // Modified Enter/Tab/Backspace/Escape/Space need explicit CSI-u sequences so
  // terminal TUIs such as pi can distinguish them from the unmodified key.
  if (codepoint === 13 || codepoint === 9 || codepoint === 127 || codepoint === 27 || codepoint === 32) {
    return hasCtrl || hasAlt || hasShift;
  }

  // Leave plain text, Shift+text, Ctrl+text, and Alt+text to xterm's normal
  // legacy handling. CSI-u is needed for combined modifiers that legacy
  // terminal input cannot represent reliably (e.g. Ctrl+Alt+P, Ctrl+Shift+P).
  return (hasCtrl && (hasAlt || hasShift)) || (hasAlt && hasShift);
}

export function getTerminalCsiUSequence(event: TerminalKeyboardLikeEvent) {
  if (event.type && event.type !== 'keydown') return null;
  if (event.isComposing || event.metaKey) return null;

  const codepoint = modifiedKeyCodepoint(event.key);
  if (codepoint == null || !shouldEncodeModifiedKey(event, codepoint)) return null;

  return `\x1b[${codepoint};${csiUModifierValue(event)}u`;
}
