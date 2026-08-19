import { asciiStartsWith, decode, trim } from '@mdgate/utils';

export interface MimeHeader {
  name: string;
  value: string;
}

export interface MimePart {
  contentType: string;
  headers: MimeHeader[];
  filename: string | undefined;
  bytes: Uint8Array;
  parts: MimePart[];
}

/**
 * Parse an RFC 822 / MIME document (`.eml`, `.mhtml`) or an mbox of such
 * documents into a part tree. Transfer encodings are decoded; charset is not.
 */
export function parseMime(bytes: Uint8Array): MimePart {
  if (isMbox(bytes)) {
    const messages = splitMbox(bytes);
    if (messages.length > 1 || (messages.length === 1 && asciiStartsWith(bytes, 'From '))) {
      return {
        contentType: 'application/mbox',
        headers: [],
        filename: undefined,
        bytes: new Uint8Array(0),
        parts: messages.map((msg) => parseMessage(msg)),
      };
    }
  }
  return parseMessage(stripBom(bytes));
}

/** Preorder walk including `root`. */
export function walkMimeParts(root: MimePart): MimePart[] {
  const out: MimePart[] = [];
  const visit = (part: MimePart): void => {
    out.push(part);
    for (const child of part.parts) visit(child);
  };
  visit(root);
  return out;
}

/** First `text/html` leaf that is not an attachment (honors `start=`). */
export function mimeTextHtml(root: MimePart): MimePart | undefined {
  const start = relatedStartCid(root);
  if (start !== undefined) {
    const byCid = findByContentId(root, start);
    if (byCid !== undefined && isHtmlLeaf(byCid) && !isAttachment(byCid)) return byCid;
  }
  return firstLeaf(root, (p) => isHtmlLeaf(p) && !isAttachment(p));
}

/** First `text/plain` leaf that is not an attachment. */
export function mimeTextPlain(root: MimePart): MimePart | undefined {
  return firstLeaf(
    root,
    (p) => p.contentType === 'text/plain' && p.parts.length === 0 && !isAttachment(p),
  );
}

/**
 * Leaf parts that are not the chosen text bodies. Includes `attachment`
 * disposition, related resources, and unnamed non-text leaves.
 */
export function mimeAttachments(root: MimePart): MimePart[] {
  const html = mimeTextHtml(root);
  const plain = mimeTextPlain(root);
  const out: MimePart[] = [];
  const visit = (part: MimePart): void => {
    if (part.parts.length > 0) {
      for (const child of part.parts) visit(child);
      return;
    }
    if (part === html || part === plain) return;
    if (isMultipartType(part.contentType) || isRfc822Type(part.contentType)) return;
    out.push(part);
  };
  visit(root);
  return out;
}

/** Last header of `name` (case-insensitive). */
export function mimeHeader(part: MimePart, name: string): string | undefined {
  const key = name.toLowerCase();
  for (let i = part.headers.length - 1; i >= 0; i -= 1) {
    if (part.headers[i]!.name === key) return part.headers[i]!.value;
  }
  return undefined;
}

function parseMessage(bytes: Uint8Array): MimePart {
  const split = splitHeaders(bytes);
  const headers = parseHeaders(split.headers);
  const ctRaw = headerValue(headers, 'content-type') ?? 'text/plain';
  const parsed = parseContentType(ctRaw);
  const filename = filenameOf(headers, parsed.params);
  const cte = (headerValue(headers, 'content-transfer-encoding') ?? '7bit').trim().toLowerCase();
  const decoded = decodeTransfer(split.body, cte);

  if (isMultipartType(parsed.type)) {
    const boundary = parsed.params.get('boundary');
    if (boundary === undefined || boundary.length === 0) {
      return { contentType: parsed.type, headers, filename, bytes: decoded, parts: [] };
    }
    const chunks = splitMultipart(decoded, boundary);
    const parts = chunks.map((chunk) => parseMessage(chunk));
    return { contentType: parsed.type, headers, filename, bytes: new Uint8Array(0), parts };
  }

  if (isRfc822Type(parsed.type)) {
    const child = parseMessage(decoded);
    return { contentType: parsed.type, headers, filename, bytes: decoded, parts: [child] };
  }

  return { contentType: parsed.type, headers, filename, bytes: decoded, parts: [] };
}

