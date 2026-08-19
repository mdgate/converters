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

function lastCodePointStart(s: string, end: number): number {
  if (end <= 1) return 0;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xdc00 && c <= 0xdfff) {
    const prev = s.charCodeAt(end - 2);
    if (prev >= 0xd800 && prev <= 0xdbff) return end - 2;
  }
  return end - 1;
}

export function trimEnd(s: string): string {
  let end = s.length;
  while (end > 0) {
    const start = lastCodePointStart(s, end);
    if (!isWhitespace(s.slice(start, end))) break;
    end = start;
  }
  return end === s.length ? s : s.slice(0, end);
}

/** Strip `ch` from both ends. */
export function trimMatches(s: string, ch: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.startsWith(ch, start)) start += ch.length;
  while (end > start && s.endsWith(ch, end)) end -= ch.length;
  if (start === 0 && end === s.length) return s;
  return s.slice(start, end);
}

/** Strip `ch` from the end. */
export function trimEndMatches(s: string, ch: string): string {
  let end = s.length;
  while (end >= ch.length && s.endsWith(ch, end)) end -= ch.length;
  return end === s.length ? s : s.slice(0, end);
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
