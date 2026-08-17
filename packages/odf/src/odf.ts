import { detectZipDoc, hasOleMagic } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

const ZIP_KINDS = new Set(['odt', 'ods', 'odp', 'odg']);
const EXTS = new Set([
  'odt',
  'ods',
  'odp',
  'odg',
  'ott',
  'ots',
  'otp',
  'otg',
  'fodt',
  'fods',
  'fodp',
  'fodg',
]);

const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

export function odf(): Converter {
  return {
    id: 'odf',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (ZIP_KINDS.has(detectZipDoc(bytes) ?? '')) return 2;
      if (isFlatOdf(bytes)) return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      refuseForeign(bytes);
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}

function refuseForeign(bytes: Uint8Array): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (hasOleMagic(bytes)) throw ConvertError.unsupported('ole');
  const zip = detectZipDoc(bytes);
  if (zip !== undefined && !ZIP_KINDS.has(zip)) throw ConvertError.unsupported(zip);
}

/** Flat ODF is a single XML file; never ZIP-open those bytes. */
function isFlatOdf(bytes: Uint8Array): boolean {
  if (!looksLikeXml(bytes)) return false;
  const text = utf8Lossy(bytes.subarray(0, Math.min(bytes.length, 8192)));
  return text.includes(OFFICE_NS) || text.includes('office:document');
}

function looksLikeXml(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return start < bytes.length && bytes[start] === 0x3c;
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

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function utf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
