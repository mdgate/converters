/** Unicode White_Space (not JS whitespace). */
export function isWhitespace(c: string): boolean {
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

/** General category Cc. */
export function isControl(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/** General categories L* and N*. */
export function isAlphanumeric(c: string): boolean {
  return /^\p{L}$/u.test(c) || /^\p{N}$/u.test(c);
}

export function isAsciiAlphabetic(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

export function isAsciiDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

export function toAsciiLower(c: string): string {
  if (c >= 'A' && c <= 'Z') return String.fromCharCode(c.charCodeAt(0) + 32);
  return c;
}

/** Trim Unicode White_Space only (not JS BOM). */
export function trim(s: string): string {
  return trimEnd(trimStart(s));
}

export function trimStart(s: string): string {
  let i = 0;
  for (const c of s) {
    if (!isWhitespace(c)) break;
    i += c.length;
  }
  return s.slice(i);
}

export function trimEnd(s: string): string {
  const chars = [...s];
  let end = chars.length;
  while (end > 0 && isWhitespace(chars[end - 1]!)) end -= 1;
  return chars.slice(0, end).join('');
}

/** Strip `ch` from both ends. */
export function trimMatches(s: string, ch: string): string {
  const chars = [...s];
  let start = 0;
  let end = chars.length;
  while (start < end && chars[start] === ch) start += 1;
  while (end > start && chars[end - 1] === ch) end -= 1;
  return chars.slice(start, end).join('');
}

/** Strip `ch` from the end. */
export function trimEndMatches(s: string, ch: string): string {
  const chars = [...s];
  let end = chars.length;
  while (end > 0 && chars[end - 1] === ch) end -= 1;
  return chars.slice(0, end).join('');
}

/**
 * Split on `\n` / `\r\n`. No trailing empty line when the string ends with
 * a newline.
 */
export function lines(s: string): string[] {
  if (s.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) === 10) {
      let end = i;
      if (end > start && s.charCodeAt(end - 1) === 13) end -= 1;
      out.push(s.slice(start, end));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

export function chars(s: string): string[] {
  return [...s];
}
