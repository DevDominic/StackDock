import { describe, expect, it } from 'vitest';
import type { TerminalAttachment } from '../src/shared/types';
import { removeSerializedAttachmentToken, serializeTerminalAttachments } from '../src/lib/terminalAttachments';

function makeAttachment(referencePath: string): TerminalAttachment {
  return {
    id: 'att_1',
    source: 'drop',
    path: referencePath,
    referencePath,
    name: referencePath.split('/').pop() ?? referencePath,
    isDirectory: false,
    isImage: false,
    isLarge: false,
  };
}

describe('removeSerializedAttachmentToken', () => {
  it('removes a staged token and its trailing space', () => {
    const token = serializeTerminalAttachments([makeAttachment('/tmp/report.txt')]);
    const text = `cat ${token}| head`;

    expect(removeSerializedAttachmentToken(text, token)).toBe('cat | head');
  });

  it('falls back to the trimmed token when the trailing space was edited away', () => {
    const token = serializeTerminalAttachments([makeAttachment('/tmp/report.txt')]);
    const text = `cat ${token.trim()}`;

    expect(removeSerializedAttachmentToken(text, token)).toBe('cat ');
  });

  it('collapses the doubled space left at the cut point', () => {
    const token = serializeTerminalAttachments([makeAttachment('/tmp/report.txt')]);
    const text = `cat ${token} && ls`;

    expect(removeSerializedAttachmentToken(text, token)).toBe('cat && ls');
  });

  it('preserves intentional multi-space runs elsewhere in the command', () => {
    const token = serializeTerminalAttachments([makeAttachment('/tmp/data.csv')]);
    const text = `awk '{ print $1  "  "  $2 }' ${token}`;

    expect(removeSerializedAttachmentToken(text, token)).toBe(`awk '{ print $1  "  "  $2 }' `);
  });

  it('removes quoted tokens for paths with spaces', () => {
    const token = serializeTerminalAttachments([makeAttachment('/tmp/my report.txt')]);
    const text = `open ${token}now`;

    expect(removeSerializedAttachmentToken(text, token)).toBe('open now');
  });

  it('leaves text unchanged when the token is no longer present', () => {
    const token = serializeTerminalAttachments([makeAttachment('/tmp/report.txt')]);

    expect(removeSerializedAttachmentToken('ls -la', token)).toBe('ls -la');
  });
});