function isMultipartType(type: string): boolean {
  return type.startsWith('multipart/');
}

function isRfc822Type(type: string): boolean {
  return type === 'message/rfc822' || type === 'message/global' || type === 'message/news';
}

function isHtmlLeaf(part: MimePart): boolean {
  return part.contentType === 'text/html' && part.parts.length === 0;
}

function isAttachment(part: MimePart): boolean {
  const disp = mimeHeader(part, 'content-disposition');
  if (disp === undefined) return false;
  const semi = disp.indexOf(';');
  const kind = (semi < 0 ? disp : disp.slice(0, semi)).trim().toLowerCase();
  return kind === 'attachment';
}

function firstLeaf(root: MimePart, pred: (part: MimePart) => boolean): MimePart | undefined {
  if (pred(root)) return root;
  for (const child of root.parts) {
    const found = firstLeaf(child, pred);
    if (found !== undefined) return found;
  }
  return undefined;
}

function relatedStartCid(root: MimePart): string | undefined {
  const raw = mimeHeader(root, 'content-type');
  if (root.contentType === 'multipart/related' && raw !== undefined) {
    const start = parseContentType(raw).params.get('start');
    if (start !== undefined && start.length > 0) return unwrapCid(start);
  }
  for (const child of root.parts) {
    const found = relatedStartCid(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findByContentId(root: MimePart, cid: string): MimePart | undefined {
  const raw = mimeHeader(root, 'content-id');
  if (raw !== undefined && unwrapCid(raw) === cid) return root;
  for (const child of root.parts) {
    const found = findByContentId(child, cid);
    if (found !== undefined) return found;
  }
  return undefined;
}

function unwrapCid(value: string): string {
  let s = trim(value);
  if (s.startsWith('<') && s.endsWith('>') && s.length >= 2) s = s.slice(1, -1);
  return s;
}

function headerValue(headers: MimeHeader[], name: string): string | undefined {
  const key = name.toLowerCase();
  for (let i = headers.length - 1; i >= 0; i -= 1) {
    if (headers[i]!.name === key) return headers[i]!.value;
  }
  return undefined;
}

function stripBom(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3);
  }
  return bytes;
}

function isMbox(bytes: Uint8Array): boolean {
  return asciiStartsWith(bytes, 'From ');
}

function splitMbox(bytes: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (isFromSeparator(bytes, i)) starts.push(i);
    i = nextLine(bytes, i);
  }
  if (starts.length === 0) return [];
  const out: Uint8Array[] = [];
  for (let n = 0; n < starts.length; n += 1) {
    const fromLine = starts[n]!;
    const msgStart = nextLine(bytes, fromLine);
    const msgEnd = n + 1 < starts.length ? starts[n + 1]! : bytes.length;
    if (msgStart > msgEnd) continue;
    out.push(unescapeMbox(bytes.subarray(msgStart, msgEnd)));
  }
  return out;
}

function isFromSeparator(bytes: Uint8Array, i: number): boolean {
  return (
    i + 5 <= bytes.length &&
    bytes[i] === 0x46 &&
    bytes[i + 1] === 0x72 &&
    bytes[i + 2] === 0x6f &&
    bytes[i + 3] === 0x6d &&
    bytes[i + 4] === 0x20
  );
}

function unescapeMbox(bytes: Uint8Array): Uint8Array {
  let extra = 0;
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0x3e && isFromSeparator(bytes, i + 1)) extra += 1;
    i = nextLine(bytes, i);
  }
  if (extra === 0) return bytes;
  const out = new Uint8Array(bytes.length - extra);
  let r = 0;
  let w = 0;
  while (r < bytes.length) {
    if (bytes[r] === 0x3e && isFromSeparator(bytes, r + 1)) r += 1;
    const end = nextLine(bytes, r);
    out.set(bytes.subarray(r, end), w);
    w += end - r;
    r = end;
  }
  return out.subarray(0, w);
}

function nextLine(bytes: Uint8Array, i: number): number {
  while (i < bytes.length) {
    const b = bytes[i]!;
    i += 1;
    if (b === 0x0a) return i;
    if (b === 0x0d) {
      if (i < bytes.length && bytes[i] === 0x0a) i += 1;
      return i;
    }
  }
  return i;
}

