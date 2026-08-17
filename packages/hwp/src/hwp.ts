import { CompoundFile, detectOleDoc, detectZipDoc, hasOleMagic, Package } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { hasHwpSignature, parse } from './internal/parse.js';

const EXTS = new Set(['hwp', 'hwpx', 'hwt', 'hwtx']);

export function hwp(): Converter {
  return {
    id: 'hwp',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (zipDocKind(bytes) === 'hwpx' || looksLikeHwpx(bytes)) return 2;
      if (oleDocKind(bytes) === 'hwp' || looksLikeOleHwp(bytes)) return 2;
      if (hasHwpSignature(bytes)) return 2;
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
  if (isZip(bytes)) {
    const kind = zipDocKind(bytes);
    if (kind === 'hwpx') return;
    if (kind !== undefined) throw ConvertError.unsupported(kind);
    if (looksLikeHwpx(bytes)) return;
    throw ConvertError.unsupported('zip');
  }
  if (hasOleMagic(bytes)) {
    const kind = oleDocKind(bytes);
    if (kind === 'hwp') return;
    if (kind !== undefined) throw ConvertError.unsupported(kind);
    return;
  }
  if (hasHwpSignature(bytes)) return;
  throw ConvertError.unsupported('hwp');
}

/** Same layout rules as containers' hwpx detector (older builds omit that kind). */
function looksLikeHwpx(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch {
    return false;
  }
  for (const name of pkg.partNames()) {
    const lower = name.toLowerCase();
    if (lower === 'contents/content.hpf') return true;
    if (/^contents\/section\d+\.xml$/.test(lower)) return true;
  }
  const mime = pkg.optionalPart('mimetype');
  if (mime !== undefined) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(mime);
    const base = text
      .trim()
      .toLowerCase()
      .replace(/-template$/, '');
    if (base === 'application/hwp+zip' || base === 'application/vnd.hancom.hwpx') return true;
  }
  return false;
}

function looksLikeOleHwp(bytes: Uint8Array): boolean {
  if (!hasOleMagic(bytes)) return false;
  try {
    const ole = CompoundFile.open(bytes);
    for (const entry of ole.readRootStorage()) {
      if (isHwpStream(entry.name)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isHwpStream(name: string): boolean {
  const bare = name.charCodeAt(0) === 5 ? name.slice(1) : name;
  return (
    eqIgnoreAsciiCase(name, 'FileHeader') ||
    eqIgnoreAsciiCase(bare, 'HwpSummaryInformation') ||
    eqIgnoreAsciiCase(name, 'HWPDocumentInfo')
  );
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

/** Widen unions so `hwpx` / `hwp` compare cleanly on older containers builds. */
function zipDocKind(bytes: Uint8Array): string | undefined {
  return detectZipDoc(bytes);
}

function oleDocKind(bytes: Uint8Array): string | undefined {
  return detectOleDoc(bytes);
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
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

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}
