export interface KeybindLikeEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;
const MODIFIER_ALIASES: Record<string, string> = {
  cmd: 'Mod', command: 'Mod', meta: 'Mod', win: 'Mod', super: 'Mod', mod: 'Mod',
  control: 'Ctrl', ctrl: 'Ctrl', option: 'Alt', alt: 'Alt', shift: 'Shift',
};
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape', escape: 'Escape', return: 'Enter', enter: 'Enter', space: 'Space', spacebar: 'Space',
  comma: ',', period: '.', dot: '.', backquote: '`', backtick: '`', plus: '+', minus: '-', tab: 'Tab',
  del: 'Delete', delete: 'Delete', backspace: 'Backspace', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
};
const BARE_MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

function normalizeKeyToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const alias = KEY_ALIASES[lower];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  if (/^arrow(up|down|left|right)$/i.test(trimmed)) return `Arrow${trimmed.slice(5, 6).toUpperCase()}${trimmed.slice(6).toLowerCase()}`;
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1);
}

export function normalizeKeybind(input: string | undefined | null): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const parts = raw.replace(/\s*\+\s*/g, '+').split('+').filter(Boolean);
  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) modifiers.add(modifier);
    else key = normalizeKeyToken(part);
  }
  if (!key || Object.values(MODIFIER_ALIASES).includes(key)) return null;
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].join('+');
}

export function eventToKeybind(event: KeybindLikeEvent): string | null {
  if (!event.key || BARE_MODIFIERS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push('Mod');
  else if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(normalizeKeyToken(event.key));
  return normalizeKeybind(parts.join('+'));
}

function defaultPlatform() { return typeof navigator === 'undefined' ? '' : navigator.platform; }

export function keybindMatchesEvent(binding: string | undefined, event: KeybindLikeEvent, platform = defaultPlatform()): boolean {
  const normalized = normalizeKeybind(binding);
  const eventBinding = eventToKeybind(event);
  if (!normalized || !eventBinding) return false;
  const platformString = String(platform).toLowerCase();
  const isMac = platformString.includes('mac') || platformString === 'darwin';
  const expanded = normalized.replace(/^Mod(?=\+)/, isMac ? 'Mod' : 'Ctrl');
  return expanded === eventBinding;
}

export function formatKeybind(binding: string | undefined, platform = defaultPlatform()): string {
  const normalized = normalizeKeybind(binding);
  if (!normalized) return '';
  const isMac = String(platform).toLowerCase().includes('mac') || String(platform).toLowerCase() === 'darwin';
  if (isMac) return normalized.split('+').map((part) => ({ Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↩', Escape: 'Esc', Space: 'Space' } as Record<string, string>)[part] ?? part).join('');
  return normalized.replace(/^Mod(?=\+)/, 'Ctrl');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
}

export function findKeybindConflicts(entries: { id: string; label: string; keybind?: string }[]) {
  const groups = new Map<string, { id: string; label: string; keybind?: string }[]>();
  for (const entry of entries) {
    const key = normalizeKeybind(entry.keybind);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), { ...entry, keybind: key }]);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([keybind, items]) => ({ keybind, items }));
}