function splitHeaders(bytes: Uint8Array): { headers: Uint8Array; body: Uint8Array } {
  const blank = findBlankLine(bytes);
  if (blank !== undefined) {
    return { headers: bytes.subarray(0, blank.sep), body: bytes.subarray(blank.body) };
  }
  if (looksLikeHeaders(bytes)) {
    return { headers: bytes, body: bytes.subarray(bytes.length) };
  }
  return { headers: bytes.subarray(0, 0), body: bytes };
}

function findBlankLine(bytes: Uint8Array): { sep: number; body: number } | undefined {
  const limit = bytes.length;
  for (let i = 0; i < limit; i += 1) {
    const b = bytes[i]!;
    if (b === 0x0a && i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
      return { sep: i + 1, body: i + 2 };
    }
    if (b === 0x0d && i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
      if (i + 3 < bytes.length && bytes[i + 2] === 0x0d && bytes[i + 3] === 0x0a) {
        return { sep: i + 2, body: i + 4 };
      }
      if (i + 2 < bytes.length && bytes[i + 2] === 0x0a) {
        return { sep: i + 2, body: i + 3 };
      }
    }
    if (b === 0x0d && i + 1 < bytes.length && bytes[i + 1] === 0x0d) {
      return { sep: i + 1, body: i + 2 };
    }
  }
  return undefined;
}

function looksLikeHeaders(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09)) i += 1;
  if (i >= bytes.length) return false;
  const start = i;
  while (i < bytes.length && bytes[i] !== 0x0d && bytes[i] !== 0x0a && bytes[i] !== 0x3a) i += 1;
  if (i >= bytes.length || bytes[i] !== 0x3a || i === start) return false;
  for (let j = start; j < i; j += 1) {
    const c = bytes[j]!;
    const ok =
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x30 && c <= 0x39) ||
      c === 0x2d;
    if (!ok) return false;
  }
  return true;
}

function parseHeaders(bytes: Uint8Array): MimeHeader[] {
  if (bytes.length === 0) return [];
  const text = unfoldHeaders(latin1(bytes));
  const headers: MimeHeader[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    start = end + 1;
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (name.length === 0) continue;
    const value = decodeRfc2047(trim(line.slice(colon + 1)));
    headers.push({ name, value });
  }
  return headers;
}

function unfoldHeaders(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '\r' && text[i + 1] === '\n' && isWspChar(text[i + 2])) {
      out += ' ';
      i += 2;
      continue;
    }
    if ((c === '\n' || c === '\r') && isWspChar(text[i + 1])) {
      out += ' ';
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

function isWspChar(c: string | undefined): boolean {
  return c === ' ' || c === '\t';
}

function parseContentType(raw: string): { type: string; params: Map<string, string> } {
  const semi = indexUnquoted(raw, ';');
  const typeRaw = trim(semi < 0 ? raw : raw.slice(0, semi)).toLowerCase();
  const type = typeRaw.length > 0 ? typeRaw : 'application/octet-stream';
  const params = parseParams(semi < 0 ? '' : raw.slice(semi + 1));
  return { type, params };
}

function parseParams(input: string): Map<string, string> {
  const params = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    while (i < input.length && (input[i] === ';' || input[i] === ' ' || input[i] === '\t')) i += 1;
    if (i >= input.length) break;
    const rest = input.slice(i);
    const semi = indexUnquoted(rest, ';');
    const chunk = trim(semi < 0 ? rest : rest.slice(0, semi));
    i += semi < 0 ? rest.length : semi + 1;
    const eq = indexUnquoted(chunk, '=');
    if (eq <= 0) continue;
    const key = trim(chunk.slice(0, eq)).toLowerCase();
    if (key.length === 0) continue;
    params.set(key, unquoteParam(trim(chunk.slice(eq + 1))));
  }
  return params;
}

function indexUnquoted(s: string, ch: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (quoted) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ch) return i;
  }
  return -1;
}

function unquoteParam(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    let out = '';
    for (let i = 1; i < value.length - 1; i += 1) {
      if (value[i] === '\\' && i + 1 < value.length - 1) {
        i += 1;
        out += value[i];
        continue;
      }
      out += value[i];
    }
    return out;
  }
  return value;
}

