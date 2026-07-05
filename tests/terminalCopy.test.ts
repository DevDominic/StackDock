import { describe, expect, it } from 'vitest';
import { normalizeTerminalClipboardText } from '../src/lib/terminalCopy';

describe('terminal clipboard normalization', () => {
  it('unwraps hard-wrapped lines inside a quoted shell argument', () => {
    const copied = 'pi --mode json -p --model openai-codex/gpt-5.5 --thinking medium "Review the current repository changes. Use      \n short, clear commit subjects. Ensure that    \n you analyze all diffs"';

    expect(normalizeTerminalClipboardText(copied)).toBe('pi --mode json -p --model openai-codex/gpt-5.5 --thinking medium "Review the current repository changes. Use short, clear commit subjects. Ensure that you analyze all diffs"');
  });

  it('keeps normal multiline terminal output unchanged', () => {
    const copied = 'first line\nsecond line\nthird line';

    expect(normalizeTerminalClipboardText(copied)).toBe(copied);
  });

  it('preserves paragraph breaks inside quoted text', () => {
    const copied = 'pi -p "first paragraph\n\nsecond paragraph"';

    expect(normalizeTerminalClipboardText(copied)).toBe(copied);
  });

  it('handles escaped quotes while unwrapping double quoted text', () => {
    const copied = 'pi -p "say \\"hello\\" then\n continue"';

    expect(normalizeTerminalClipboardText(copied)).toBe('pi -p "say \\"hello\\" then continue"');
  });
});
