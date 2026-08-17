import { CompoundFile, detectOleDoc, detectZipDoc, hasOleMagic, Package } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { doc } from '@mdgate/doc';
import { documentToMarkdown } from '@mdgate/document';
import { docx } from '@mdgate/docx';
import { ppt } from '@mdgate/ppt';
import { pptx } from '@mdgate/pptx';
import { fileExtension } from '@mdgate/utils';
import { xlsx } from '@mdgate/xlsx';
import { extractProprietary } from './internal/extract.js';

const EXTS = new Set(['wps', 'wpt', 'et', 'ett', 'dps', 'dpt']);

const DOCX = docx();
const DOC = doc();
const XLSX = xlsx();
const PPTX = pptx();
const PPT = ppt();

type OfficeKind = 'docx' | 'xlsx' | 'pptx' | 'doc' | 'xls' | 'ppt';

export function wps(): Converter {
  return {
    id: 'wps',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      // Classified MS Office content belongs to the official converters.
      if (officeKind(bytes) !== undefined) return 0;
      if (hasKingsoftMarkers(bytes)) return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult> {
      if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
      const kind = officeKind(bytes);
      if (kind === 'docx') return DOCX.convert(bytes, options);
      if (kind === 'doc') return DOC.convert(bytes, options);
      if (kind === 'xlsx' || kind === 'xls') return XLSX.convert(bytes, options);
      if (kind === 'pptx') return PPTX.convert(bytes, options);
      if (kind === 'ppt') return PPT.convert(bytes, options);
      return { markdown: documentToMarkdown(extractProprietary(bytes)) };
    },
  };
}

function officeKind(bytes: Uint8Array): OfficeKind | undefined {
  const zip = detectZipDoc(bytes);
  if (zip === 'docx' || zip === 'xlsx' || zip === 'pptx') return zip;
  const ole = detectOleDoc(bytes);
  if (ole === 'doc' || ole === 'xls' || ole === 'ppt') return ole;
  return undefined;
}

function hasKingsoftMarkers(bytes: Uint8Array): boolean {
  if (isZip(bytes)) {
    try {
      const pkg = Package.open(bytes);
      const mime = pkg.optionalPart('mimetype');
      if (mime !== undefined && mentionsKingsoft(utf8Lossy(mime))) return true;
      for (const name of pkg.partNames()) {
        if (isKingsoftName(name)) return true;
      }
      const types = pkg.optionalPart('[Content_Types].xml');
      if (types !== undefined && mentionsKingsoft(utf8Lossy(types))) return true;
      return false;
    } catch {
      // Truncated ZIP: fall through to a raw marker scan.
    }
  } else if (hasOleMagic(bytes)) {
    try {
      const ole = CompoundFile.open(bytes);
      for (const entry of ole.readRootStorage()) {
        if (isKingsoftName(entry.name)) return true;
      }
    } catch {
      // fall through
    }
  }
  return scanRawKingsoft(bytes);
}

function isKingsoftName(name: string): boolean {
  const bare = name.charCodeAt(0) === 5 ? name.slice(1) : name;
  for (const part of bare.split(/[/\\]/)) {
    if (part.length === 0) continue;
    if (startsIgnoreCase(part, 'ks') || startsIgnoreCase(part, 'wps')) return true;
  }
  return false;
}

function mentionsKingsoft(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('kingsoft') ||
    lower.includes('application/wps') ||
    lower.includes('application/vnd.wps') ||
    lower.includes('application/vnd.kingsoft')
  );
}

function scanRawKingsoft(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 65_536));
  return (
    containsAsciiCi(head, 'kingsoft') ||
    containsAsciiCi(head, 'application/wps') ||
    containsAsciiCi(head, 'application/vnd.wps') ||
    containsAsciiCi(head, 'application/vnd.kingsoft')
  );
}

function isPdf(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return startsAscii(bytes, '%PDF-', i);
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

function utf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function startsIgnoreCase(value: string, prefix: string): boolean {
  if (value.length < prefix.length) return false;
  return value.slice(0, prefix.length).toLowerCase() === prefix;
}

function startsAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
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