function filenameOf(headers: MimeHeader[], typeParams: Map<string, string>): string | undefined {
  const disp = headerValue(headers, 'content-disposition');
  if (disp !== undefined) {
    const name = filenameFromParams(parseParams(disp));
    if (name !== undefined) return name;
  }
  return filenameFromParams(typeParams);
}

function filenameFromParams(params: Map<string, string>): string | undefined {
  const fromStar = continuedParam(params, 'filename') ?? params.get('filename*');
  if (fromStar !== undefined) {
    const decoded = decodeRfc2231(fromStar);
    if (decoded.length > 0) return decoded;
  }
  const plain = params.get('filename');
  if (plain !== undefined && plain.length > 0) return plain;
  const nameStar = continuedParam(params, 'name') ?? params.get('name*');
  if (nameStar !== undefined) {
    const decoded = decodeRfc2231(nameStar);
    if (decoded.length > 0) return decoded;
  }
  const name = params.get('name');
  return name !== undefined && name.length > 0 ? name : undefined;
}

function continuedParam(params: Map<string, string>, base: string): string | undefined {
  if (!params.has(`${base}*0`) && !params.has(`${base}*0*`)) return undefined;
  let acc = '';
  for (let i = 0; i < 64; i += 1) {
    const star = params.get(`${base}*${i}*`);
    if (star !== undefined) {
      acc += star;
      continue;
    }
    const plain = params.get(`${base}*${i}`);
    if (plain === undefined) break;
    acc += plain;
  }
  return acc.length > 0 ? acc : undefined;
}

function decodeRfc2231(value: string): string {
  const q1 = value.indexOf("'");
  if (q1 < 0) return percentDecodeToString(value, 'utf-8');
  const q2 = value.indexOf("'", q1 + 1);
  if (q2 < 0) return percentDecodeToString(value, 'utf-8');
  const charset = value.slice(0, q1) || 'utf-8';
  return percentDecodeToString(value.slice(q2 + 1), charset);
}

function percentDecodeToString(input: string, charset: string): string {
  const bytes = new Uint8Array(input.length);
  let w = 0;
  for (let i = 0; i < input.length; i += 1) {
    if (
      input[i] === '%' &&
      i + 2 < input.length &&
      isHexChar(input[i + 1]!) &&
      isHexChar(input[i + 2]!)
    ) {
      bytes[w] = (hexVal(input[i + 1]!) << 4) | hexVal(input[i + 2]!);
      w += 1;
      i += 2;
      continue;
    }
    bytes[w] = input.charCodeAt(i) & 0xff;
    w += 1;
  }
  return decodeCharset(bytes.subarray(0, w), charset);
}

function decodeRfc2047(value: string): string {
  const re = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  let out = '';
  let last = 0;
  let prevEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== undefined && match !== null) {
    const idx = match.index;
    const between = value.slice(last, idx);
    if (prevEnd >= 0 && isOnlyWsp(between)) {
      // adjacent encoded-words: drop the interstitial whitespace
    } else {
      out += between;
    }
    out += decodeEncodedWord(match[1]!, match[2]!, match[3]!);
    last = idx + match[0].length;
    prevEnd = last;
  }
  if (last === 0) return value;
  return out + value.slice(last);
}

function isOnlyWsp(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (!isWspChar(s[i])) return false;
  }
  return s.length > 0;
}

function decodeEncodedWord(charset: string, enc: string, payload: string): string {
  const kind = enc.toUpperCase();
  let bytes: Uint8Array;
  if (kind === 'B') {
    bytes = decodeBase64(new TextEncoder().encode(payload));
  } else {
    bytes = decodeRfc2047Q(payload);
  }
  return decodeCharset(bytes, charset);
}

function decodeRfc2047Q(payload: string): Uint8Array {
  const out = new Uint8Array(payload.length);
  let w = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const c = payload[i]!;
    if (c === '_') {
      out[w] = 0x20;
      w += 1;
      continue;
    }
    if (
      c === '=' &&
      i + 2 < payload.length &&
      isHexChar(payload[i + 1]!) &&
      isHexChar(payload[i + 2]!)
    ) {
      out[w] = (hexVal(payload[i + 1]!) << 4) | hexVal(payload[i + 2]!);
      w += 1;
      i += 2;
      continue;
    }
    out[w] = payload.charCodeAt(i) & 0xff;
    w += 1;
  }
  return out.subarray(0, w);
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try {
    return decode(bytes, charset);
  } catch {
    try {
      return decode(bytes, 'utf-8');
    } catch {
      return latin1(bytes);
    }
  }
}

