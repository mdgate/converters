import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/parse.js';

const EXTS = new Set(['srt', 'vtt', 'webvtt']);

export function subtitle(): Converter {
  return {
    id: 'subtitle',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (startsWithWebvtt(bytes)) return 2;
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
