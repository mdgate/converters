/** Binary HWP: OLE BodyText streams, or classic `HWP Document File` bytes. */

import { CompoundFile, hasOleMagic } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument, plain } from '@mdgate/document';
import { cleanText, collapseWs, inflateZlib, isAlphanumeric } from '@mdgate/utils';

const HWP_SIG = 'HWP Document File';
const MIN_RUN = 2;
const HWPTAG_BEGIN = 0x10;
const HWPTAG_PARA_TEXT = HWPTAG_BEGIN + 51;
const EXTENDED_CTRL = new Set([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x15,
  0x16, 0x17, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e,
]);

export function hasHwpSignature(bytes: Uint8Array): boolean {
  if (bytes.length < HWP_SIG.length) return false;
  for (let i = 0; i < HWP_SIG.length; i += 1) {
    if (bytes[i] !== HWP_SIG.charCodeAt(i)) return false;
  }
  return true;
}

export function parseHwp(bytes: Uint8Array): Document {
  if (hasOleMagic(bytes)) return parseOle(bytes);
  if (hasHwpSignature(bytes)) return paragraphsOrThrow(extractSignatureText(bytes));
  throw ConvertError.malformed('not an HWP document');
}

function parseOle(bytes: Uint8Array): Document {
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw ConvertError.malformed('not an OLE2 compound file');
  }
  if (ole.exists('EncryptionInfo') || ole.exists('EncryptedPackage')) {
    throw ConvertError.encrypted();
  }

  const header = tryRead(ole, 'FileHeader');
  const flags = header !== undefined ? readHeaderFlags(header) : undefined;
  if (flags?.encrypted || flags?.distribution) throw ConvertError.encrypted();

  const texts: string[] = [];
  let sawSection = false;
  for (let i = 0; ; i += 1) {
    const name = `BodyText/Section${i}`;
    if (!ole.exists(name)) {
      if (sawSection || i > 0) break;
      continue;
    }
    sawSection = true;
    const stream = readStream(ole, name);
    if (stream === undefined) continue;
    const data = maybeDecompress(stream, flags?.compressed);
    collectSectionText(data, texts);
  }

  if (texts.length === 0) {
    const preview = tryRead(ole, 'PrvText');
    if (preview !== undefined) collectPreview(preview, texts);
  }
  if (texts.length === 0) {
    for (const entry of ole.readRootStorage()) {
      if (entry.type !== 2) continue;
      const stream = tryRead(ole, entry.name);
      if (stream !== undefined) extractUtf16(stream, texts);
    }
  }

  return paragraphsOrThrow(texts);
}

function readHeaderFlags(
  header: Uint8Array,
): { compressed: boolean; encrypted: boolean; distribution: boolean } | undefined {
  if (header.length < 40) return undefined;
  if (!hasHwpSignature(header)) return undefined;
  const flags = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(
    36,
    true,
  );
  return {
    compressed: (flags & 1) !== 0,
    encrypted: (flags & 2) !== 0,
    distribution: (flags & 4) !== 0,
  };
}

function collectSectionText(data: Uint8Array, out: string[]): void {
  const fromRecords = extractParaText(data);
  if (fromRecords.length > 0) {
    for (const text of fromRecords) out.push(text);
    return;
  }
  extractUtf16(data, out);
}

