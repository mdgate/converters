import { CompoundFile, hasOleMagic } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Block, type Document, emptyDocument, heading, plain } from '@mdgate/document';
import { cleanText, collapseWs, isAlphanumeric } from '@mdgate/utils';
import { headerSkip } from './header.js';

const MIN_RUN = 4;
const MAX_RUN_CHARS = 16_384;
const MAX_STRINGS = 2_000;
const TYPE_STREAM = 2;

const GUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

const SKIP_PREFIXES = [
  'jcid',
  'fcr',
  'objectspace',
  'filedatastore',
  'persistable',
  'onenote_',
  'microsoft.office',
  'http://',
  'https://',
  'xmlns',
  'application/',
];

/** Best-effort titles and body lines. Never throws except ConvertError. */
export function extractDocument(bytes: Uint8Array): Document {
  try {
    if (hasOleMagic(bytes)) return extractOle(bytes);
    return stringsToDocument(collectStrings(bytes));
  } catch (e) {
    if (e instanceof ConvertError && (e.code === 'encrypted' || e.isFatal())) throw e;
    try {
      return stringsToDocument(collectStrings(bytes));
    } catch (inner) {
      if (inner instanceof ConvertError && inner.isFatal()) throw inner;
      return emptyDocument();
    }
  }
}

export function looksEncrypted(bytes: Uint8Array): boolean {
  if (hasOleMagic(bytes)) {
    try {
      const ole = CompoundFile.open(bytes);
      if (ole.exists('EncryptionInfo') || ole.exists('EncryptedPackage')) return true;
    } catch {
      // not a readable OLE; fall through to string markers
    }
  }
  return (
    containsUtf16Ci(bytes, 'this section is password protected') ||
    containsUtf16Ci(bytes, 'this notebook is password protected') ||
    containsAsciiCi(bytes, 'this section is password protected') ||
    containsAsciiCi(bytes, 'this notebook is password protected')
  );
}

function extractOle(bytes: Uint8Array): Document {
  const ole = CompoundFile.open(bytes);
  if (ole.exists('EncryptionInfo') || ole.exists('EncryptedPackage')) {
    throw ConvertError.encrypted();
  }
  const texts: string[] = [];
  for (const entry of ole.readRootStorage()) {
    if (entry.type !== TYPE_STREAM) continue;
    try {
      collectFromBytes(ole.readStream(entry.name), texts);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
    }
    if (texts.length >= MAX_STRINGS) break;
  }
  if (texts.length === 0) collectFromBytes(bytes, texts);
  return stringsToDocument(texts);
}

function collectStrings(bytes: Uint8Array): string[] {
  const texts: string[] = [];
  collectFromBytes(bytes, texts);
  return texts;
}

function collectFromBytes(bytes: Uint8Array, out: string[]): void {
  const skip = headerSkip(bytes);
  const slice = skip > 0 ? bytes.subarray(skip) : bytes;
  extractUtf16(slice, out);
  extractUtf8(slice, out);
}

function extractUtf16(bytes: Uint8Array, out: string[]): void {
  const dec = new TextDecoder('utf-16le');
  for (const align of [0, 1]) {
    let start = -1;
    const flush = (end: number): void => {
      if (start >= 0) {
        const chars = (end - start) >> 1;
        if (chars >= MIN_RUN && chars <= MAX_RUN_CHARS && out.length < MAX_STRINGS) {
          pushUsable(dec.decode(bytes.subarray(start, end)), out);
        }
      }
      start = -1;
    };
    for (let i = align; i + 1 < bytes.length; i += 2) {
      const c = bytes[i]! | (bytes[i + 1]! << 8);
      if (c !== 0 && isPrintableCp(c)) {
        if (start < 0) start = i;
      } else {
        flush(i);
      }
    }
    const end = bytes.length - ((bytes.length - align) & 1);
    flush(end);
  }
}

