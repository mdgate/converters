import { isControl } from './unicode.js';

/**
 * Drop control characters and layout-only invisibles, convert NBSP to a
 * regular space, strip soft hyphens. Line breaks become single spaces; a
 * CRLF pair is one break. U+200C (ZWNJ) and U+200D (ZWJ) are preserved.
 */
export function cleanText(text: string): string {
  if (!needsClean(text)) return text;
  let out = '';
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const c = String.fromCodePoint(cp);
    i += c.length;
    if (c === '\u00a0') {
      out += ' ';
    } else if (c === '\u00ad' || c === '\u200b' || c === '\ufeff') {
      // strip
    } else if (c === '\t') {
      out += '\t';
    } else if (c === '\r') {
      if (text.charCodeAt(i) === 10) i += 1;
      out += ' ';
    } else if (c === '\n') {
      out += ' ';
    } else if (isControl(c)) {
      // drop
    } else {
      out += c;
    }
  }
  return out;
}

function needsClean(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09) return true;
    if (c === 0x7f || (c >= 0x80 && c <= 0x9f)) return true;
    if (c === 0xa0 || c === 0xad || c === 0x200b || c === 0xfeff) return true;
  }
  return false;
}

/** XML 1.0 S production. */
export function isXmlSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

/** Collapse whitespace runs to single spaces. */
export function collapseWs(text: string): string {
  let out = '';
  let prevSpace = false;
  for (const c of text) {
    if (isUnicodeWhitespace(c)) {
      if (!prevSpace) out += ' ';
      prevSpace = true;
    } else {
      out += c;
      prevSpace = false;
    }
  }
  return out;
}

function isUnicodeWhitespace(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  return (
    (cp >= 0x09 && cp <= 0x0d) ||
    cp === 0x20 ||
    cp === 0x85 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  );
}
