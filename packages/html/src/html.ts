import { hasOleMagic } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parseHtmlBytes, parseMhtml } from './internal/parse.js';

const EXTS = new Set(['htm', 'html', 'xhtml', 'mhtml', 'mht']);
const MHTML_EXTS = new Set(['mhtml', 'mht']);

export function html(): Converter {
  return {
    id: 'html',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (looksLikeHtml(bytes) && !isFlatOdf(bytes)) return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult {
      refuseForeign(bytes);
      const ext = options?.path !== undefined ? fileExtension(options.path) : undefined;
      if ((ext !== undefined && MHTML_EXTS.has(ext)) || looksLikeMhtml(bytes)) {
        return { markdown: documentToMarkdown(parseMhtml(bytes)) };
      }
      if (isFlatOdf(bytes)) {
        throw ConvertError.unsupported('OpenDocument');
      }
      return { markdown: documentToMarkdown(parseHtmlBytes(bytes)) };
    },
  };
}

function refuseForeign(bytes: Uint8Array): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (hasOleMagic(bytes)) throw ConvertError.unsupported('ole');
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    throw ConvertError.unsupported('zip');
  }
}

function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  if (startsWithCi(bytes, '<!doctype html', start) && !isNameByte(bytes[start + 14])) return true;
  if (startsWithCi(bytes, '<html', start) && !isNameByte(bytes[start + 5])) return true;
  const head = utf8Lossy(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return head.includes('http://www.w3.org/1999/xhtml');
}

function looksLikeMhtml(bytes: Uint8Array): boolean {
  const head = utf8Lossy(bytes.subarray(0, Math.min(bytes.length, 512))).toLowerCase();
  return head.includes('multipart/related') || head.includes('content-location:');
}

/** Flat ODF (`office:document`) belongs to `@mdgate/odf`. */
function isFlatOdf(bytes: Uint8Array): boolean {
  const text = utf8Lossy(bytes.subarray(0, Math.min(bytes.length, 8192)));
  let i = skipWsStr(text, 0);
  if (text.startsWith('<?xml', i)) {
    const end = text.indexOf('?>', i);
    if (end < 0) return false;
    i = skipWsStr(text, end + 2);
  }
  while (text.startsWith('<!--', i)) {
    const end = text.indexOf('-->', i + 4);
    if (end < 0) return false;
    i = skipWsStr(text, end + 3);
  }
  const slice = text.slice(i, i + 2048);
  return /<office:document\b/.test(slice);
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

function skipWsStr(s: string, i: number): number {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x20) break;
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

function utf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