function extractUtf8(bytes: Uint8Array, out: string[]): void {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let start = -1;
  const flush = (end: number): void => {
    if (
      start >= 0 &&
      end - start >= MIN_RUN &&
      end - start <= MAX_RUN_CHARS &&
      out.length < MAX_STRINGS
    ) {
      pushUsable(text.slice(start, end), out);
    }
    start = -1;
  };
  for (let i = 0; i < text.length; i += 1) {
    const cp = text.charCodeAt(i);
    if (isPrintableCp(cp)) {
      if (start < 0) start = i;
    } else {
      flush(i);
    }
  }
  flush(text.length);
}

function pushUsable(raw: string, out: string[]): void {
  const text = collapseWs(cleanText(raw)).trim();
  if (!isUsable(text)) return;
  if (out.includes(text)) return;
  out.push(text);
}

function isPrintableCp(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x20) return true;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false;
  return cp !== 0xfffe && cp !== 0xffff;
}

function isUsable(text: string): boolean {
  if (text.length < MIN_RUN) return false;
  if (GUID_RE.test(text)) return false;
  if (isInternalName(text.toLowerCase())) return false;
  let letters = 0;
  for (const c of text) {
    if (isAlphanumeric(c)) letters += 1;
  }
  if (letters < 2) return false;
  if (letters * 4 < text.length) return false;
  return true;
}

function isInternalName(lower: string): boolean {
  for (const prefix of SKIP_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return (
    lower.includes('xmlns') ||
    lower.includes('http://schemas.') ||
    lower.includes('https://schemas.')
  );
}

function stringsToDocument(texts: string[]): Document {
  const doc = emptyDocument();
  const seen = new Set<string>();
  let first = true;
  let lastWasParagraph = false;
  for (const text of texts) {
    if (seen.has(text)) continue;
    seen.add(text);
    const block = toBlock(text, first, lastWasParagraph);
    doc.blocks.push(block);
    lastWasParagraph = block.type === 'paragraph';
    first = false;
  }
  return doc;
}

function toBlock(text: string, first: boolean, lastWasParagraph: boolean): Block {
  if (looksLikeTitle(text, first, lastWasParagraph)) {
    return heading(first ? 1 : 2, [plain(text)]);
  }
  return { type: 'paragraph', inlines: [plain(text)] };
}

function looksLikeTitle(text: string, first: boolean, lastWasParagraph: boolean): boolean {
  if (text.includes('\n')) return false;
  if (first) return text.length <= 80;
  if (!lastWasParagraph) return false;
  return text.length <= 40 && !/[.!?]/.test(text);
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
    if (asciiEqualsCi(bytes, i, needle)) return true;
  }
  return false;
}

function containsUtf16Ci(bytes: Uint8Array, needle: string): boolean {
  const n = needle.length;
  if (n === 0 || bytes.length < n * 2) return false;
  const first = needle.charCodeAt(0);
  const firstLower = first >= 65 && first <= 90 ? first + 32 : first;
  for (const align of [0, 1]) {
    for (let i = align; i + n * 2 <= bytes.length; i += 2) {
      const c = bytes[i]! | (bytes[i + 1]! << 8);
      const cl = c >= 65 && c <= 90 ? c + 32 : c;
      if (cl !== firstLower) continue;
      if (utf16EqualsCi(bytes, i, needle)) return true;
    }
  }
  return false;
}

function asciiEqualsCi(bytes: Uint8Array, offset: number, needle: string): boolean {
  for (let j = 1; j < needle.length; j += 1) {
    const a = bytes[offset + j]!;
    const c = needle.charCodeAt(j);
    const al = a >= 65 && a <= 90 ? a + 32 : a;
    const cl = c >= 65 && c <= 90 ? c + 32 : c;
    if (al !== cl) return false;
  }
  return true;
}

function utf16EqualsCi(bytes: Uint8Array, offset: number, needle: string): boolean {
  for (let j = 1; j < needle.length; j += 1) {
    const a = bytes[offset + j * 2]! | (bytes[offset + j * 2 + 1]! << 8);
    const c = needle.charCodeAt(j);
    const al = a >= 65 && a <= 90 ? a + 32 : a;
    const cl = c >= 65 && c <= 90 ? c + 32 : c;
    if (al !== cl) return false;
  }
  return true;
}
