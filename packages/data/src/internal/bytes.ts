import { ConvertError } from '@mdgate/core';

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function skipBomAndWs(bytes: Uint8Array): number {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return i;
}

export function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
}

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function isOle(bytes: Uint8Array): boolean {
  if (bytes.length < OLE_MAGIC.length) return false;
  for (let i = 0; i < OLE_MAGIC.length; i += 1) {
    if (bytes[i] !== OLE_MAGIC[i]) return false;
  }
  return true;
}

export function isRtf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '{\\rtf', start);
}

/** PK zip, OLE, PDF, and RTF belong to other converters. */
export function isForeign(bytes: Uint8Array): boolean {
  return isPdf(bytes) || isZip(bytes) || isOle(bytes) || isRtf(bytes);
}

export function startsWithJsonOpen(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  if (start >= bytes.length) return false;
  const b = bytes[start]!;
  if (b === 0x7b) return jsonObjectLooksOpen(bytes, start + 1);
  if (b === 0x5b) return jsonArrayLooksOpen(bytes, start + 1);
  return false;
}

function skipWs(bytes: Uint8Array, i: number): number {
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return i;
}

/** `{` then a string key or `}`. `{0}{25}cue` is MicroDVD, not JSON. */
function jsonObjectLooksOpen(bytes: Uint8Array, after: number): boolean {
  const i = skipWs(bytes, after);
  if (i >= bytes.length) return true;
  const c = bytes[i]!;
  return c === 0x22 || c === 0x7d;
}

/**
 * `[` then a JSON value. `[ti:Title]` and `[00:35.62]lyric` are LRC, not JSON.
 */
function jsonArrayLooksOpen(bytes: Uint8Array, after: number): boolean {
  const i = skipWs(bytes, after);
  if (i >= bytes.length) return true;
  const c = bytes[i]!;
  if (c === 0x5d || c === 0x7b || c === 0x5b || c === 0x22) return true;
  if (c === 0x74) return startsWithAscii(bytes, 'true', i);
  if (c === 0x66) return startsWithAscii(bytes, 'false', i);
  if (c === 0x6e) return startsWithAscii(bytes, 'null', i);
  if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return jsonNumberThenArraySep(bytes, i);
  return false;
}

function jsonNumberThenArraySep(bytes: Uint8Array, start: number): boolean {
  let i = start;
  if (bytes[i] === 0x2d) i += 1;
  if (i >= bytes.length || bytes[i]! < 0x30 || bytes[i]! > 0x39) return false;
  if (bytes[i] === 0x30) i += 1;
  else {
    while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) i += 1;
  }
  if (bytes[i] === 0x2e) {
    i += 1;
    if (i >= bytes.length || bytes[i]! < 0x30 || bytes[i]! > 0x39) return false;
    while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) i += 1;
  }
  const exp = bytes[i];
  if (exp === 0x65 || exp === 0x45) {
    i += 1;
    if (bytes[i] === 0x2b || bytes[i] === 0x2d) i += 1;
    if (i >= bytes.length || bytes[i]! < 0x30 || bytes[i]! > 0x39) return false;
    while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) i += 1;
  }
  i = skipWs(bytes, i);
  if (i >= bytes.length) return true;
  const n = bytes[i]!;
  return n === 0x2c || n === 0x5d;
}

/** Content that would be claimed as XML (never a score-2 signature). */
export function looksLikeXml(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  if (startsWithAscii(bytes, '<?xml', start)) return true;
  if (start >= bytes.length || bytes[start] !== 0x3c) return false;
  const next = bytes[start + 1];
  return next !== undefined && isNameByte(next);
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripBom(new TextDecoder('utf-16le').decode(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripBom(new TextDecoder('utf-16be').decode(bytes));
  }
  const rest =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rest);
  } catch {
    throw ConvertError.malformed('invalid utf-8');
  }
}

export function fileStem(filePath: string): string | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = dot <= 0 ? base : base.slice(0, dot);
  return stem.length > 0 ? stem : undefined;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function isNameByte(b: number): boolean {
  return (
    (b >= 48 && b <= 57) ||
    (b >= 65 && b <= 90) ||
    (b >= 97 && b <= 122) ||
    b === 45 ||
    b === 95 ||
    b === 58
  );
}