function extractParaText(data: Uint8Array): string[] {
  if (data.length < 4) return [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  let off = 0;
  let records = 0;
  let consumed = 0;
  while (off + 4 <= data.length) {
    const header = dv.getUint32(off, true);
    const tag = header & 0x3ff;
    const sizeField = (header >>> 20) & 0xfff;
    let size = sizeField;
    let payloadAt = off + 4;
    if (sizeField === 0xfff) {
      if (payloadAt + 4 > data.length) break;
      size = dv.getUint32(payloadAt, true);
      payloadAt += 4;
    }
    if (size < 0 || payloadAt + size > data.length) break;
    records += 1;
    consumed = payloadAt + size;
    if (tag === HWPTAG_PARA_TEXT) {
      const text = decodeParaText(data.subarray(payloadAt, payloadAt + size));
      if (text.length > 0) out.push(text);
    }
    off = payloadAt + size;
  }
  if (out.length === 0 && (records === 0 || consumed < data.length / 2)) return [];
  return out;
}

function decodeParaText(payload: Uint8Array): string {
  const n = payload.length & ~1;
  let out = '';
  let i = 0;
  while (i + 1 < n) {
    const c = payload[i]! | (payload[i + 1]! << 8);
    i += 2;
    if (c < 32) {
      if (EXTENDED_CTRL.has(c)) i += 14;
      else if (c === 9) out += '\t';
      else if (c === 10) out += '\n';
      else if (c === 0x18 || c === 0x19) out += '-';
      else if (c === 0x1f) out += ' ';
      continue;
    }
    if (c === 0xfffe || c === 0xffff) continue;
    out += String.fromCharCode(c);
  }
  return out;
}

function maybeDecompress(data: Uint8Array, compressed: boolean | undefined): Uint8Array {
  if (data.length >= 2 && isZlibHeader(data)) {
    const inflated = tryInflate(data);
    if (inflated !== undefined) return inflated;
  }
  if (compressed === false) return data;
  if (compressed === true) {
    const inflated = tryInflate(data);
    if (inflated !== undefined) return inflated;
  }
  return data;
}

function tryInflate(data: Uint8Array): Uint8Array | undefined {
  try {
    return inflateZlib(data, Number.MAX_SAFE_INTEGER);
  } catch {
    return undefined;
  }
}

function isZlibHeader(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  const cmf = data[0]!;
  const flg = data[1]!;
  if (((cmf << 8) + flg) % 31 !== 0) return false;
  return (cmf & 0x0f) === 8;
}

function extractSignatureText(bytes: Uint8Array): string[] {
  const start = bytes.length > 32 ? 32 : HWP_SIG.length;
  const texts: string[] = [];
  extractUtf16(bytes.subarray(Math.min(start, bytes.length)), texts);
  if (texts.length === 0) extractUtf16(bytes, texts);
  return texts;
}

function collectPreview(bytes: Uint8Array, out: string[]): void {
  const n = bytes.length & ~1;
  const text = new TextDecoder('utf-16le').decode(bytes.subarray(0, n));
  for (const part of text.split(/\0+/)) {
    const cleaned = collapseWs(cleanText(part)).trim();
    if (isUsable(cleaned)) out.push(cleaned);
  }
}

function extractUtf16(bytes: Uint8Array, out: string[]): void {
  let run = '';
  const flush = (): void => {
    if (run.length >= MIN_RUN) out.push(run);
    run = '';
  };
  const n = bytes.length & ~1;
  for (let i = 0; i < n; i += 2) {
    const c = bytes[i]! | (bytes[i + 1]! << 8);
    if (c !== 0 && isPrintableCp(c)) run += String.fromCharCode(c);
    else flush();
  }
  flush();
}

function paragraphsOrThrow(texts: string[]): Document {
  const seen = new Set<string>();
  const doc = emptyDocument();
  for (const raw of texts) {
    const text = collapseWs(cleanText(raw)).trim();
    if (!isUsable(text) || seen.has(text)) continue;
    seen.add(text);
    doc.blocks.push({ type: 'paragraph', inlines: [plain(text)] });
  }
  if (doc.blocks.length === 0) {
    throw ConvertError.malformed('no readable text in HWP document');
  }
  return doc;
}

function isPrintableCp(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x20) return true;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false;
  return cp !== 0xfffe && cp !== 0xffff;
}

function isUsable(text: string): boolean {
  if (text.length < MIN_RUN) return false;
  let letters = 0;
  for (const c of text) {
    if (isAlphanumeric(c)) letters += 1;
  }
  if (letters < 2) return false;
  const lower = text.toLowerCase();
  if (
    lower.includes('xmlns') ||
    lower.includes('http://schemas.') ||
    lower.includes('hwp document file')
  ) {
    return false;
  }
  return true;
}

function tryRead(ole: CompoundFile, name: string): Uint8Array | undefined {
  if (!ole.exists(name)) return undefined;
  return readStream(ole, name);
}

function readStream(ole: CompoundFile, name: string): Uint8Array | undefined {
  try {
    return ole.readStream(name);
  } catch (e) {
    if (e instanceof ConvertError && e.isFatal()) throw e;
    return undefined;
  }
}