function decodeTransfer(body: Uint8Array, cte: string): Uint8Array {
  if (cte === 'base64') return decodeBase64(body);
  if (cte === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

function decodeQuotedPrintable(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let w = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b === 0x3d) {
      const a = bytes[i + 1];
      const c = bytes[i + 2];
      if (a === 0x0d && c === 0x0a) {
        i += 2;
        continue;
      }
      if (a === 0x0a || a === 0x0d) {
        i += 1;
        continue;
      }
      if (a !== undefined && c !== undefined && isHexByte(a) && isHexByte(c)) {
        out[w] = (hexByte(a) << 4) | hexByte(c);
        w += 1;
        i += 2;
        continue;
      }
    }
    if (b === 0x09 || b === 0x20) {
      let j = i + 1;
      while (j < bytes.length && (bytes[j] === 0x09 || bytes[j] === 0x20)) j += 1;
      if (j < bytes.length && (bytes[j] === 0x0d || bytes[j] === 0x0a)) {
        i = j - 1;
        continue;
      }
    }
    out[w] = b;
    w += 1;
  }
  return out.subarray(0, w);
}

const BASE64_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint8Array(128).fill(255);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i += 1) t[alphabet.charCodeAt(i)] = i;
  t[0x2d] = 62; // -
  t[0x5f] = 63; // _
  return t;
})();

function decodeBase64(bytes: Uint8Array): Uint8Array {
  const cap = Math.floor(bytes.length / 4) * 3 + 3;
  const out = new Uint8Array(cap);
  let acc = 0;
  let bits = 0;
  let w = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i]!;
    if (c === 0x3d) break;
    if (c >= 128) continue;
    const v = BASE64_TABLE[c]!;
    if (v === 255) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[w] = (acc >> bits) & 0xff;
      w += 1;
    }
  }
  return out.subarray(0, w);
}

function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
  if (boundary.length === 0) return [];
  const delim = new TextEncoder().encode(`--${boundary}`);
  const positions: number[] = [];
  const isClose: boolean[] = [];
  let from = 0;
  while (from + delim.length <= body.length) {
    const at = indexOfBytes(body, delim, from);
    if (at < 0) break;
    if (!isLineStart(body, at)) {
      from = at + 1;
      continue;
    }
    positions.push(at);
    const after = at + delim.length;
    isClose.push(body[after] === 0x2d && body[after + 1] === 0x2d);
    from = after;
  }
  const parts: Uint8Array[] = [];
  for (let n = 0; n < positions.length; n += 1) {
    if (isClose[n]) break;
    const start = skipDelimLine(body, positions[n]! + delim.length);
    const next = n + 1 < positions.length ? positions[n + 1]! : body.length;
    parts.push(body.subarray(start, trimTrailingEol(body, start, next)));
  }
  return parts;
}

function isLineStart(bytes: Uint8Array, i: number): boolean {
  if (i === 0) return true;
  const prev = bytes[i - 1];
  return prev === 0x0a || prev === 0x0d;
}

function skipDelimLine(bytes: Uint8Array, i: number): number {
  if (bytes[i] === 0x2d && bytes[i + 1] === 0x2d) i += 2;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09)) i += 1;
  if (bytes[i] === 0x0d) i += 1;
  if (bytes[i] === 0x0a) i += 1;
  return i;
}

function trimTrailingEol(bytes: Uint8Array, start: number, delim: number): number {
  let e = delim;
  if (e > start && bytes[e - 1] === 0x0a) e -= 1;
  if (e > start && bytes[e - 1] === 0x0d) e -= 1;
  return e;
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  if (needle.length === 0) return from;
  const first = needle[0]!;
  const last = from + (hay.length - needle.length);
  for (let i = from; i <= last; i += 1) {
    if (hay[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function latin1(bytes: Uint8Array): string {
  const chunk = 4096;
  if (bytes.length <= chunk) return String.fromCharCode(...bytes);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunk)));
  }
  return parts.join('');
}

function isHexChar(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

function hexVal(c: string): number {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 87;
  return c.charCodeAt(0) - 55;
}

function isHexByte(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);
}

function hexByte(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x37;
  return b - 0x57;
}
