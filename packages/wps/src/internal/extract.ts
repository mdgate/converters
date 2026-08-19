import { CompoundFile, type Element, hasOleMagic, Package, parseXml } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument, plain } from '@mdgate/document';
import { cleanText, collapseWs, isAlphanumeric } from '@mdgate/utils';

const TYPE_STREAM = 2;
const MIN_RUN = 2;

/** Best-effort paragraphs from proprietary Kingsoft bytes. Never throws except ConvertError. */
export function extractProprietary(bytes: Uint8Array): Document {
  const texts: string[] = [];
  try {
    if (isZip(bytes)) collectZip(bytes, texts);
    else if (hasOleMagic(bytes)) collectOle(bytes, texts);
    else collectFromBytes(bytes, texts);
  } catch (e) {
    if (e instanceof ConvertError && (e.code === 'encrypted' || e.isFatal())) {
      throw e;
    }
    collectFromBytes(bytes, texts);
  }

  const seen = new Set<string>();
  const doc = emptyDocument();
  for (const raw of texts) {
    const text = collapseWs(cleanText(raw)).trim();
    if (!isUsable(text) || seen.has(text)) continue;
    seen.add(text);
    doc.blocks.push({ type: 'paragraph', inlines: [plain(text)] });
  }
  if (doc.blocks.length === 0) {
    throw ConvertError.malformed('no readable text in WPS document');
  }
  return doc;
}

function collectZip(bytes: Uint8Array, out: string[]): void {
  const pkg = Package.open(bytes);
  for (const name of pkg.partNames()) {
    if (skipPart(name)) continue;
    const part = pkg.optionalPart(name);
    if (part !== undefined) collectFromBytes(part, out);
  }
}

function collectOle(bytes: Uint8Array, out: string[]): void {
  const ole = CompoundFile.open(bytes);
  if (ole.exists('EncryptionInfo') || ole.exists('EncryptedPackage')) {
    throw ConvertError.encrypted();
  }
  let any = false;
  for (const entry of ole.readRootStorage()) {
    if (entry.type !== TYPE_STREAM) continue;
    try {
      collectFromBytes(ole.readStream(entry.name), out);
      any = true;
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
    }
  }
  if (!any) collectFromBytes(bytes, out);
}

function collectFromBytes(bytes: Uint8Array, out: string[]): void {
  if (looksLikeXml(bytes)) {
    try {
      collectXml(parseXml(bytes), out);
      return;
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
    }
  }
  extractUtf16(bytes, out);
  extractUtf8(bytes, out);
}

function collectXml(root: Element, out: string[]): void {
  const walk = (el: Element): void => {
    let direct = '';
    let hasElem = false;
    for (const n of el.children) {
      if (n.type === 'text') direct += n.text;
      else hasElem = true;
    }
    const text = collapseWs(cleanText(direct)).trim();
    if (isUsable(text)) out.push(text);
    if (hasElem) {
      for (const child of el.childElems()) walk(child);
    }
  };
  walk(root);
}

function extractUtf16(bytes: Uint8Array, out: string[]): void {
  const run: number[] = [];
  const flush = (): void => {
    if (run.length >= MIN_RUN) out.push(String.fromCharCode(...run));
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
  const dec = new TextDecoder('utf-8', { fatal: false });
  const text = dec.decode(bytes);
  let start = -1;
  const flush = (end: number): void => {
    if (start >= 0 && end - start >= MIN_RUN) out.push(text.slice(start, end));
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
    lower.includes('https://schemas.')
  ) {
    return false;
  }
  if (lower.startsWith('application/')) return false;
  return true;
}

function looksLikeXml(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return bytes[i] === 0x3c;
}

function skipPart(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === 'mimetype' || lower === '[content_types].xml') return true;
  if (lower.endsWith('.rels')) return true;
  return /\.(png|jpe?g|gif|bmp|emf|wmf|bin|ttf|otf|woff2?)$/i.test(lower);
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
