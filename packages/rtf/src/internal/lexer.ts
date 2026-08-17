/** Position-explicit RTF lexer. `\binN` consumes exactly N raw bytes. */

export type Token =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'word'; name: string; param: number | undefined }
  | { type: 'symbol'; byte: number }
  | { type: 'hex'; byte: number }
  | { type: 'byte'; byte: number }
  | { type: 'bin'; payload: Uint8Array };

const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

function latin1(bytes: Uint8Array, start: number, end: number): string {
  const buf = bytes as Uint8Array & { latin1Slice?: (s: number, e: number) => string };
  if (typeof buf.latin1Slice === 'function') return buf.latin1Slice(start, end);
  const len = end - start;
  if (len <= 0) return '';
  const codes = new Array<number>(len);
  for (let i = 0; i < len; i += 1) codes[i] = bytes[start + i]!;
  return String.fromCharCode(...codes);
}

/** Prefix trie: first sighting allocates the string; later hits reuse it. */
const internKids: Array<number[] | undefined> = [];
const internWord: Array<string | undefined> = [];

function internName(bytes: Uint8Array, start: number, end: number): string {
  let node = 0;
  for (let i = start; i < end; i += 1) {
    const b = bytes[i]!;
    let kids = internKids[node];
    if (kids === undefined) {
      kids = internKids[node] = [];
    }
    let next = kids[b];
    if (next === undefined) {
      next = internKids.length;
      kids[b] = next;
      internKids[next] = undefined;
      internWord[next] = undefined;
    }
    node = next;
  }
  const hit = internWord[node];
  if (hit !== undefined) return hit;
  const s = latin1(bytes, start, end);
  internWord[node] = s;
  return s;
}

/**
 * Parse control-word digits as i64, then clamp to i32. Overflowing i64 is ignored.
 * ≤10 digits cannot overflow i64 and are exact in Number.
 */
function parseControlParamFast(
  bytes: Uint8Array,
  start: number,
  end: number,
  negative: boolean,
): number | undefined {
  const len = end - start;
  if (len === 0) return undefined;
  if (len <= 10) {
    let n = 0;
    for (let i = start; i < end; i += 1) n = n * 10 + (bytes[i]! - 48);
    if (negative) n = -n;
    if (n < I32_MIN) return I32_MIN;
    if (n > I32_MAX) return I32_MAX;
    return n;
  }
  const digits = latin1(bytes, start, end);
  try {
    let n = BigInt(digits);
    if (n > I64_MAX) return undefined;
    if (negative) n = -n;
    if (n < I64_MIN || n > I64_MAX) return undefined;
    if (n < BigInt(I32_MIN)) return I32_MIN;
    if (n > BigInt(I32_MAX)) return I32_MAX;
    return Number(n);
  } catch {
    return undefined;
  }
}

export class Lexer {
  readonly bytes: Uint8Array;
  pos = 0;

  // Stable per-kind objects. Callers must not retain a token across nextToken.
  private readonly openTok: Token = { type: 'open' };
  private readonly closeTok: Token = { type: 'close' };
  private readonly wordTok: Token = { type: 'word', name: '', param: undefined };
  private readonly symbolTok: Token = { type: 'symbol', byte: 0 };
  private readonly hexTok: Token = { type: 'hex', byte: 0 };
  private readonly byteTok: Token = { type: 'byte', byte: 0 };
  private readonly binTok: Token = { type: 'bin', payload: new Uint8Array(0) };

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  nextToken(): Token | undefined {
    const bytes = this.bytes;
    const len = bytes.length;
    for (;;) {
      const pos = this.pos;
      if (pos >= len) return undefined;
      const b = bytes[pos]!;
      this.pos = pos + 1;
      if (b === 123) return this.openTok;
      if (b === 125) return this.closeTok;
      if (b === 92) {
        const token = this.control();
        if (token === undefined) return undefined;
        return token;
      }
      if (b === 13 || b === 10 || b === 0) continue;
      const tok = this.byteTok as { type: 'byte'; byte: number };
      tok.byte = b;
      return tok;
    }
  }

