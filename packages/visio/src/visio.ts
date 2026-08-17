import { CompoundFile, detectOleDoc, detectZipDoc, hasOleMagic, Package } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

const EXTS = new Set(['vsd', 'vsdx', 'vss', 'vst', 'vssx', 'vstx']);

export function visio(): Converter {
  return {
    id: 'visio',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      const zip: string | undefined = detectZipDoc(bytes);
      if (zip === 'vsdx' || (zip === undefined && isVisioZip(bytes))) return 2;
      if (zip !== undefined) return 0;
      const ole: string | undefined = detectOleDoc(bytes);
      if (ole === 'vsd' || (ole === undefined && isVisioOle(bytes))) return 2;
      if (ole !== undefined) return 0;
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
  const zip: string | undefined = detectZipDoc(bytes);
  if (zip !== undefined && zip !== 'vsdx') throw ConvertError.unsupported(zip);
  const ole: string | undefined = detectOleDoc(bytes);
  if (ole !== undefined && ole !== 'vsd') throw ConvertError.unsupported(ole);
  if (!isZip(bytes) && !hasOleMagic(bytes)) throw ConvertError.unsupported('visio');
}

/** visio/document.xml (or visio/*) — used when detectZipDoc does not yet yield `vsdx`. */
function isVisioZip(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  try {
    const pkg = Package.open(bytes);
    if (pkg.hasPart('visio/document.xml')) return true;
    for (const name of pkg.partNames()) {
      if (name.toLowerCase().startsWith('visio/')) return true;
    }
    const types = pkg.optionalPart('[Content_Types].xml');
    if (types !== undefined && containsAsciiCi(types, 'visio')) return true;
    return false;
  } catch {
    return false;
  }
}

/** VisioDocument stream — used when detectOleDoc does not yet yield `vsd`. */
function isVisioOle(bytes: Uint8Array): boolean {
  if (!hasOleMagic(bytes)) return false;
  try {
    for (const entry of CompoundFile.open(bytes).readRootStorage()) {
      if (eqIgnoreAsciiCase(entry.name, 'VisioDocument')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function containsAsciiCi(bytes: Uint8Array, needle: string): boolean {
  if (needle.length === 0 || bytes.length < needle.length) return false;
  const n = needle.length;
  const first = needle.charCodeAt(0);
  const firstLower = first >= 65 && first <= 90 ? first + 32 : first;
  for (let i = 0; i <= bytes.length - n; i += 1) {
    const b = bytes[i]!;
    const bl = b >= 65 && b <= 90 ? b + 32 : b;
    if (bl !== firstLower) continue;
    let ok = true;
    for (let j = 1; j < n; j += 1) {
      const a = bytes[i + j]!;
      const c = needle.charCodeAt(j);
      const al = a >= 65 && a <= 90 ? a + 32 : a;
      const cl = c >= 65 && c <= 90 ? c + 32 : c;
      if (al !== cl) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
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
