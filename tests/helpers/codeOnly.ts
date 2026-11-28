/**
 * Shared by the source-scanning wiring tests (`http-bounds-wiring`, `http-deadline-wiring`).
 */

/**
 * The span with comments removed and string contents blanked, so a key that is commented out, or
 * that appears only inside a string, never counts as set (diff review codex-C1). Quotes are kept, so
 * a `//` inside a URL string is not mistaken for a comment.
 */
export function codeOnly(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch;
      i++;
      while (i < text.length && text[i] !== ch) {
        i += text[i] === '\\' ? 2 : 1;
      }
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