  private control(): Token | undefined {
    const bytes = this.bytes;
    const n = bytes.length;
    const b = bytes[this.pos];
    if (b === undefined) return undefined;
    if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122))) {
      this.pos += 1;
      if (b === 13 || b === 10) {
        const tok = this.wordTok as { type: 'word'; name: string; param: number | undefined };
        tok.name = 'par';
        tok.param = undefined;
        return tok;
      }
      if (b === 39) {
        const hi = bytes[this.pos];
        const lo = bytes[this.pos + 1];
        if (hi === undefined || lo === undefined) {
          const tok = this.byteTok as { type: 'byte'; byte: number };
          tok.byte = 39;
          return tok;
        }
        const h = hexDigit(hi);
        const l = hexDigit(lo);
        if (h === undefined || l === undefined) {
          const tok = this.byteTok as { type: 'byte'; byte: number };
          tok.byte = 39;
          return tok;
        }
        this.pos += 2;
        const tok = this.hexTok as { type: 'hex'; byte: number };
        tok.byte = h * 16 + l;
        return tok;
      }
      const tok = this.symbolTok as { type: 'symbol'; byte: number };
      tok.byte = b;
      return tok;
    }
    const start = this.pos;
    let pos = this.pos;
    while (pos < n) {
      const c = bytes[pos]!;
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) pos += 1;
      else break;
    }
    this.pos = pos;
    const name = internName(bytes, start, pos);
    let param: number | undefined;
    let negative = false;
    if (bytes[this.pos] === 45) {
      negative = true;
      this.pos += 1;
    }
    const numStart = this.pos;
    while (this.pos < n && bytes[this.pos]! >= 48 && bytes[this.pos]! <= 57) {
      this.pos += 1;
    }
    if (this.pos > numStart) {
      param = parseControlParamFast(bytes, numStart, this.pos, negative);
    } else if (negative) {
      this.pos -= 1;
    }
    if (bytes[this.pos] === 32) this.pos += 1;
    if (name === 'bin') {
      const count = Math.max(param ?? 0, 0);
      const end = Math.min(this.pos + count, n);
      const payload = bytes.subarray(this.pos, end);
      this.pos = end;
      const tok = this.binTok as { type: 'bin'; payload: Uint8Array };
      tok.payload = payload;
      return tok;
    }
    const tok = this.wordTok as { type: 'word'; name: string; param: number | undefined };
    tok.name = name;
    tok.param = param;
    return tok;
  }
}

/**
 * Extract the balanced content of destination groups named `name`
 * (`{\name ...}` or `{\*\name ...}`), bin-aware. Returns the group bodies
 * after the destination word.
 */
export function destinationGroups(bytes: Uint8Array, name: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const lexer = new Lexer(bytes);
  let depth = 0;
  let expectingWordAt: number | undefined;
  let capture: { depth: number; start: number } | undefined;
  for (;;) {
    const before = lexer.pos;
    const token = lexer.nextToken();
    if (token === undefined) break;
    switch (token.type) {
      case 'open':
        depth += 1;
        expectingWordAt = depth;
        break;
      case 'close':
        if (capture !== undefined && depth === capture.depth) {
          out.push(bytes.subarray(capture.start, before));
          capture = undefined;
        }
        depth = depth > 0 ? depth - 1 : 0;
        expectingWordAt = undefined;
        break;
      case 'symbol':
        if (token.byte === 42 && expectingWordAt === depth) break;
        expectingWordAt = undefined;
        break;
      case 'word':
        if (expectingWordAt === depth && token.name === name && capture === undefined) {
          capture = { depth, start: lexer.pos };
        }
        expectingWordAt = undefined;
        break;
      default:
        expectingWordAt = undefined;
        break;
    }
  }
  return out;
}

/**
 * One-lex extract of several destination names. Per-name capture slots
 * match four independent `destinationGroups` scans (nested same-name
 * groups stay uncaptured; different names may nest).
 */
export function destinationGroupsMulti(
  bytes: Uint8Array,
  names: readonly string[],
): { groups: Uint8Array[][]; ansicpg: number | undefined } {
  const out: Uint8Array[][] = [];
  const captures: Array<{ depth: number; start: number } | undefined> = [];
  for (let i = 0; i < names.length; i += 1) {
    out.push([]);
    captures.push(undefined);
  }
  const lexer = new Lexer(bytes);
  let depth = 0;
  let expectingWordAt: number | undefined;
  let ansicpg: number | undefined;
  for (;;) {
    const before = lexer.pos;
    const token = lexer.nextToken();
    if (token === undefined) break;
    switch (token.type) {
      case 'open':
        depth += 1;
        expectingWordAt = depth;
        break;
      case 'close':
        for (let i = 0; i < captures.length; i += 1) {
          const capture = captures[i];
          if (capture !== undefined && depth === capture.depth) {
            out[i]!.push(bytes.subarray(capture.start, before));
            captures[i] = undefined;
          }
        }
        depth = depth > 0 ? depth - 1 : 0;
        expectingWordAt = undefined;
        break;
      case 'symbol':
        if (token.byte === 42 && expectingWordAt === depth) break;
        expectingWordAt = undefined;
        break;
      case 'word':
        if (ansicpg === undefined && token.name === 'ansicpg' && token.param !== undefined) {
          ansicpg = token.param;
        }
        if (expectingWordAt === depth) {
          const name = token.name;
          for (let i = 0; i < names.length; i += 1) {
            if (names[i] === name && captures[i] === undefined) {
              captures[i] = { depth, start: lexer.pos };
              break;
            }
          }
        }
        expectingWordAt = undefined;
        break;
      default:
        expectingWordAt = undefined;
        break;
    }
  }
  return { groups: out, ansicpg };
}

function hexDigit(b: number): number | undefined {
  if (b >= 48 && b <= 57) return b - 48;
  if (b >= 97 && b <= 102) return b - 97 + 10;
  if (b >= 65 && b <= 70) return b - 65 + 10;
  return undefined;
}
