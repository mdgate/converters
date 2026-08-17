import { detectZipDoc, hasOleMagic, Package } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/parse.js';

const FB_NS = 'http://www.gribuser.ru/xml/fictionbook/';

export function fb2(): Converter {
  return {
    id: 'fb2',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (looksLikeFb2(bytes)) return 2;
      if (hint?.path !== undefined && isFb2Path(hint.path)) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(xmlBytes(bytes))) };
    },
  };
}

function xmlBytes(bytes: Uint8Array): Uint8Array {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (hasOleMagic(bytes)) throw ConvertError.unsupported('ole');
  if (isZipMagic(bytes)) {
    const kind = detectZipDoc(bytes);
    if (kind !== undefined) throw ConvertError.unsupported(kind);
    return extractFb2FromZip(bytes);
  }
  return bytes;
}

function extractFb2FromZip(bytes: Uint8Array): Uint8Array {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) {
      if (isEncryptedError(e)) throw ConvertError.encrypted();
      throw e;
    }
    throw ConvertError.malformed('not a readable zip archive');
  }
  let fallback: Uint8Array | undefined;
  for (const name of pkg.partNames()) {
    if (name.endsWith('/') || isMacosx(name)) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.fb2') && !lower.endsWith('.xml')) continue;
    let part: Uint8Array | undefined;
    try {
      part = pkg.part(name);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      if (isEncryptedError(e)) throw ConvertError.encrypted();
      continue;
    }
    if (part === undefined) continue;
    if (lower.endsWith('.fb2')) return part;
    if (fallback === undefined && looksLikeFb2(part)) fallback = part;
  }
  if (fallback !== undefined) return fallback;
  throw ConvertError.missingPart('*.fb2');
}

function looksLikeFb2(bytes: Uint8Array): boolean {
  if (isPdf(bytes) || hasOleMagic(bytes) || isZipMagic(bytes)) return false;
  const start = skipBomAndWs(bytes);
  if (start >= bytes.length || bytes[start] !== 0x3c) return false;
  const text = decodeHead(bytes);
  const i = skipXmlPreamble(text, 0);
  const rest = text.slice(i);
  if (/^<([A-Za-z_][\w.-]*:)?FictionBook\b/i.test(rest)) return true;
  return rest.includes(FB_NS);
}

function isFb2Path(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? '';
  const lower = base.toLowerCase();
  return fileExtension(path) === 'fb2' || lower.endsWith('.fb2.zip');
}

function isEncryptedError(e: unknown): boolean {
  if (e instanceof ConvertError && e.code === 'encrypted') return true;
  const detail = e instanceof ConvertError ? (e.detail ?? '') : '';
  const text = e instanceof Error ? `${e.message} ${detail}` : String(e);
  const lower = text.toLowerCase();
  return lower.includes('encrypted') || lower.includes('password');
}

function isMacosx(name: string): boolean {
  for (const part of name.split('/')) {
    if (part === '__MACOSX') return true;
  }
  return false;
}

function isZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
}

function skipBomAndWs(bytes: Uint8Array): number {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return i;
}

function skipXmlPreamble(text: string, from: number): number {
  let i = skipWsStr(text, from);
  if (text.charCodeAt(i) === 0xfeff) i = skipWsStr(text, i + 1);
  if (startsWithCiStr(text, '<?xml', i)) {
    const end = text.indexOf('?>', i);
    if (end < 0) return i;
    i = skipWsStr(text, end + 2);
  }
  for (;;) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) return i;
      i = skipWsStr(text, end + 3);
      continue;
    }
    if (startsWithCiStr(text, '<!doctype', i)) {
      i = skipDoctype(text, i);
      i = skipWsStr(text, i);
      continue;
    }
    break;
  }
  return i;
}

function skipDoctype(text: string, i: number): number {
  let depth = 0;
  i += 2;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i += 1;
      while (i < text.length && text[i] !== q) i += 1;
      if (i < text.length) i += 1;
      continue;
    }
    if (ch === '<') depth += 1;
    else if (ch === '>') {
      if (depth === 0) return i + 1;
      depth -= 1;
    }
    i += 1;
  }
  return i;
}

function skipWsStr(s: string, i: number): number {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x20) break;
    i += 1;
  }
  return i;
}

function startsWithCiStr(s: string, prefix: string, offset: number): boolean {
  if (offset + prefix.length > s.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    const a = s.charCodeAt(offset + i);
    const b = prefix.charCodeAt(i);
    if (a === b) continue;
    const al = a >= 65 && a <= 90 ? a + 32 : a;
    const bl = b >= 65 && b <= 90 ? b + 32 : b;
    if (al !== bl) return false;
  }
  return true;
}

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function decodeHead(bytes: Uint8Array): string {
  const limit = Math.min(bytes.length, 8192);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(0, limit));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(0, limit));
  }
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, start + 8192));
}
