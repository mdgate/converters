import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/parse.js';

const EXTS = new Set([
  'srt',
  'vtt',
  'webvtt',
  'ass',
  'ssa',
  'lrc',
  'sub',
  'sbv',
  'ttml',
  'jss',
  'jacosub',
]);

export function subtitle(): Converter {
  return {
    id: 'subtitle',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (startsWithAss(bytes)) return 3;
      if (startsWithWebvtt(bytes)) return 2;
      if (startsWithTtml(bytes)) return 2;
      if (startsWithLrc(bytes)) return 2;
      if (startsWithMicrodvd(bytes)) return 2;
      if (startsWithSbv(bytes)) return 2;
      if (startsWithJacosub(bytes)) return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      refuseForeign(bytes);
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}

function startsWithWebvtt(bytes: Uint8Array): boolean {
  const start = skipBom(bytes);
  if (!startsWithAscii(bytes, 'WEBVTT', start)) return false;
  return !isNameByte(bytes[start + 6]);
}

function startsWithAss(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  if (startsWithCi(bytes, '[script info]', start)) return true;
  if (startsWithCi(bytes, '[v4+ styles]', start)) return true;
  if (startsWithCi(bytes, '[v4 styles]', start)) return true;
  return startsWithCi(bytes, '[events]', start);
}

function startsWithTtml(bytes: Uint8Array): boolean {
  const head = utf8Head(bytes);
  if (!/<tt\b/i.test(head)) return false;
  return /ttml/i.test(head) || /<tt\b[^>]*xmlns/i.test(head) || /<p\b[^>]*\bbegin=/i.test(head);
}

function startsWithLrc(bytes: Uint8Array): boolean {
  let i = skipBomAndWs(bytes);
  if (bytes[i] !== 0x5b) return false;
  i += 1;
  if (bytes[i] === 0x2d) i += 1;
  if (isDigit(bytes[i])) {
    while (isDigit(bytes[i])) i += 1;
    return bytes[i] === 0x3a;
  }
  if (!isLetter(bytes[i])) return false;
  while (isLetter(bytes[i]) || bytes[i] === 0x5f) i += 1;
  return bytes[i] === 0x3a;
}

function startsWithMicrodvd(bytes: Uint8Array): boolean {
  let i = skipBomAndWs(bytes);
  if (bytes[i] !== 0x7b) return false;
  i += 1;
  if (!isDigit(bytes[i])) return false;
  while (isDigit(bytes[i])) i += 1;
  if (bytes[i] !== 0x7d || bytes[i + 1] !== 0x7b) return false;
  return true;
}

function startsWithSbv(bytes: Uint8Array): boolean {
  return /^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*,\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\b/m.test(
    utf8Head(bytes),
  );
}

function startsWithJacosub(bytes: Uint8Array): boolean {
  const head = utf8Head(bytes);
  for (const raw of head.split(/\r?\n/)) {
    const t = raw.trim();
    if (t.length === 0 || t.startsWith('#')) continue;
    return (
      /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}[.,]\d{1,2}\b/.test(t) ||
      /^@\d+\s+@\d+\b/.test(t)
    );
  }
  return false;
}

function utf8Head(bytes: Uint8Array): string {
  const start = skipBom(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(start, Math.min(bytes.length, start + 4096)),
  );
}

function isDigit(b: number | undefined): boolean {
  return b !== undefined && b >= 0x30 && b <= 0x39;
}

function isLetter(b: number | undefined): boolean {
  return b !== undefined && ((b >= 65 && b <= 90) || (b >= 97 && b <= 122));
}

function startsWithCi(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    const a = bytes[offset + i]!;
    const b = prefix.charCodeAt(i);
    if (a === b) continue;
    const al = a >= 65 && a <= 90 ? a + 32 : a;
    const bl = b >= 65 && b <= 90 ? b + 32 : b;
    if (al !== bl) return false;
  }
  return true;
}

function refuseForeign(bytes: Uint8Array): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (isOle(bytes)) throw ConvertError.unsupported('ole');
  if (isZip(bytes)) throw ConvertError.unsupported('zip');
}

function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
}

function isOle(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}

function skipBom(bytes: Uint8Array): number {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 3;
  return 0;
}

function skipBomAndWs(bytes: Uint8Array): number {
  let i = skipBom(bytes);
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return i;
}

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function isNameByte(b: number | undefined): boolean {
  if (b === undefined) return false;
  return (
    (b >= 48 && b <= 57) ||
    (b >= 65 && b <= 90) ||
    (b >= 97 && b <= 122) ||
    b === 45 ||
    b === 95 ||
    b === 58
  );
}
