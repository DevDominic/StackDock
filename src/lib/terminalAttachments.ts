import type { TerminalAttachment } from '../shared/types';

export type TerminalAttachmentFormatter = 'auto' | 'generic' | 'pi' | 'claude' | 'codex';

export interface TerminalAttachmentSerializeOptions {
  formatter?: TerminalAttachmentFormatter;
  /** Text inserted before the first attachment token. */
  leadingText?: string;
  /** Text inserted after the final attachment token. Never use Enter here for reviewable terminal input. */
  trailingText?: string;
}

function quoteReferencePath(referencePath: string) {
  // Insert plain file references. Tools like Pi and Claude already handle file
  // drops/pastes; adding @ turns paths into mentions in those prompts.
  if (!/[\s"'`$&(){}\[\];<>|]/.test(referencePath)) return referencePath;
  return `"${referencePath.replace(/(["\\$`])/g, '\\$1')}"`;
}

export function terminalAttachmentToken(attachment: TerminalAttachment, _formatter: TerminalAttachmentFormatter = 'auto') {
  return quoteReferencePath(attachment.referencePath);
}

export function serializeTerminalAttachments(attachments: TerminalAttachment[], options: TerminalAttachmentSerializeOptions = {}) {
  const tokens = attachments.map((attachment) => terminalAttachmentToken(attachment, options.formatter ?? 'auto'));
  if (!tokens.length) return '';
  return `${options.leadingText ?? ''}${tokens.join(' ')}${options.trailingText ?? ' '}`;
}

export function removeSerializedAttachmentToken(text: string, token: string) {
  for (const marker of [token, token.trim()]) {
    const index = marker ? text.indexOf(marker) : -1;
    if (index < 0) continue;
    const next = `${text.slice(0, index)}${text.slice(index + marker.length)}`;
    // Collapse only the doubled space left at the cut point, never elsewhere.
    return index > 0 && next[index - 1] === ' ' && next[index] === ' ' ? `${next.slice(0, index)}${next.slice(index + 1)}` : next;
  }
  return text;
}

export function summarizeTerminalAttachments(attachments: TerminalAttachment[]) {
  if (!attachments.length) return '';
  const large = attachments.filter((attachment) => attachment.isLarge).length;
  const images = attachments.filter((attachment) => attachment.isImage).length;
  const directories = attachments.filter((attachment) => attachment.isDirectory || attachment.isLarge).length;
  const parts = [`${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`];
  if (images) parts.push(`${images} image${images === 1 ? '' : 's'}`);
  if (large) parts.push(`${large} large file${large === 1 ? '' : 's'}`);
  else if (directories) parts.push(`${directories} folder${directories === 1 ? '' : 's'}`);
  return parts.join(' • ');
}
