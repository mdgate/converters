import { CompoundFile } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument, plain } from '@mdgate/document';
import { cleanText, collapseWs, isAlphanumeric } from '@mdgate/utils';

const TYPE_STREAM = 2;
const MIN_RUN = 2;

export function parseVsd(bytes: Uint8Array): Document {
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw ConvertError.malformed(`not an OLE2 compound file: ${msg}`);
  }
  if (ole.exists('EncryptionInfo') || ole.exists('EncryptedPackage')) {
    throw ConvertError.encrypted();
  }

  let sawVisio = false;
  const texts: string[] = [];
  for (const entry of ole.readRootStorage()) {
    if (eqIgnoreAsciiCase(entry.name, 'VisioDocument')) sawVisio = true;
    if (entry.type !== TYPE_STREAM) continue;
    try {
      collectUnicode(ole.readStream(entry.name), texts);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
    }
  }
  if (!sawVisio) throw ConvertError.malformed('not a Visio document');

  const seen = new Set<string>();
  const doc = emptyDocument();
  for (const raw of texts) {
    const text = collapseWs(cleanText(raw)).trim();
    if (!isUsable(text) || seen.has(text)) continue;
    seen.add(text);
    doc.blocks.push({ type: 'paragraph', inlines: [plain(text)] });
  }
  if (doc.blocks.length === 0) {
    throw ConvertError.malformed('no readable text in Visio document');
  }
  return doc;
}

function collectUnicode(bytes: Uint8Array, out: string[]): void {
  extractUtf16(bytes, out);
  extractUtf8(bytes, out);
}

function extractUtf16(bytes: Uint8Array, out: string[]): void {
  const run: number[] = [];
  const flush = (): void => {
    if (run.length >= MIN_RUN) out.push(fromCharCodes(run));
    run.length = 0;
  };
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes[i]! | (bytes[i + 1]! << 8);
    if (c !== 0 && isPrintableCp(c)) run.push(c);
    else flush();
  }
  flush();
}

function extractUtf8(bytes: Uint8Array, out: string[]): void {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let start = -1;
  const flush = (end: number): void => {
    if (start >= 0 && end - start >= MIN_RUN) out.push(text.slice(start, end));
    start = -1;
  };
  for (let i = 0; i < text.length; i += 1) {
    if (isPrintableCp(text.charCodeAt(i))) {
      if (start < 0) start = i;
    } else {
      flush(i);
    }
  }
  flush(text.length);
}

function fromCharCodes(codes: number[]): string {
  const chunk = 8_192;
  if (codes.length <= chunk) return String.fromCharCode(...codes);
  let out = '';
  for (let i = 0; i < codes.length; i += chunk) {
    out += String.fromCharCode(...codes.slice(i, i + chunk));
  }
  return out;
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
    lower.includes('https://schemas.') ||
    lower.includes('visiodocument')
  ) {
    return false;
  }
  return true;
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}
