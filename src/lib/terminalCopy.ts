function isHorizontalWhitespace(char: string) {
  return char === ' ' || char === '\t' || char === '\f' || char === '\v';
}

function trimHorizontalRight(value: string) {
  return value.replace(/[ \t\f\v]+$/g, '');
}

/**
 * xterm already removes true terminal soft-wraps, but some terminal TUIs render
 * long shell commands by inserting hard newlines (often with right-padding) in
 * the output itself. When copying those commands, unwrap single line breaks
 * that occur inside shell quotes so pasted one-liners remain executable.
 */
export function normalizeTerminalClipboardText(value: string) {
  if (!value.includes('\n') && !value.includes('\r')) return value;

  const eol = value.includes('\r\n') ? '\r\n' : '\n';
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let quote: '"' | '\'' | '`' | null = null;
  let escaped = false;
  let output = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === '\n') {
      if (quote) {
        let next = index + 1;
        let newlineCount = 1;
        while (normalized[next] === '\n') {
          newlineCount += 1;
          next += 1;
        }

        if (newlineCount === 1) {
          while (isHorizontalWhitespace(normalized[next])) next += 1;
          output = trimHorizontalRight(output);
          if (output && next < normalized.length && !isHorizontalWhitespace(output[output.length - 1])) output += ' ';
          index = next - 1;
          escaped = false;
          continue;
        }

        output += '\n'.repeat(newlineCount);
        index += newlineCount - 1;
        escaped = false;
        continue;
      }

      output += '\n';
      escaped = false;
      continue;
    }

    output += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== '\'') {
      escaped = true;
      continue;
    }

    if (!quote && (char === '"' || char === '\'' || char === '`')) quote = char;
    else if (quote === char) quote = null;
  }

  return eol === '\r\n' ? output.replace(/\n/g, '\r\n') : output;
}
