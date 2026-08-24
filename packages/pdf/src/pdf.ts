//! PDF frontend. Reconstructs reading order from positioned text.

import { type Convert, ConvertError } from '@mdgate/core';
import { inflateRaw, inflateZlib } from '@mdgate/utils';
import { adobeOrderingKey, fillAdobeCidMap } from './adobe-cid.js';
import { normalizeCjkText } from './cjk.js';
import {
  decodeUni,
  type EncodingCmap,
  encodingCmap,
  inferAdobeOrdering,
  parseEmbeddedCmap,
  type UniKind,
  uniKind,
} from './encoding-cmap.js';
import { applyDifferences, applyNamedEncoding } from './encodings.js';
import { xObjectToImage } from './images.js';
import { groupIntoLines, lineBox, orderBoxes } from './layout.js';
import { detectTables } from './tables.js';
import { cmapFromTrueType } from './truetype.js';

export function toMarkdownFromPdf(bytes: Uint8Array): string;
export function toMarkdownFromPdf(bytes: Uint8Array, convert: Convert): Promise<string>;
export function toMarkdownFromPdf(bytes: Uint8Array, convert?: Convert): string | Promise<string> {
  const extracted = extractPdf(bytes, convert !== undefined);
  if (convert === undefined) return finishPdf(extracted, []);
  return convertUniqueImages(extracted.images, convert).then((blocks) =>
    finishPdf(extracted, blocks),
  );
}

interface ExtractedPdf {
  items: TextItem[];
  strokeLines: StrokeLine[];
  pageRects: PdfRect[];
  stats: DecodeStats;
  images: PlacedImage[];
}

interface PlacedImage {
  key: string;
  page: number;
  x: number;
  y: number;
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
}

interface MarkdownBlock {
  page: number;
  x: number;
  y: number;
  markdown: string;
}

function extractPdf(bytes: Uint8Array, wantImages: boolean): ExtractedPdf {
  validatePdfBytes(bytes);
  const doc = parsePdf(bytes);
  if (doc.encrypted) throw ConvertError.encrypted();
  const pages = collectPages(doc);
  if (pages.length === 0) {
    throw ConvertError.malformed('invalid PDF structure');
  }

  const items: TextItem[] = [];
  const strokeLines: StrokeLine[] = [];
  const pageRects: PdfRect[] = [];
  const images: PlacedImage[] = [];
  const imageCache = new Map<string, PlacedImage | null>();
  const stats: DecodeStats = { mapped: 0, unmapped: 0 };
  for (let i = 0; i < pages.length; i += 1) {
    const extracted = extractPage(doc, pages[i]!, i + 1, wantImages, imageCache);
    items.push(...extracted.items);
    strokeLines.push(...extracted.lines);
    pageRects.push(...extracted.rects);
    images.push(...extracted.images);
    stats.mapped += extracted.stats.mapped;
    stats.unmapped += extracted.stats.unmapped;
  }

  return {
    items,
    strokeLines,
    pageRects,
    stats,
    images,
  };
}

async function convertUniqueImages(
  images: PlacedImage[],
  convert: Convert,
): Promise<MarkdownBlock[]> {
  const first = new Map<string, PlacedImage>();
  for (const img of images) {
    if (!first.has(img.key)) first.set(img.key, img);
  }
  const blocks: MarkdownBlock[] = [];
  await Promise.all(
    [...first.values()].map(async (img) => {
      const ext = img.mime === 'image/jpeg' ? 'jpg' : 'png';
      let markdown: string;
      try {
        markdown = (
          await convert(img.bytes, { path: `image-${img.page}.${ext}`, page: img.page })
        ).trim();
      } catch (err) {
        if (err instanceof ConvertError && err.code === 'unsupported') return;
        throw err;
      }
      if (markdown.length === 0) return;
      blocks.push({
        page: img.page,
        x: img.x,
        y: img.y,
        markdown: markdown.endsWith('\n') ? markdown : `${markdown}\n`,
      });
    }),
  );
  return blocks;
}

function finishPdf(extracted: ExtractedPdf, imageBlocks: MarkdownBlock[]): string {
  const markdown = itemsToMarkdown(
    mergeScriptItems(dedupeOverlappingItems(extracted.items)),
    extracted.strokeLines,
    extracted.pageRects,
    imageBlocks,
  );
  if (markdown.trim().length === 0) return '';
  return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
}

// ---------------------------------------------------------------------------
// Validation / errors
// ---------------------------------------------------------------------------

function stripBomAndWs(bytes: Uint8Array): Uint8Array {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  while (start < bytes.length && isPdfWs(bytes[start]!)) start += 1;
  return bytes.subarray(start);
}

function startsWithCi(hay: Uint8Array, needle: string): boolean {
  if (hay.length < needle.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    const a = hay[i]!;
    const b = needle.charCodeAt(i);
    if (a === b) continue;
    const al = a >= 65 && a <= 90 ? a + 32 : a;
    const bl = b >= 65 && b <= 90 ? b + 32 : b;
    if (al !== bl) return false;
  }
  return true;
}

function detectFileTypeHint(bytes: Uint8Array): string {
  if (bytes.length === 0) return 'file is empty';
  const trimmed = stripBomAndWs(bytes);
  if (
    startsWithCi(trimmed, '<!doctype html') ||
    startsWithCi(trimmed, '<html') ||
    startsWithCi(trimmed, '<head') ||
    startsWithCi(trimmed, '<body')
  ) {
    return 'file appears to be HTML';
  }
  if (trimmed[0] === 0x3c) return 'file appears to be XML';
  if (trimmed[0] === 0x7b || trimmed[0] === 0x5b) return 'file appears to be JSON';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'file appears to be a PNG image';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'file appears to be a JPEG image';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return 'file appears to be a ZIP archive (possibly an Office document)';
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let printable = 0;
  for (const b of sample) {
    if ((b >= 0x20 && b <= 0x7e) || b === 9 || b === 10 || b === 13) printable += 1;
  }
  if (printable > (sample.length * 3) / 4) return 'file appears to be plain text';
  return 'file is not a PDF';
}

function validatePdfBytes(buffer: Uint8Array): void {
  if (buffer.length === 0) {
    throw ConvertError.malformed(`not a PDF: ${detectFileTypeHint(buffer)}`);
  }
  const header = buffer.subarray(0, Math.min(buffer.length, 1024));
  const trimmed = stripBomAndWs(header);
  if (!startsWithAscii(trimmed, '%PDF-')) {
    throw ConvertError.malformed(`not a PDF: ${detectFileTypeHint(buffer)}`);
  }
}

function startsWithAscii(bytes: Uint8Array, s: string): boolean {
  if (bytes.length < s.length) return false;
  for (let i = 0; i < s.length; i += 1) {
    if (bytes[i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

function isPdfWs(b: number): boolean {
  return b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
}

// ---------------------------------------------------------------------------
// PDF object model
// ---------------------------------------------------------------------------

type PdfRef = { readonly r: true; num: number; gen: number };
type PdfValue = null | boolean | number | string | Uint8Array | PdfRef | PdfValue[] | PdfDict;

interface PdfDict {
  readonly d: true;
  map: Map<string, PdfValue>;
  stream?: Uint8Array;
}

interface PdfDocument {
  bytes: Uint8Array;
  objects: Map<string, PdfValue>;
  trailer: PdfDict;
  encrypted: boolean;
}

function refKey(num: number, gen: number): string {
  return `${num} ${gen}`;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && 'r' in v && (v as PdfRef).r === true;
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && 'd' in v && (v as PdfDict).d === true;
}

function nameOf(v: PdfValue | undefined): string | undefined {
  return typeof v === 'string' && v.startsWith('/') ? v : undefined;
}

function asNumber(v: PdfValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

// ---------------------------------------------------------------------------
// Tokenizer / value parser
// ---------------------------------------------------------------------------

class Cursor {
  readonly data: Uint8Array;
  i: number;

  constructor(data: Uint8Array, i = 0) {
    this.data = data;
    this.i = i;
  }

  get n(): number {
    return this.data.length;
  }

  peek(): number | undefined {
    return this.data[this.i];
  }

  skipWs(): void {
    const data = this.data;
    let i = this.i;
    while (i < data.length) {
      const b = data[i]!;
      if (isPdfWs(b)) {
        i += 1;
        continue;
      }
      if (b === 0x25) {
        i += 1;
        while (i < data.length && data[i] !== 10 && data[i] !== 13) i += 1;
        continue;
      }
      break;
    }
    this.i = i;
  }
}

function parseValue(c: Cursor): PdfValue {
  c.skipWs();
  if (c.i >= c.n) return null;
  const b = c.data[c.i]!;
  if (b === 0x3c) {
    if (c.data[c.i + 1] === 0x3c) return parseDict(c);
    return parseHexString(c);
  }
  if (b === 0x5b) return parseArray(c);
  if (b === 0x28) return parseLiteralString(c);
  if (b === 0x2f) return parseName(c);
  if (b === 0x2b || b === 0x2d || b === 0x2e || (b >= 0x30 && b <= 0x39)) {
    return parseNumberOrRef(c);
  }
  const kw = parseKeyword(c);
  if (kw === 'true') return true;
  if (kw === 'false') return false;
  if (kw === 'null') return null;
  return kw;
}

function parseDict(c: Cursor): PdfDict {
  c.i += 2;
  const map = new Map<string, PdfValue>();
  for (;;) {
    c.skipWs();
    if (c.data[c.i] === 0x3e && c.data[c.i + 1] === 0x3e) {
      c.i += 2;
      break;
    }
    if (c.i >= c.n) break;
    const key = parseValue(c);
    const val = parseValue(c);
    if (typeof key === 'string' && key.startsWith('/')) map.set(key, val);
  }
  return { d: true, map };
}

function parseArray(c: Cursor): PdfValue[] {
  c.i += 1;
  const arr: PdfValue[] = [];
  for (;;) {
    c.skipWs();
    if (c.data[c.i] === 0x5d) {
      c.i += 1;
      break;
    }
    if (c.i >= c.n) break;
    arr.push(parseValue(c));
  }
  return arr;
}

function parseName(c: Cursor): string {
  const start = c.i;
  c.i += 1;
  while (c.i < c.n) {
    const b = c.data[c.i]!;
    if (
      isPdfWs(b) ||
      b === 0x28 ||
      b === 0x29 ||
      b === 0x3c ||
      b === 0x3e ||
      b === 0x5b ||
      b === 0x5d ||
      b === 0x7b ||
      b === 0x7d ||
      b === 0x2f ||
      b === 0x25
    ) {
      break;
    }
    c.i += 1;
  }
  return asciiSlice(c.data, start, c.i);
}

function parseKeyword(c: Cursor): string {
  const start = c.i;
  while (c.i < c.n) {
    const b = c.data[c.i]!;
    if (
      isPdfWs(b) ||
      b === 0x28 ||
      b === 0x29 ||
      b === 0x3c ||
      b === 0x3e ||
      b === 0x5b ||
      b === 0x5d ||
      b === 0x7b ||
      b === 0x7d ||
      b === 0x2f ||
      b === 0x25
    ) {
      break;
    }
    c.i += 1;
  }
  return asciiSlice(c.data, start, c.i);
}

function parseNumberOrRef(c: Cursor): PdfValue {
  const num = parseNumberToken(c);
  const saved = c.i;
  c.skipWs();
  const nb = c.peek();
  if (nb !== undefined && nb >= 0x30 && nb <= 0x39) {
    const gen = parseNumberToken(c);
    c.skipWs();
    if (c.data[c.i] === 0x52 && !isIdentByte(c.data[c.i + 1])) {
      c.i += 1;
      return { r: true, num: Math.trunc(num), gen: Math.trunc(gen) };
    }
  }
  c.i = saved;
  return num;
}

function isIdentByte(b: number | undefined): boolean {
  if (b === undefined) return false;
  return (
    (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x5f
  );
}

function parseNumberToken(c: Cursor): number {
  const start = c.i;
  if (c.data[c.i] === 0x2b || c.data[c.i] === 0x2d) c.i += 1;
  while (c.i < c.n && c.data[c.i]! >= 0x30 && c.data[c.i]! <= 0x39) c.i += 1;
  if (c.data[c.i] === 0x2e) {
    c.i += 1;
    while (c.i < c.n && c.data[c.i]! >= 0x30 && c.data[c.i]! <= 0x39) c.i += 1;
  }
  return Number(asciiSlice(c.data, start, c.i));
}

function parseHexString(c: Cursor): Uint8Array {
  c.i += 1;
  const hex: number[] = [];
  while (c.i < c.n && c.data[c.i] !== 0x3e) {
    const b = c.data[c.i]!;
    if (!isPdfWs(b)) hex.push(b);
    c.i += 1;
  }
  if (c.data[c.i] === 0x3e) c.i += 1;
  if (hex.length % 2 === 1) hex.push(0x30);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (fromHex(hex[i * 2]!) << 4) | fromHex(hex[i * 2 + 1]!);
  }
  return out;
}

function fromHex(b: number): number {
  if (b >= 48 && b <= 57) return b - 48;
  if (b >= 65 && b <= 70) return b - 55;
  if (b >= 97 && b <= 102) return b - 87;
  return 0;
}

function parseLiteralString(c: Cursor): Uint8Array {
  c.i += 1;
  const out: number[] = [];
  let depth = 1;
  while (c.i < c.n && depth > 0) {
    const b = c.data[c.i]!;
    if (b === 0x5c) {
      c.i += 1;
      if (c.i >= c.n) break;
      const e = c.data[c.i]!;
      if (e === 0x6e) {
        out.push(10);
        c.i += 1;
      } else if (e === 0x72) {
        out.push(13);
        c.i += 1;
      } else if (e === 0x74) {
        out.push(9);
        c.i += 1;
      } else if (e === 0x62) {
        out.push(8);
        c.i += 1;
      } else if (e === 0x66) {
        out.push(12);
        c.i += 1;
      } else if (e === 0x28 || e === 0x29 || e === 0x5c) {
        out.push(e);
        c.i += 1;
      } else if (e >= 0x30 && e <= 0x37) {
        let oct = 0;
        for (
          let k = 0;
          k < 3 && c.i < c.n && c.data[c.i]! >= 0x30 && c.data[c.i]! <= 0x37;
          k += 1
        ) {
          oct = oct * 8 + (c.data[c.i]! - 48);
          c.i += 1;
        }
        out.push(oct & 0xff);
      } else if (e === 13 || e === 10) {
        if (e === 13 && c.data[c.i + 1] === 10) c.i += 2;
        else c.i += 1;
      } else {
        out.push(e);
        c.i += 1;
      }
    } else if (b === 0x28) {
      depth += 1;
      out.push(b);
      c.i += 1;
    } else if (b === 0x29) {
      depth -= 1;
      if (depth > 0) out.push(b);
      c.i += 1;
    } else {
      out.push(b);
      c.i += 1;
    }
  }
  return Uint8Array.from(out);
}

function asciiSlice(data: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 1) s += String.fromCharCode(data[i]!);
  return s;
}

// ---------------------------------------------------------------------------
// Document load
// ---------------------------------------------------------------------------

function parsePdf(bytes: Uint8Array): PdfDocument {
  const objects = new Map<string, PdfValue>();
  const data = bytes;
  let i = 0;
  while (i < data.length) {
    if (isPdfObjStart(data, i)) {
      const numEnd = readDigits(data, i);
      let j = numEnd;
      while (j < data.length && isPdfWs(data[j]!)) j += 1;
      const genEnd = readDigits(data, j);
      if (genEnd > j) {
        let k = genEnd;
        while (k < data.length && isPdfWs(data[k]!)) k += 1;
        if (data[k] === 0x6f && data[k + 1] === 0x62 && data[k + 2] === 0x6a) {
          const num = Number(asciiSlice(data, i, numEnd));
          const gen = Number(asciiSlice(data, j, genEnd));
          k += 3;
          const bodyStart = k;
          const end = indexOfAscii(data, k, 'endobj');
          if (end < 0) {
            i = k + 1;
            continue;
          }
          try {
            objects.set(refKey(num, gen), parseObjectBody(data.subarray(bodyStart, end)));
          } catch {
            // Skip unreadable objects (producer quirks).
          }
          i = end + 6;
          continue;
        }
      }
    }
    i += 1;
  }

  const trailer = findTrailer(data) ?? { d: true, map: new Map() };
  const doc: PdfDocument = { bytes, objects, trailer, encrypted: false };
  expandObjectStreams(doc);
  const xrefTrailer = loadXrefTrailer(doc);
  if (xrefTrailer !== undefined) {
    for (const [k, v] of xrefTrailer.map) {
      if (!doc.trailer.map.has(k)) doc.trailer.map.set(k, v);
    }
  }
  doc.encrypted = doc.trailer.map.has('/Encrypt');
  return doc;
}

function isPdfObjStart(data: Uint8Array, i: number): boolean {
  if (data[i]! < 0x30 || data[i]! > 0x39) return false;
  if (i > 0 && !isPdfWs(data[i - 1]!) && data[i - 1] !== 0x0a && data[i - 1] !== 0x0d) {
    const prev = data[i - 1]!;
    if (prev !== 0x0a && prev !== 0x0d && !isPdfWs(prev)) return false;
  }
  return true;
}

function readDigits(data: Uint8Array, i: number): number {
  while (i < data.length && data[i]! >= 0x30 && data[i]! <= 0x39) i += 1;
  return i;
}

function indexOfAscii(data: Uint8Array, from: number, s: string): number {
  const first = s.charCodeAt(0);
  outer: for (let i = from; i + s.length <= data.length; i += 1) {
    if (data[i] !== first) continue;
    for (let k = 1; k < s.length; k += 1) {
      if (data[i + k] !== s.charCodeAt(k)) continue outer;
    }
    return i;
  }
  return -1;
}

function parseObjectBody(raw: Uint8Array): PdfValue {
  const c = new Cursor(raw);
  const val = parseValue(c);
  c.skipWs();
  const streamAt = indexOfAscii(raw, c.i, 'stream');
  if (streamAt >= 0 && isDict(val)) {
    let start = streamAt + 6;
    if (raw[start] === 13 && raw[start + 1] === 10) start += 2;
    else if (raw[start] === 10 || raw[start] === 13) start += 1;
    const end = indexOfAscii(raw, start, 'endstream');
    if (end >= 0) {
      val.stream = raw.subarray(start, end);
    }
  }
  return val;
}

function findTrailer(data: Uint8Array): PdfDict | undefined {
  const idx = lastIndexOfAscii(data, 'trailer');
  if (idx < 0) return undefined;
  try {
    const val = parseValue(new Cursor(data, idx + 7));
    return isDict(val) ? val : undefined;
  } catch {
    return undefined;
  }
}

function expandObjectStreams(doc: PdfDocument): void {
  const seen = new Set<string>();
  for (const [key, obj] of [...doc.objects.entries()]) {
    if (seen.has(key) || !isDict(obj)) continue;
    if (nameOf(obj.map.get('/Type')) !== '/ObjStm') continue;
    seen.add(key);
    expandOneObjStm(doc, obj);
  }
}

function expandOneObjStm(doc: PdfDocument, stm: PdfDict): void {
  const n = asNumber(deref(doc, stm.map.get('/N')));
  const first = asNumber(deref(doc, stm.map.get('/First')));
  if (n === undefined || first === undefined || n <= 0 || first < 0) return;
  const data = decodeStream(doc, stm);
  if (data.length === 0 || first > data.length) return;
  const header = new Cursor(data);
  const entries: { num: number; off: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    header.skipWs();
    if (header.i >= header.n) break;
    const num = parseNumberToken(header);
    header.skipWs();
    const off = parseNumberToken(header);
    if (!Number.isFinite(num) || !Number.isFinite(off)) break;
    entries.push({ num: Math.trunc(num), off: Math.trunc(off) });
  }
  for (const { num, off } of entries) {
    const start = first + off;
    if (start < 0 || start >= data.length) continue;
    const key = refKey(num, 0);
    if (doc.objects.has(key)) continue;
    try {
      doc.objects.set(key, parseValue(new Cursor(data, start)));
    } catch {
      // Producer quirks.
    }
  }
}

function loadXrefTrailer(doc: PdfDocument): PdfDict | undefined {
  const offset = findStartxref(doc.bytes);
  if (offset === undefined) return undefined;
  return parseXrefAt(doc, offset, new Set());
}

function findStartxref(data: Uint8Array): number | undefined {
  const idx = lastIndexOfAscii(data, 'startxref');
  if (idx < 0) return undefined;
  const c = new Cursor(data, idx + 9);
  c.skipWs();
  const off = parseNumberToken(c);
  if (!Number.isFinite(off) || off < 0) return undefined;
  return Math.trunc(off);
}

function parseXrefAt(doc: PdfDocument, offset: number, seen: Set<number>): PdfDict | undefined {
  if (seen.has(offset) || offset < 0 || offset >= doc.bytes.length) return undefined;
  seen.add(offset);
  const c = new Cursor(doc.bytes, offset);
  c.skipWs();
  if (startsWithAscii(doc.bytes.subarray(c.i), 'xref')) {
    const trailerAt = indexOfAscii(doc.bytes, c.i, 'trailer');
    if (trailerAt < 0) return undefined;
    try {
      const val = parseValue(new Cursor(doc.bytes, trailerAt + 7));
      if (!isDict(val)) return undefined;
      const prev = asNumber(val.map.get('/Prev'));
      if (prev !== undefined) parseXrefAt(doc, prev, seen);
      return val;
    } catch {
      return undefined;
    }
  }
  const obj = parseIndirectAt(doc.bytes, offset);
  if (obj === undefined || !isDict(obj.value)) return undefined;
  if (!doc.objects.has(refKey(obj.num, obj.gen))) {
    doc.objects.set(refKey(obj.num, obj.gen), obj.value);
  }
  if (nameOf(obj.value.map.get('/Type')) === '/XRef') {
    applyXrefStream(doc, obj.value);
  }
  const prev = asNumber(obj.value.map.get('/Prev'));
  if (prev !== undefined) parseXrefAt(doc, prev, seen);
  return obj.value;
}

function parseIndirectAt(
  data: Uint8Array,
  offset: number,
): { num: number; gen: number; value: PdfValue } | undefined {
  const c = new Cursor(data, offset);
  c.skipWs();
  if (c.i >= c.n || c.data[c.i]! < 0x30 || c.data[c.i]! > 0x39) return undefined;
  const num = parseNumberToken(c);
  c.skipWs();
  const gen = parseNumberToken(c);
  c.skipWs();
  if (c.data[c.i] !== 0x6f || c.data[c.i + 1] !== 0x62 || c.data[c.i + 2] !== 0x6a) {
    return undefined;
  }
  c.i += 3;
  const end = indexOfAscii(data, c.i, 'endobj');
  if (end < 0) return undefined;
  try {
    return {
      num: Math.trunc(num),
      gen: Math.trunc(gen),
      value: parseObjectBody(data.subarray(c.i, end)),
    };
  } catch {
    return undefined;
  }
}

function applyXrefStream(doc: PdfDocument, xref: PdfDict): void {
  const wVal = deref(doc, xref.map.get('/W'));
  if (!Array.isArray(wVal) || wVal.length < 3) return;
  const w = wVal.map((v) => (typeof v === 'number' && v >= 0 ? Math.trunc(v) : 0));
  const entrySize = (w[0] ?? 0) + (w[1] ?? 0) + (w[2] ?? 0);
  if (entrySize <= 0) return;
  const indexVal = deref(doc, xref.map.get('/Index'));
  const index: number[] = [];
  if (Array.isArray(indexVal)) {
    for (const v of indexVal) {
      if (typeof v === 'number') index.push(Math.trunc(v));
    }
  }
  if (index.length === 0) {
    const size = asNumber(deref(doc, xref.map.get('/Size'))) ?? 0;
    index.push(0, size);
  }
  const data = decodeStream(doc, xref);
  let pos = 0;
  const objstms = new Set<number>();
  for (let s = 0; s + 1 < index.length; s += 2) {
    const start = index[s]!;
    const count = index[s + 1]!;
    for (let i = 0; i < count; i += 1) {
      if (pos + entrySize > data.length) return;
      const type = w[0] === 0 ? 1 : readPacked(data, pos, w[0]!);
      const field2 = readPacked(data, pos + (w[0] ?? 0), w[1] ?? 0);
      const field3 = readPacked(data, pos + (w[0] ?? 0) + (w[1] ?? 0), w[2] ?? 0);
      pos += entrySize;
      const num = start + i;
      if (type === 1) {
        const key = refKey(num, field3);
        if (doc.objects.has(key)) continue;
        const parsed = parseIndirectAt(doc.bytes, field2);
        if (parsed !== undefined) doc.objects.set(key, parsed.value);
      } else if (type === 2) {
        objstms.add(field2);
      }
    }
  }
  for (const stmNum of objstms) {
    let stm = doc.objects.get(refKey(stmNum, 0));
    if (!isDict(stm)) {
      const parsed = [...doc.objects.values()].find(
        (o) => isDict(o) && nameOf(o.map.get('/Type')) === '/ObjStm',
      );
      stm = parsed;
    }
    if (isDict(stm)) expandOneObjStm(doc, stm);
  }
  expandObjectStreams(doc);
}

function readPacked(data: Uint8Array, at: number, width: number): number {
  let n = 0;
  for (let i = 0; i < width; i += 1) n = (n << 8) | (data[at + i] ?? 0);
  return n;
}

function lastIndexOfAscii(data: Uint8Array, s: string): number {
  const first = s.charCodeAt(0);
  outer: for (let i = data.length - s.length; i >= 0; i -= 1) {
    if (data[i] !== first) continue;
    for (let k = 1; k < s.length; k += 1) {
      if (data[i + k] !== s.charCodeAt(k)) continue outer;
    }
    return i;
  }
  return -1;
}

function deref(doc: PdfDocument, value: PdfValue | undefined, depth = 0): PdfValue | undefined {
  if (depth > 32 || value === undefined) return value;
  if (isRef(value)) {
    const next = doc.objects.get(refKey(value.num, value.gen));
    return deref(doc, next, depth + 1);
  }
  return value;
}

function dictGet(doc: PdfDocument, dict: PdfDict | undefined, key: string): PdfValue | undefined {
  if (!dict) return undefined;
  return deref(doc, dict.map.get(key));
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

function inflateOne(
  fn: typeof inflateZlib | typeof inflateRaw,
  data: Uint8Array,
  maxOut: number,
): Uint8Array {
  const out = fn(data, maxOut);
  if (out.length === 0) throw new Error('flate decode produced no output');
  return out;
}

function inflateCapped(data: Uint8Array, maxOut: number): Uint8Array {
  // PDF FlateDecode is zlib-wrapped; a few producers emit raw DEFLATE.
  try {
    return inflateOne(inflateZlib, data, maxOut);
  } catch {
    return inflateOne(inflateRaw, data, maxOut);
  }
}

function streamLength(doc: PdfDocument, dict: PdfDict): number | undefined {
  const len = deref(doc, dict.map.get('/Length'));
  return typeof len === 'number' && len >= 0 ? len : undefined;
}

function decodeStream(doc: PdfDocument, obj: PdfValue | undefined): Uint8Array {
  const resolved = deref(doc, obj);
  if (!isDict(resolved) || resolved.stream === undefined) return new Uint8Array();
  let data = resolved.stream;
  const declared = streamLength(doc, resolved);
  if (declared !== undefined && declared <= data.length) {
    data = data.subarray(0, declared);
  } else if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) {
    data = data.subarray(0, data.length - 2);
  } else if (data.length >= 1 && (data[data.length - 1] === 10 || data[data.length - 1] === 13)) {
    data = data.subarray(0, data.length - 1);
  }
  const filterVal = deref(doc, resolved.map.get('/Filter'));
  const filters: PdfValue[] = Array.isArray(filterVal)
    ? filterVal
    : filterVal !== undefined
      ? [filterVal]
      : [];
  for (const f of filters) {
    const name = nameOf(deref(doc, f));
    if (name === '/FlateDecode' || name === '/Fl') {
      try {
        data = inflateCapped(data, Number.MAX_SAFE_INTEGER);
      } catch {
        // Producer quirks: skip an unreadable stream rather than fail the file.
        return new Uint8Array();
      }
    } else if (name === '/ASCIIHexDecode' || name === '/AHx') {
      data = decodeAsciiHex(data);
    } else if (name === '/ASCII85Decode' || name === '/A85') {
      data = decodeAscii85(data);
    }
  }
  return applyPredictor(doc, resolved, data);
}

function applyPredictor(doc: PdfDocument, dict: PdfDict, data: Uint8Array): Uint8Array {
  const raw = deref(doc, dict.map.get('/DecodeParms')) ?? deref(doc, dict.map.get('/DP'));
  const parms = isDict(raw)
    ? raw
    : Array.isArray(raw)
      ? raw.find((v) => isDict(deref(doc, v)))
      : undefined;
  const dictParms = isDict(parms)
    ? parms
    : isDict(deref(doc, parms))
      ? (deref(doc, parms) as PdfDict)
      : undefined;
  if (!dictParms) return data;
  const predictor = asNumber(deref(doc, dictParms.map.get('/Predictor'))) ?? 1;
  if (predictor <= 1) return data;
  const columns = asNumber(deref(doc, dictParms.map.get('/Columns'))) ?? 1;
  const colors = asNumber(deref(doc, dictParms.map.get('/Colors'))) ?? 1;
  const bpc = asNumber(deref(doc, dictParms.map.get('/BitsPerComponent'))) ?? 8;
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  if (rowLen <= 0) return data;
  if (predictor === 2) return undoTiffPredictor(data, rowLen, colors);
  if (predictor >= 10 && predictor <= 15) return undoPngPredictor(data, rowLen);
  return data;
}

function undoTiffPredictor(data: Uint8Array, rowLen: number, colors: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const bpp = Math.max(1, colors);
  for (let row = 0; row * rowLen < data.length; row += 1) {
    const start = row * rowLen;
    const end = Math.min(start + rowLen, data.length);
    for (let i = start; i < end; i += 1) {
      const left = i - bpp >= start ? out[i - bpp]! : 0;
      out[i] = (data[i]! + left) & 0xff;
    }
  }
  return out;
}

function undoPngPredictor(data: Uint8Array, rowLen: number): Uint8Array {
  const stride = rowLen + 1;
  if (stride <= 1) return data;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * rowLen);
  let prev: Uint8Array | undefined;
  for (let r = 0; r < rows; r += 1) {
    const filter = data[r * stride]!;
    const src = data.subarray(r * stride + 1, r * stride + 1 + rowLen);
    const dest = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i += 1) {
      const raw = src[i] ?? 0;
      const a = i > 0 ? dest[i - 1]! : 0;
      const b = prev?.[i] ?? 0;
      const c = i > 0 ? (prev?.[i - 1] ?? 0) : 0;
      let recon = raw;
      if (filter === 1) recon = (raw + a) & 0xff;
      else if (filter === 2) recon = (raw + b) & 0xff;
      else if (filter === 3) recon = (raw + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (raw + paeth(a, b, c)) & 0xff;
      dest[i] = recon;
    }
    prev = dest;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeAsciiHex(data: Uint8Array): Uint8Array {
  const hex: number[] = [];
  for (const b of data) {
    if (b === 0x3e) break;
    if (!isPdfWs(b)) hex.push(b);
  }
  if (hex.length % 2 === 1) hex.push(0x30);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (fromHex(hex[i * 2]!) << 4) | fromHex(hex[i * 2 + 1]!);
  }
  return out;
}

function decodeAscii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  const tuple: number[] = [];
  const flush = (n: number): void => {
    let v = 0;
    for (let k = 0; k < n; k += 1) v = v * 85 + (tuple[k] ?? 84);
    for (let k = n; k < 5; k += 1) v = v * 85 + 84;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    for (let k = 0; k < n - 1; k += 1) out.push(bytes[k]!);
    tuple.length = 0;
  };
  while (i < data.length) {
    const b = data[i]!;
    if (b === 0x7e && data[i + 1] === 0x3e) break;
    if (isPdfWs(b)) {
      i += 1;
      continue;
    }
    if (b === 0x7a && tuple.length === 0) {
      out.push(0, 0, 0, 0);
      i += 1;
      continue;
    }
    if (b < 33 || b > 117) {
      i += 1;
      continue;
    }
    tuple.push(b - 33);
    if (tuple.length === 5) flush(5);
    i += 1;
  }
  if (tuple.length > 0) flush(tuple.length);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function collectPages(doc: PdfDocument): PdfDict[] {
  const root = deref(doc, doc.trailer.map.get('/Root'));
  if (!isDict(root)) {
    for (const obj of doc.objects.values()) {
      if (isDict(obj) && nameOf(obj.map.get('/Type')) === '/Catalog') {
        return walkPages(doc, deref(doc, obj.map.get('/Pages')), []);
      }
    }
    return [];
  }
  return walkPages(doc, deref(doc, root.map.get('/Pages')), []);
}

function walkPages(doc: PdfDocument, node: PdfValue | undefined, inherited: PdfDict[]): PdfDict[] {
  if (!isDict(node)) return [];
  const type = nameOf(dictGet(doc, node, '/Type'));
  const kids = dictGet(doc, node, '/Kids');
  if (type === '/Pages' || Array.isArray(kids)) {
    const nextInherited = node.map.has('/Resources') ? [...inherited, node] : inherited;
    const out: PdfDict[] = [];
    if (Array.isArray(kids)) {
      for (const k of kids) out.push(...walkPages(doc, deref(doc, k), nextInherited));
    }
    return out;
  }
  if (type === '/Page' || node.map.has('/Contents') || node.map.has('/MediaBox')) {
    if (!node.map.has('/Resources')) {
      for (let i = inherited.length - 1; i >= 0; i -= 1) {
        const res = inherited[i]!.map.get('/Resources');
        if (res !== undefined) {
          node.map.set('/Resources', res);
          break;
        }
      }
    }
    return [node];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Fonts / ToUnicode
// ---------------------------------------------------------------------------

interface FontInfo {
  name: string;
  bold: boolean;
  italic: boolean;
  widths: Map<number, number>;
  defaultWidth: number;
  /** ToUnicode: character code → Unicode. */
  cmap: Map<number, string>;
  /** Adobe collection: CID → Unicode. Kept separate from ToUnicode keys. */
  cidToUnicode: Map<number, string>;
  unitsScale: number;
  /** 1 for simple fonts; 2 for Type0 / Identity-H CID fonts. */
  codeByteLength: 1 | 2;
  isCid: boolean;
  /** PDF FontDescriptor /Flags bit 3 — custom encodings are common here. */
  symbolic: boolean;
  encodingCmap?: EncodingCmap;
  uniKind?: UniKind;
}

function isBoldFontName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('bold') ||
    lower.includes('-bd') ||
    lower.includes('_bd') ||
    lower.includes('black') ||
    lower.includes('heavy') ||
    lower.includes('demibold') ||
    lower.includes('semibold') ||
    lower.includes('demi-bold') ||
    lower.includes('semi-bold') ||
    lower.includes('extrabold') ||
    lower.includes('ultrabold')
  );
}

function isItalicFontName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('italic') ||
    lower.includes('oblique') ||
    lower.includes('-it') ||
    lower.includes('_it') ||
    lower.includes('slant') ||
    lower.includes('inclined') ||
    lower.includes('kursiv')
  );
}

function emptyFont(): FontInfo {
  return {
    name: 'F',
    bold: false,
    italic: false,
    widths: new Map(),
    defaultWidth: 500,
    cmap: new Map(),
    cidToUnicode: new Map(),
    unitsScale: 0.001,
    codeByteLength: 1,
    isCid: false,
    symbolic: false,
  };
}

function loadFont(doc: PdfDocument, obj: PdfValue | undefined): FontInfo {
  const d = deref(doc, obj);
  if (!isDict(d)) return emptyFont();
  const base = dictGet(doc, d, '/BaseFont') ?? dictGet(doc, d, '/Name');
  const name = typeof base === 'string' && base.startsWith('/') ? base.slice(1) : 'F';
  const desc = dictGet(doc, d, '/FontDescriptor');
  const flags = isDict(desc) ? (asNumber(desc.map.get('/Flags')) ?? 0) : 0;
  const italicAngle = isDict(desc) ? (asNumber(desc.map.get('/ItalicAngle')) ?? 0) : 0;
  const bold = isBoldFontName(name) || (flags & 0x40000) !== 0;
  const italic = isItalicFontName(name) || italicAngle !== 0 || (flags & 0x40) !== 0;
  const subtype = nameOf(dictGet(doc, d, '/Subtype'));
  const encVal = dictGet(doc, d, '/Encoding');
  const encodingName = nameOf(encVal);
  const isCid =
    subtype === '/Type0' || encodingName === '/Identity-H' || encodingName === '/Identity-V';

  const cmap = new Map<number, string>();
  const cidToUnicode = new Map<number, string>();
  let codeByteLength: 1 | 2 = isCid ? 2 : 1;
  const encCmap = isCid ? loadType0Encoding(doc, encVal, encodingName) : undefined;
  const uni = isCid && encodingName ? uniKind(encodingName) : undefined;
  if (!isCid) {
    applySimpleFontEncoding(doc, encVal, name, subtype, (flags & 0x4) !== 0, cmap);
  }
  const tu = d.map.get('/ToUnicode');
  if (tu !== undefined) {
    const parsed = parseToUnicode(decodeStream(doc, tu));
    for (const [k, v] of parsed.map) cmap.set(k, v);
    if (!encCmap && !uni) codeByteLength = parsed.codeByteLength;
  }

  const first = asNumber(dictGet(doc, d, '/FirstChar')) ?? 0;
  const widths = new Map<number, number>();
  const w = dictGet(doc, d, '/Widths');
  if (Array.isArray(w)) {
    for (let i = 0; i < w.length; i += 1) {
      const wd = w[i];
      if (typeof wd === 'number') widths.set(first + i, wd);
    }
  }

  let defaultWidth = isCid ? 1000 : 500;
  let cidFont: PdfDict | undefined;
  if (isCid) {
    const descendants = dictGet(doc, d, '/DescendantFonts');
    const resolved = Array.isArray(descendants)
      ? deref(doc, descendants[0])
      : descendants !== undefined
        ? deref(doc, descendants)
        : undefined;
    if (isDict(resolved)) {
      cidFont = resolved;
      const dw = asNumber(dictGet(doc, cidFont, '/DW'));
      if (dw !== undefined) defaultWidth = dw;
      const cidW = dictGet(doc, cidFont, '/W');
      if (Array.isArray(cidW)) parseCidWArray(cidW, widths);
    }
  }

  // Identity-H and simple fonts: CID/code ≈ GID. Legacy Encoding CMaps use
  // a different code space; do not merge the TrueType cmap into it.
  if (!encCmap && !uni) applyTrueTypeFallback(doc, d, cidFont, cmap, isCid);
  if (isCid) {
    applyAdobeCidFallback(doc, cidFont, encodingName, encCmap?.name, cidToUnicode);
  }
  normalizeCmapValues(cmap);
  normalizeCmapValues(cidToUnicode);
  if (
    isCid &&
    !encCmap &&
    !uni &&
    cmap.size > 0 &&
    codeByteLength === 1 &&
    [...cmap.keys()].some((k) => k > 255)
  ) {
    codeByteLength = 2;
  }

  let unitsScale = 0.001;
  if (subtype === '/Type3') {
    const fm = dictGet(doc, d, '/FontMatrix');
    if (Array.isArray(fm) && typeof fm[0] === 'number') unitsScale = fm[0];
  }
  const symbolic = (flags & 0x4) !== 0;
  return {
    name,
    bold,
    italic,
    widths,
    defaultWidth,
    cmap,
    cidToUnicode,
    unitsScale,
    codeByteLength,
    isCid,
    symbolic,
    encodingCmap: encCmap,
    uniKind: uni,
  };
}

function pdfText(v: PdfValue | undefined): string | undefined {
  if (typeof v === 'string') return v.startsWith('/') ? v.slice(1) : v;
  if (v instanceof Uint8Array) {
    let s = '';
    for (const b of v) s += String.fromCharCode(b);
    return s;
  }
  return undefined;
}

function applySimpleFontEncoding(
  doc: PdfDocument,
  encVal: PdfValue | undefined,
  baseFont: string,
  subtype: string | undefined,
  symbolic: boolean,
  cmap: Map<number, string>,
): void {
  let baseName = nameOf(encVal);
  let differences: PdfValue[] | undefined;
  const encDict = isDict(encVal)
    ? encVal
    : isDict(deref(doc, encVal))
      ? deref(doc, encVal)
      : undefined;
  if (isDict(encDict)) {
    baseName = nameOf(dictGet(doc, encDict, '/BaseEncoding'));
    const diffs = dictGet(doc, encDict, '/Differences');
    if (Array.isArray(diffs)) differences = diffs;
  }
  const lower = baseFont.toLowerCase();
  if (!baseName) {
    if (lower.includes('symbol') && !lower.includes('text')) baseName = '/SymbolEncoding';
    else if (lower.includes('zapfdingbats')) baseName = '/ZapfDingbatsEncoding';
    else if (!symbolic) baseName = subtype === '/Type1' ? '/StandardEncoding' : '/WinAnsiEncoding';
  }
  if (baseName) applyNamedEncoding(cmap, baseName);
  else if (differences && !symbolic) applyNamedEncoding(cmap, 'StandardEncoding');
  if (differences) applyDifferences(cmap, differences);
}

function loadType0Encoding(
  doc: PdfDocument,
  encVal: PdfValue | undefined,
  encodingName: string | undefined,
): EncodingCmap | undefined {
  if (encodingName === '/Identity-H' || encodingName === '/Identity-V') return undefined;
  if (encodingName) {
    const predefined = encodingCmap(encodingName);
    if (predefined) return predefined;
  }
  const streamSrc = isDict(encVal) ? encVal : undefined;
  if (streamSrc?.stream) {
    const text = latin1Decode(decodeStream(doc, streamSrc));
    const parsed = parseEmbeddedCmap(text);
    if (parsed) return parsed;
    const use = nameOf(dictGet(doc, streamSrc, '/UseCMap'));
    if (use) return encodingCmap(use);
  }
  return undefined;
}

function applyAdobeCidFallback(
  doc: PdfDocument,
  cidFont: PdfDict | undefined,
  encodingName: string | undefined,
  encCmapName: string | undefined,
  dest: Map<number, string>,
): void {
  let key: string | undefined;
  if (cidFont) {
    const info = dictGet(doc, cidFont, '/CIDSystemInfo');
    if (isDict(info)) {
      const registry = pdfText(dictGet(doc, info, '/Registry')) ?? '';
      const ordering = pdfText(dictGet(doc, info, '/Ordering')) ?? '';
      key = adobeOrderingKey(registry, ordering);
    }
  }
  if (!key && encodingName) key = inferAdobeOrdering(encodingName);
  if (!key && encCmapName) key = inferAdobeOrdering(encCmapName);
  if (key) fillAdobeCidMap(key, dest);
}

function normalizeCmapValues(cmap: Map<number, string>): void {
  for (const [code, text] of cmap) {
    const next = normalizeCjkText(text);
    if (next !== text) cmap.set(code, next);
  }
}

function applyTrueTypeFallback(
  doc: PdfDocument,
  font: PdfDict,
  cidFont: PdfDict | undefined,
  cmap: Map<number, string>,
  isCid: boolean,
): void {
  const own = dictGet(doc, font, '/FontDescriptor');
  const fromCid = cidFont ? dictGet(doc, cidFont, '/FontDescriptor') : undefined;
  const desc = isDict(own) ? own : isDict(fromCid) ? fromCid : undefined;
  if (!desc) return;
  const file =
    desc.map.get('/FontFile2') ?? desc.map.get('/FontFile3') ?? desc.map.get('/FontFile');
  if (file === undefined) return;
  const bytes = decodeStream(doc, file);
  if (bytes.length < 12) return;
  const fallback = cmapFromTrueType(bytes, isCid ? 'cid' : 'simple');
  if (!fallback || fallback.size === 0) return;
  if (cmap.size < 10 && fallback.size > cmap.size) {
    const merged = new Map(fallback);
    for (const [k, v] of cmap) merged.set(k, v);
    cmap.clear();
    for (const [k, v] of merged) cmap.set(k, v);
    return;
  }
  for (const [k, v] of fallback) {
    if (!cmap.has(k)) cmap.set(k, v);
  }
}

/** CIDFont `/W`: `[c [w1 w2 …]]` or `[c_first c_last w]`. */
function parseCidWArray(arr: PdfValue[], widths: Map<number, number>): void {
  let i = 0;
  while (i < arr.length) {
    const start = arr[i];
    if (typeof start !== 'number') {
      i += 1;
      continue;
    }
    i += 1;
    if (i >= arr.length) break;
    const next = arr[i];
    if (Array.isArray(next)) {
      for (let j = 0; j < next.length; j += 1) {
        const wd = next[j];
        if (typeof wd === 'number') widths.set(start + j, wd);
      }
      i += 1;
    } else if (typeof next === 'number') {
      const end = next;
      i += 1;
      if (i >= arr.length) break;
      const wd = arr[i];
      if (typeof wd === 'number') {
        for (let cid = start; cid <= end; cid += 1) widths.set(cid, wd);
      }
      i += 1;
    } else {
      i += 1;
    }
  }
}

function parseToUnicode(data: Uint8Array): { map: Map<number, string>; codeByteLength: 1 | 2 } {
  const text = latin1Decode(data);
  const map = new Map<number, string>();
  const srcHexLengths: number[] = [];

  let codespaceByteLen: number | undefined;
  const csStart = text.indexOf('begincodespacerange');
  if (csStart >= 0) {
    const csEnd = text.indexOf('endcodespacerange', csStart);
    if (csEnd >= 0) {
      const section = text.slice(csStart + 'begincodespacerange'.length, csEnd);
      for (const m of section.matchAll(/<([^>]*)>/g)) {
        const hex = m[1]!.replace(/[^0-9a-fA-F]/g, '');
        if (hex.length > 0) codespaceByteLen = Math.ceil(hex.length / 2);
      }
    }
  }

  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('beginbfchar', pos);
    if (start < 0) break;
    const end = text.indexOf('endbfchar', start);
    if (end < 0) break;
    parseBfPairs(text.slice(start + 11, end), map, srcHexLengths);
    pos = end + 9;
  }
  pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('beginbfrange', pos);
    if (start < 0) break;
    const end = text.indexOf('endbfrange', start);
    if (end < 0) break;
    parseBfRange(text.slice(start + 12, end), map, srcHexLengths);
    pos = end + 10;
  }

  let codeByteLength: 1 | 2;
  if (codespaceByteLen !== undefined) {
    // codespace is often <0000><FFFF> even when every entry is a 1-byte src.
    if (codespaceByteLen === 2 && srcHexLengths.length > 0 && srcHexLengths.every((l) => l <= 2)) {
      codeByteLength = 1;
    } else {
      codeByteLength = codespaceByteLen >= 2 ? 2 : 1;
    }
  } else if (srcHexLengths.length > 0) {
    codeByteLength = Math.max(...srcHexLengths) <= 2 ? 1 : 2;
  } else {
    codeByteLength = 2;
  }
  return { map, codeByteLength };
}

function parseBfPairs(section: string, map: Map<number, string>, srcHexLengths: number[]): void {
  const toks = [...section.matchAll(/<([^>]*)>/g)].map((m) => m[1]!);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const srcHex = toks[i]!.replace(/\s+/g, '');
    srcHexLengths.push(srcHex.length);
    const src = Number.parseInt(srcHex, 16);
    if (Number.isFinite(src)) map.set(src, hexToUnicode(toks[i + 1]!));
  }
}

function parseBfRange(section: string, map: Map<number, string>, srcHexLengths: number[]): void {
  const re = /<([^>]*)>\s*<([^>]*)>\s*(?:<([^>]*)>|\[((?:<[^>]*>\s*)+)\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const startHex = m[1]!.replace(/\s+/g, '');
    srcHexLengths.push(startHex.length);
    const start = Number.parseInt(startHex, 16);
    const end = Number.parseInt(m[2]!.replace(/\s+/g, ''), 16);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (m[3] !== undefined) {
      const base = hexToCodepoint(m[3]);
      if (base === undefined) continue;
      for (let cid = start; cid <= end; cid += 1) {
        map.set(cid, String.fromCodePoint(base + (cid - start)));
      }
    } else if (m[4] !== undefined) {
      const dests = [...m[4].matchAll(/<([^>]*)>/g)].map((x) => hexToUnicode(x[1]!));
      for (let i = 0; i < dests.length && start + i <= end; i += 1) {
        map.set(start + i, dests[i]!);
      }
    }
  }
}

function hexToCodepoint(h: string): number | undefined {
  const s = hexToUnicode(h);
  return s.codePointAt(0);
}

function hexToUnicode(h: string): string {
  const hex = h.replace(/[^0-9a-fA-F]/g, '');
  const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(Number.parseInt(padded.slice(i, i + 2), 16));
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    if (i + 1 >= bytes.length) break;
    const cp = (bytes[i]! << 8) | bytes[i + 1]!;
    i += 2;
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < bytes.length) {
      const lo = (bytes[i]! << 8) | bytes[i + 1]!;
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        i += 2;
        out += String.fromCodePoint(0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00));
        continue;
      }
    }
    if (cp !== 0) out += String.fromCharCode(cp);
  }
  return stripInvisibles(out);
}

function latin1Decode(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
}

function stripInvisibles(text: string): string {
  let out = '';
  for (const ch of text) {
    if (
      ch === '\u00ad' ||
      ch === '\u200b' ||
      ch === '\ufeff' ||
      ch === '\u200c' ||
      ch === '\u200d' ||
      ch === '\u2060'
    ) {
      continue;
    }
    out += ch;
  }
  return normalizeCjkText(out);
}

// ---------------------------------------------------------------------------
// Decode quality (mapped vs custom-encoding fallback)
// ---------------------------------------------------------------------------

interface DecodeStats {
  mapped: number;
  unmapped: number;
}

interface DecodedChar {
  ch: string;
  code: number;
  mapped: boolean;
}

function normalizeFontName(name: string): string {
  const plus = name.lastIndexOf('+');
  const bare = plus >= 0 ? name.slice(plus + 1) : name;
  return bare.toLowerCase().replace(/[\s_-]+/g, '');
}

function isCjkFontName(name: string): boolean {
  const n = normalizeFontName(name);
  return /simsun|nsimsun|simhei|simkai|simfang|fangsong|kaiti|heiti|songti|mingliu|pmingliu|msmincho|mspmincho|msgothic|mspgothic|meiryo|yugothic|yumincho|hiragino|gothicbbb|stsong|stheiti|stkaiti|stfangsong|stxihei|pingfang|heitisc|heititc|songtisc|songtitc|kaitisc|notosanscjk|notoserifcjk|sourcehan|wenquanyi|adobesong|adobehei|adobekai|adobefang|gbsn|gkai|hygothic|batang|dotum|gulim|malgun|nanum|applegothic|applemyungjo/.test(
    n,
  );
}

function isStandardLatinFont(name: string): boolean {
  const n = normalizeFontName(name);
  return /^(helvetica|times|timesnewroman|courier|couriernew|symbol|zapfdingbats|arial|calibri|cambria|georgia|verdana|tahoma|trebuchet|trebuchetms|consolas|menlo|monaco|comicsans|comicsansms|impact|palatino|garamond|bookman|minion|myriad|futura|gillsans|optima|baskerville|roboto|notosans|notoserif|opensans|lato|montserrat|inter|sourcesans|sourceserif|ubuntu|dejavu|liberation|freesans|freeserif|freemono|segoe|segoeui|candara|constantia|corbel|franklingothic)/.test(
    n,
  );
}

/** ASCII 32–126 fallback is only trusted for standard Latin encodings. */
function isSafeAsciiFallback(font: FontInfo, code: number): boolean {
  if (code < 32 || code > 126) return false;
  if (isCjkFontName(font.name)) return false;
  if (isStandardLatinFont(font.name)) return true;
  if (font.symbolic) return false;
  return true;
}

function isStatIgnored(ch: string, code: number): boolean {
  if (code === 0) return true;
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function countDecoded(stats: DecodeStats, decoded: DecodedChar[]): void {
  for (const { ch, code, mapped } of decoded) {
    if (isStatIgnored(ch, code)) continue;
    if (mapped && ch.length > 0) stats.mapped += 1;
    else stats.unmapped += 1;
  }
}

// ---------------------------------------------------------------------------
// Content stream extraction
// ---------------------------------------------------------------------------

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  fontSize: number;
  page: number;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikeout: boolean;
}

interface StrokeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  page: number;
}

interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

interface PageExtract {
  items: TextItem[];
  lines: StrokeLine[];
  rects: PdfRect[];
  images: PlacedImage[];
  stats: DecodeStats;
}

type Token = { k: 'v'; v: PdfValue } | { k: 'op'; v: string };

function tokenizeContent(data: Uint8Array): Token[] {
  const c = new Cursor(data);
  const tokens: Token[] = [];
  while (c.i < c.n) {
    c.skipWs();
    if (c.i >= c.n) break;
    const b = c.data[c.i]!;
    if (
      b === 0x5b ||
      b === 0x28 ||
      b === 0x3c ||
      b === 0x2f ||
      b === 0x2b ||
      b === 0x2d ||
      b === 0x2e ||
      (b >= 0x30 && b <= 0x39)
    ) {
      tokens.push({ k: 'v', v: parseValue(c) });
    } else {
      tokens.push({ k: 'op', v: parseKeyword(c) });
    }
  }
  return tokens;
}

function mulMat(a: number[], b: number[]): number[] {
  return [
    a[0]! * b[0]! + a[1]! * b[2]!,
    a[0]! * b[1]! + a[1]! * b[3]!,
    a[2]! * b[0]! + a[3]! * b[2]!,
    a[2]! * b[1]! + a[3]! * b[3]!,
    a[4]! * b[0]! + a[5]! * b[2]! + b[4]!,
    a[4]! * b[1]! + a[5]! * b[3]! + b[5]!,
  ];
}

function applyMat(m: number[], x: number, y: number): [number, number] {
  return [x * m[0]! + y * m[2]! + m[4]!, x * m[1]! + y * m[3]! + m[5]!];
}

/** Concatenate a text-space translation: T = [1 0 0 1 tx ty] × T. */
function translateTextMatrix(m: number[], tx: number, ty: number): number[] {
  return [
    m[0]!,
    m[1]!,
    m[2]!,
    m[3]!,
    m[4]! + tx * m[0]! + ty * m[2]!,
    m[5]! + tx * m[1]! + ty * m[3]!,
  ];
}

function matrixScale(m: number[]): number {
  return Math.max(Math.hypot(m[0]!, m[1]!), Math.hypot(m[2]!, m[3]!));
}

function pageAdvanceX(widthTs: number, textMat: number[], currentCtm: number[]): number {
  return Math.abs(widthTs * (textMat[0]! * currentCtm[0]! + textMat[1]! * currentCtm[2]!));
}

function loadPageFonts(doc: PdfDocument, page: PdfDict): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  const resources = dictGet(doc, page, '/Resources');
  if (!isDict(resources)) return fonts;
  const fontRes = dictGet(doc, resources, '/Font');
  if (!isDict(fontRes)) return fonts;
  for (const [key, val] of fontRes.map) {
    if (key.startsWith('/')) fonts.set(key, loadFont(doc, val));
  }
  return fonts;
}

function mapDecoded(
  font: FontInfo,
  code: number,
  cid: number,
  unicodePassthrough: boolean,
): DecodedChar {
  const fromCode = font.cmap.get(code);
  if (fromCode !== undefined) {
    return { ch: stripInvisibles(fromCode), code: cid || code, mapped: true };
  }
  // Uni* encodings put Unicode in the content stream. That number is not a CID.
  if (unicodePassthrough && code >= 0x20) {
    try {
      const ch = String.fromCodePoint(code);
      if (ch !== '\uFFFD' && (ch === '\t' || ch === '\n' || !/[\p{Cc}\p{Cf}]/u.test(ch))) {
        return { ch: stripInvisibles(ch), code: cid || code, mapped: true };
      }
    } catch {
      // Invalid code point.
    }
  }
  if (cid !== code) {
    const fromCidAsToUnicode = font.cmap.get(cid);
    if (fromCidAsToUnicode !== undefined) {
      return { ch: stripInvisibles(fromCidAsToUnicode), code: cid, mapped: true };
    }
  }
  const fromAdobe = font.cidToUnicode.get(cid);
  if (fromAdobe !== undefined) {
    return { ch: stripInvisibles(fromAdobe), code: cid, mapped: true };
  }
  if (code >= 32 && code < 127 && !font.isCid) {
    return {
      ch: String.fromCharCode(code),
      code,
      mapped: isSafeAsciiFallback(font, code),
    };
  }
  return { ch: '', code: cid || code, mapped: false };
}

function decodeOneByte(font: FontInfo, raw: Uint8Array): DecodedChar[] {
  const out: DecodedChar[] = [];
  for (const code of raw) {
    out.push(mapDecoded(font, code, code, false));
  }
  return out;
}

function decodeFontBytes(font: FontInfo, raw: Uint8Array): DecodedChar[] {
  if (font.uniKind) {
    const out: DecodedChar[] = [];
    let i = 0;
    while (i < raw.length) {
      const got = decodeUni(font.uniKind, raw, i);
      if (!got) break;
      out.push(mapDecoded(font, got.code, got.code, true));
      i += got.size;
    }
    return out;
  }

  if (font.encodingCmap) {
    const out: DecodedChar[] = [];
    let i = 0;
    while (i < raw.length) {
      const got = font.encodingCmap.decode(raw, i);
      if (!got) {
        out.push(mapDecoded(font, raw[i]!, raw[i]!, false));
        i += 1;
        continue;
      }
      out.push(mapDecoded(font, got.code, got.cid, false));
      i += got.size;
    }
    return out;
  }

  if (font.codeByteLength !== 2) return decodeOneByte(font, raw);

  // Odd-length strings sometimes mean the producer emitted 1-byte codes on a Type0 font.
  if (raw.length % 2 === 1 && font.cmap.size > 0) {
    const single = decodeOneByte(font, raw).filter((item) => item.ch.length > 0);
    if (single.length > 0) return single;
  }

  const out: DecodedChar[] = [];
  const passthrough = font.isCid && font.cmap.size === 0 && font.cidToUnicode.size === 0;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = ((raw[i]! << 8) | raw[i + 1]!) >>> 0;
    out.push(mapDecoded(font, code, code, passthrough));
  }
  return out;
}

function extractPage(
  doc: PdfDocument,
  page: PdfDict,
  pageNo: number,
  wantImages: boolean,
  imageCache: Map<string, PlacedImage | null>,
  startCtm: number[] = [1, 0, 0, 1, 0, 0],
  depth = 0,
): PageExtract {
  const fonts = loadPageFonts(doc, page);
  const contents = dictGet(doc, page, '/Contents');
  const streams: Uint8Array[] = [];
  if (Array.isArray(contents)) {
    for (const c of contents) streams.push(decodeStream(doc, c));
  } else if (contents !== undefined) {
    streams.push(decodeStream(doc, contents));
  }
  let total = 0;
  for (const s of streams) total += s.length;
  const data = new Uint8Array(total);
  let off = 0;
  for (const s of streams) {
    data.set(s, off);
    off += s.length;
  }

  const tokens = tokenizeContent(data);
  const items: TextItem[] = [];
  const lines: StrokeLine[] = [];
  const rects: PdfRect[] = [];
  const gs: { ctm: number[]; lw: number }[] = [];
  let ctm = startCtm.slice();
  let lineWidth = 1;
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let font: FontInfo | undefined;
  let fontSize = 12;
  let leading = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let hscale = 1;
  let rise = 0;
  let path: [number, number][] = [];
  let pathStart: [number, number] | undefined;
  let artifact = 0;
  const stats: DecodeStats = { mapped: 0, unmapped: 0 };
  const args: PdfValue[] = [];
  const pageResources = dictGet(doc, page, '/Resources');
  const xobjects = loadXObjects(doc, isDict(pageResources) ? pageResources : undefined);
  const formFonts = fonts;

  const emitText = (raw: Uint8Array): void => {
    if (!font || artifact > 0) return;
    const decoded = decodeFontBytes(font, raw);
    countDecoded(stats, decoded);
    const rendered = Math.abs(fontSize) * matrixScale(mulMat(tm, ctm));
    let buf = '';
    let startX: number | undefined;
    let startY = 0;
    let widthAcc = 0;
    const flush = (): void => {
      if (startX === undefined || buf.length === 0) {
        buf = '';
        widthAcc = 0;
        return;
      }
      items.push({
        text: buf,
        x: startX,
        y: startY,
        width: pageAdvanceX(widthAcc, tm, ctm),
        height: rendered,
        font: font!.name,
        fontSize: rendered,
        page: pageNo,
        isBold: font!.bold,
        isItalic: font!.italic,
        isUnderline: false,
        isStrikeout: false,
      });
      buf = '';
      widthAcc = 0;
      startX = undefined;
    };
    for (const { ch, code } of decoded) {
      let w = (font.widths.get(code) ?? font.defaultWidth) * font.unitsScale * fontSize;
      if (ch === ' ') w += wordSpace;
      w = (w + charSpace) * hscale;
      const trm = mulMat(tm, ctm);
      const [x, y] = applyMat(trm, 0, rise);
      if (startX === undefined) {
        startX = x;
        startY = y;
      }
      buf += ch;
      widthAcc += w;
      tm = translateTextMatrix(tm, w, 0);
    }
    flush();
  };

  const applyTjAdjust = (n: number): void => {
    if (!font) return;
    const dx = (-n / 1000) * fontSize * hscale;
    tm = translateTextMatrix(tm, dx, 0);
  };

  const lastNum = (n: number): number => {
    const v = args[args.length - n];
    return typeof v === 'number' ? v : 0;
  };

  for (const tok of tokens) {
    if (tok.k === 'v') {
      args.push(tok.v);
      continue;
    }
    const op = tok.v;
    if (op === 'q') {
      gs.push({ ctm: ctm.slice(), lw: lineWidth });
    } else if (op === 'Q') {
      const prev = gs.pop();
      if (prev) {
        ctm = prev.ctm;
        lineWidth = prev.lw;
      }
    } else if (op === 'cm' && args.length >= 6) {
      ctm = mulMat(
        args.slice(-6).map((a) => (typeof a === 'number' ? a : 0)),
        ctm,
      );
    } else if (op === 'w' && args.length >= 1) {
      lineWidth = lastNum(1);
    } else if (op === 'BT') {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
    } else if (op === 'Tf' && args.length >= 2) {
      const fname =
        typeof args[args.length - 2] === 'string' ? (args[args.length - 2] as string) : '';
      fontSize = lastNum(1);
      font = formFonts.get(fname);
    } else if (op === 'Td' && args.length >= 2) {
      tlm = translateTextMatrix(tlm, lastNum(2), lastNum(1));
      tm = tlm.slice();
    } else if (op === 'TD' && args.length >= 2) {
      const tx = lastNum(2);
      const ty = lastNum(1);
      leading = -ty;
      tlm = translateTextMatrix(tlm, tx, ty);
      tm = tlm.slice();
    } else if (op === 'Tm' && args.length >= 6) {
      tm = args.slice(-6).map((a) => (typeof a === 'number' ? a : 0));
      tlm = tm.slice();
    } else if (op === 'T*') {
      tlm = translateTextMatrix(tlm, 0, -leading);
      tm = tlm.slice();
    } else if (op === 'Tc' && args.length >= 1) {
      charSpace = lastNum(1);
    } else if (op === 'Tw' && args.length >= 1) {
      wordSpace = lastNum(1);
    } else if (op === 'Tz' && args.length >= 1) {
      hscale = lastNum(1) / 100;
    } else if (op === 'TL' && args.length >= 1) {
      leading = lastNum(1);
    } else if (op === 'Ts' && args.length >= 1) {
      rise = lastNum(1);
    } else if (op === 'Tj' || op === "'" || op === '"') {
      if (op === "'") {
        tlm = translateTextMatrix(tlm, 0, -leading);
        tm = tlm.slice();
      }
      const raw = args[args.length - 1];
      if (raw instanceof Uint8Array) emitText(raw);
    } else if (op === 'TJ') {
      const arr = args[args.length - 1];
      if (Array.isArray(arr)) {
        for (const el of arr) {
          if (el instanceof Uint8Array) emitText(el);
          else if (typeof el === 'number') applyTjAdjust(el);
        }
      }
    } else if (op === 'BMC') {
      if (nameOf(args[args.length - 1]) === '/Artifact') artifact += 1;
    } else if (op === 'BDC') {
      const tag = args.length >= 2 ? args[args.length - 2] : args[args.length - 1];
      if (nameOf(tag) === '/Artifact') artifact += 1;
    } else if (op === 'EMC') {
      if (artifact > 0) artifact -= 1;
    } else if (op === 'm' && args.length >= 2) {
      const p = applyMat(ctm, lastNum(2), lastNum(1));
      path = [p];
      pathStart = p;
    } else if (op === 'l' && args.length >= 2) {
      path.push(applyMat(ctm, lastNum(2), lastNum(1)));
    } else if (op === 're' && args.length >= 4) {
      const x = lastNum(4);
      const y = lastNum(3);
      const w = lastNum(2);
      const h = lastNum(1);
      const p0 = applyMat(ctm, x, y);
      const p1 = applyMat(ctm, x + w, y);
      const p2 = applyMat(ctm, x + w, y + h);
      const p3 = applyMat(ctm, x, y + h);
      path = [p0, p1, p2, p3, p0];
      pathStart = p0;
      if (artifact === 0) {
        const xs = [p0[0], p1[0], p2[0], p3[0]];
        const ys = [p0[1], p1[1], p2[1], p3[1]];
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        rects.push({
          x: minX,
          y: minY,
          width: Math.max(...xs) - minX,
          height: Math.max(...ys) - minY,
          page: pageNo,
        });
      }
    } else if (op === 'h') {
      if (pathStart) path.push(pathStart);
    } else if (op === 'S' || op === 's') {
      if (op === 's' && pathStart) path.push(pathStart);
      if (artifact === 0) {
        for (let i = 1; i < path.length; i += 1) {
          const a = path[i - 1]!;
          const b = path[i]!;
          lines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], page: pageNo });
        }
        const filled = pathAsRect(path, pageNo);
        if (filled) rects.push(filled);
      }
      path = [];
    } else if (op === 'Do' && artifact === 0) {
      const name =
        typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : '';
      const xobj = xobjects.get(name);
      if (xobj !== undefined) {
        extractFormText(
          doc,
          xobj.dict,
          pageResources,
          ctm,
          pageNo,
          items,
          lines,
          rects,
          stats,
          depth,
        );
      }
    } else if (
      op === 'n' ||
      op === 'f' ||
      op === 'F' ||
      op === 'f*' ||
      op === 'B' ||
      op === 'B*' ||
      op === 'b' ||
      op === 'b*'
    ) {
      if (op !== 'n' && artifact === 0) {
        if (op === 'b' || op === 'b*') {
          if (pathStart) path.push(pathStart);
        }
        const filled = pathAsRect(path, pageNo);
        if (filled) rects.push(filled);
        if (op === 'B' || op === 'B*' || op === 'b' || op === 'b*') {
          for (let i = 1; i < path.length; i += 1) {
            const a = path[i - 1]!;
            const b = path[i]!;
            lines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], page: pageNo });
          }
        }
      }
      path = [];
    }
    args.length = 0;
  }

  const images: PlacedImage[] = [];
  if (wantImages) {
    collectImages(
      doc,
      tokens,
      dictGet(doc, page, '/Resources'),
      [1, 0, 0, 1, 0, 0],
      pageNo,
      imageCache,
      images,
      0,
    );
  }

  markDecorations(items, lines, collectHttpLinkRects(doc, page));
  return { items, lines, rects, images, stats };
}

function extractFormText(
  doc: PdfDocument,
  form: PdfDict,
  parentResources: PdfValue | undefined,
  ctm: number[],
  pageNo: number,
  items: TextItem[],
  lines: StrokeLine[],
  rects: PdfRect[],
  stats: DecodeStats,
  depth: number,
): void {
  if (depth >= 8) return;
  if (nameOf(dictGet(doc, form, '/Subtype')) !== '/Form') return;
  const formRes = dictGet(doc, form, '/Resources') ?? parentResources;
  const matrix = dictGet(doc, form, '/Matrix');
  let nextCtm = ctm.slice();
  if (Array.isArray(matrix) && matrix.length >= 6) {
    nextCtm = mulMat(
      matrix.map((a) => (typeof a === 'number' ? a : 0)),
      ctm,
    );
  }
  const fake: PdfDict = { d: true, map: new Map() };
  fake.map.set('/Type', '/Page');
  fake.map.set('/Contents', form);
  if (formRes !== undefined) fake.map.set('/Resources', formRes);
  const extracted = extractPage(doc, fake, pageNo, false, new Map(), nextCtm, depth + 1);
  items.push(...extracted.items);
  lines.push(...extracted.lines);
  rects.push(...extracted.rects);
  stats.mapped += extracted.stats.mapped;
  stats.unmapped += extracted.stats.unmapped;
}

function collectImages(
  doc: PdfDocument,
  tokens: Token[],
  resources: PdfValue | undefined,
  startCtm: number[],
  pageNo: number,
  cache: Map<string, PlacedImage | null>,
  out: PlacedImage[],
  depth: number,
): void {
  if (depth > 8) return;
  const xobjects = loadXObjects(doc, isDict(resources) ? resources : undefined);
  const gs: number[][] = [];
  let ctm = startCtm.slice();
  let artifact = 0;
  const args: PdfValue[] = [];

  for (const tok of tokens) {
    if (tok.k === 'v') {
      args.push(tok.v);
      continue;
    }
    const op = tok.v;
    if (op === 'q') {
      gs.push(ctm.slice());
    } else if (op === 'Q') {
      const prev = gs.pop();
      if (prev) ctm = prev;
    } else if (op === 'cm' && args.length >= 6) {
      ctm = mulMat(
        args.slice(-6).map((a) => (typeof a === 'number' ? a : 0)),
        ctm,
      );
    } else if (op === 'BMC') {
      if (nameOf(args[args.length - 1]) === '/Artifact') artifact += 1;
    } else if (op === 'BDC') {
      const tag = args.length >= 2 ? args[args.length - 2] : args[args.length - 1];
      if (nameOf(tag) === '/Artifact') artifact += 1;
    } else if (op === 'EMC') {
      if (artifact > 0) artifact -= 1;
    } else if (op === 'Do' && artifact === 0) {
      const name =
        typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : '';
      const xobj = xobjects.get(name);
      if (xobj) {
        placeXObject(doc, xobj, resources, ctm, pageNo, cache, out, depth);
      }
    }
    args.length = 0;
  }
}

type LoadedXObject = { key: string; dict: PdfDict };

function loadXObjects(
  doc: PdfDocument,
  resources: PdfDict | undefined,
): Map<string, LoadedXObject> {
  const out = new Map<string, LoadedXObject>();
  if (!resources) return out;
  const rawRes = resources.map.get('/XObject');
  const xobj = deref(doc, rawRes);
  if (!isDict(xobj)) return out;
  for (const [key, val] of xobj.map) {
    if (!key.startsWith('/')) continue;
    const dict = deref(doc, val);
    if (!isDict(dict)) continue;
    const id = isRef(val) ? refKey(val.num, val.gen) : `inline:${key}`;
    out.set(key, { key: id, dict });
  }
  return out;
}

function placeXObject(
  doc: PdfDocument,
  xobj: LoadedXObject,
  parentResources: PdfValue | undefined,
  ctm: number[],
  pageNo: number,
  cache: Map<string, PlacedImage | null>,
  out: PlacedImage[],
  depth: number,
): void {
  const subtype = nameOf(dictGet(doc, xobj.dict, '/Subtype'));
  if (subtype === '/Form') {
    const formRes = dictGet(doc, xobj.dict, '/Resources') ?? parentResources;
    const matrix = dictGet(doc, xobj.dict, '/Matrix');
    let nextCtm = ctm;
    if (Array.isArray(matrix) && matrix.length >= 6) {
      nextCtm = mulMat(
        matrix.map((a) => (typeof a === 'number' ? a : 0)),
        ctm,
      );
    }
    const data = decodeStream(doc, xobj.dict);
    collectImages(doc, tokenizeContent(data), formRes, nextCtm, pageNo, cache, out, depth + 1);
    return;
  }
  if (subtype !== '/Image' && subtype !== undefined) return;

  if (cache.has(xobj.key)) {
    const cached = cache.get(xobj.key);
    if (cached) out.push({ ...cached, page: pageNo, x: imageOrigin(ctm).x, y: imageOrigin(ctm).y });
    return;
  }

  const extracted = decodeXObjectImage(doc, xobj.dict);
  if (!extracted) {
    cache.set(xobj.key, null);
    return;
  }
  const origin = imageOrigin(ctm);
  const placed: PlacedImage = {
    key: xobj.key,
    page: pageNo,
    x: origin.x,
    y: origin.y,
    bytes: extracted.bytes,
    mime: extracted.mime,
  };
  cache.set(xobj.key, placed);
  out.push(placed);
}

function imageOrigin(ctm: number[]): { x: number; y: number } {
  const a = applyMat(ctm, 0, 0);
  const b = applyMat(ctm, 1, 1);
  return { x: Math.min(a[0], b[0]), y: Math.max(a[1], b[1]) };
}

function decodeXObjectImage(
  doc: PdfDocument,
  dict: PdfDict,
): { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' } | undefined {
  const filterVal = deref(doc, dict.map.get('/Filter'));
  const filters = (
    Array.isArray(filterVal) ? filterVal : filterVal !== undefined ? [filterVal] : []
  )
    .map((f) => nameOf(deref(doc, f)))
    .filter((n): n is string => n !== undefined);
  const csVal = dictGet(doc, dict, '/ColorSpace');
  let colorSpace = nameOf(csVal);
  let indexedPalette: Uint8Array | undefined;
  if (Array.isArray(csVal) && nameOf(csVal[0]) === '/Indexed') {
    colorSpace = '/Indexed';
    const pal = deref(doc, csVal[2]);
    if (pal instanceof Uint8Array) indexedPalette = pal;
    else if (isDict(pal) && pal.stream) indexedPalette = decodeStream(doc, pal);
  }
  return xObjectToImage({
    width: asNumber(dictGet(doc, dict, '/Width')) ?? 0,
    height: asNumber(dictGet(doc, dict, '/Height')) ?? 0,
    colorSpace,
    bitsPerComponent: asNumber(dictGet(doc, dict, '/BitsPerComponent')) ?? 8,
    filters,
    data: decodeStream(doc, dict),
    indexedPalette,
  });
}

function pathAsRect(path: [number, number][], page: number): PdfRect | undefined {
  if (path.length < 4) return undefined;
  const xs = path.map((p) => p[0]);
  const ys = path.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.2 || height < 0.2) return undefined;
  const onBox = path.every(
    ([x, y]) =>
      Math.abs(x - minX) <= 1 ||
      Math.abs(x - maxX) <= 1 ||
      Math.abs(y - minY) <= 1 ||
      Math.abs(y - maxY) <= 1,
  );
  if (!onBox) return undefined;
  return { x: minX, y: minY, width, height, page };
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function collectHttpLinkRects(doc: PdfDocument, page: PdfDict): Rect[] {
  const annots = dictGet(doc, page, '/Annots');
  if (!Array.isArray(annots)) return [];
  const rects: Rect[] = [];
  for (const a of annots) {
    const ad = deref(doc, a);
    if (!isDict(ad) || nameOf(dictGet(doc, ad, '/Subtype')) !== '/Link') continue;
    const action = dictGet(doc, ad, '/A');
    let uri: string | undefined;
    if (isDict(action)) {
      const u = dictGet(doc, action, '/URI');
      if (u instanceof Uint8Array) uri = latin1Decode(u);
      else if (typeof u === 'string') uri = u;
    }
    // http(s) link text is left undecorated; internal/relative
    // links keep the drawn underline as `<u>`.
    if (!uri || !/^https?:/i.test(uri)) continue;
    const rect = dictGet(doc, ad, '/Rect');
    if (Array.isArray(rect) && rect.length >= 4) {
      const x1 = typeof rect[0] === 'number' ? rect[0] : 0;
      const y1 = typeof rect[1] === 'number' ? rect[1] : 0;
      const x2 = typeof rect[2] === 'number' ? rect[2] : 0;
      const y2 = typeof rect[3] === 'number' ? rect[3] : 0;
      rects.push({
        x1: Math.min(x1, x2),
        y1: Math.min(y1, y2),
        x2: Math.max(x1, x2),
        y2: Math.max(y1, y2),
      });
    }
  }
  return rects;
}

function itemHitsHttpLink(item: TextItem, rects: Rect[]): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return rects.some((r) => cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2);
}

function markDecorations(items: TextItem[], lines: StrokeLine[], httpRects: Rect[]): void {
  const rules: { x1: number; x2: number; y: number }[] = [];
  for (const l of lines) {
    if (Math.abs(l.y1 - l.y2) > 2) continue;
    const x1 = Math.min(l.x1, l.x2);
    const x2 = Math.max(l.x1, l.x2);
    if (x2 - x1 <= 1) continue;
    rules.push({ x1, x2, y: (l.y1 + l.y2) / 2 });
  }
  for (const item of items) {
    if (item.text.trim().length === 0 || item.width <= 0) continue;
    const skipHttp = itemHitsHttpLink(item, httpRects);
    for (const rule of rules) {
      const overlap = Math.min(item.x + item.width, rule.x2) - Math.max(item.x, rule.x1);
      if (overlap < item.width * 0.6) continue;
      const below = Math.max(item.fontSize * 0.72, 3);
      if (!skipHttp && rule.y >= item.y - below && rule.y <= item.y + 1) {
        item.isUnderline = true;
      }
      const sMin = item.y + item.fontSize * 0.12;
      const sMax = item.y + item.fontSize * 0.55;
      if (rule.y >= sMin && rule.y <= sMax) item.isStrikeout = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Fake-bold / text-shadow: Chrome print and CJK CSS often draw the same
// glyph twice (or 4–7 times) within a fraction of an em.
// ---------------------------------------------------------------------------

function dedupeOverlappingItems(items: TextItem[]): TextItem[] {
  if (items.length < 2) return items;
  const out: TextItem[] = [];
  const buckets = new Map<string, TextItem[]>();
  for (const item of items) {
    if (item.text.length === 0) {
      out.push(item);
      continue;
    }
    const tol = Math.max(1.5, item.fontSize * 0.2);
    const gx = Math.round(item.x / 2);
    const gy = Math.round(item.y / 2);
    let dup = false;
    for (let dx = -1; dx <= 1 && !dup; dx += 1) {
      for (let dy = -1; dy <= 1 && !dup; dy += 1) {
        const cell = buckets.get(`${item.page}:${gx + dx}:${gy + dy}`);
        if (!cell) continue;
        for (const prev of cell) {
          if (
            prev.text === item.text &&
            Math.abs(prev.x - item.x) <= tol &&
            Math.abs(prev.y - item.y) <= tol
          ) {
            dup = true;
            break;
          }
        }
      }
    }
    if (dup) continue;
    out.push(item);
    const key = `${item.page}:${gx}:${gy}`;
    const cell = buckets.get(key);
    if (cell) cell.push(item);
    else buckets.set(key, [item]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Superscript merge
// ---------------------------------------------------------------------------

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function mergeScriptItems(items: TextItem[]): TextItem[] {
  if (items.length < 2) return items;
  const groups: TextItem[][] = [];
  for (const item of items) {
    const found = groups.find((g) => g[0]!.page === item.page && Math.abs(g[0]!.y - item.y) < 5);
    if (found) found.push(item);
    else groups.push([item]);
  }
  const result: TextItem[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    const maxFs = group.reduce((m, it) => Math.max(m, it.fontSize), 0);
    if (maxFs < 1) {
      result.push(...group);
      continue;
    }
    const subTh = maxFs * 0.75;
    const merged: TextItem[] = [];
    for (const item of group) {
      const parent = merged[merged.length - 1];
      if (
        parent &&
        item.fontSize < subTh &&
        item.fontSize > 0 &&
        item.text.length <= 4 &&
        [...item.text].every((c) => c >= '0' && c <= '9')
      ) {
        const last = parent.text.at(-1);
        if (parent.fontSize >= subTh && last !== undefined && /\p{L}/u.test(last)) {
          const gap = item.x - (parent.x + parent.width);
          if (gap < parent.fontSize * 0.2 && gap > -parent.fontSize * 0.3) {
            const raised = item.y > parent.y + parent.fontSize * 0.1;
            const table = raised ? SUP : SUB;
            parent.text += [...item.text].map((c) => table[Number(c)]!).join('');
            parent.width = item.x + item.width - parent.x;
            continue;
          }
        }
      }
      merged.push(item);
    }
    result.push(...merged);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Line grouping + markdown
// ---------------------------------------------------------------------------

function shouldJoinItems(prev: TextItem, curr: TextItem): boolean {
  if (prev.text.endsWith(' ') || curr.text.startsWith(' ')) return false;
  const currFirst = [...curr.text.trimStart()][0];
  if (currFirst !== undefined && ".,;!?)]}'".includes(currFirst)) return true;
  const prevLast = [...prev.text.trimEnd()].at(-1);
  if (prevLast === ':' && currFirst !== undefined && /[\p{L}\p{N}]/u.test(currFirst)) return false;
  if (prev.width > 0) {
    const gap = curr.x - (prev.x + prev.width);
    const fs = prev.fontSize;
    if (gap > fs * 3 || gap < -fs) return false;
    return gap < fs * 0.12;
  }
  return false;
}

function needsSpace(prev: TextItem, curr: TextItem, result: string): boolean {
  if (result.endsWith('-') || curr.text.startsWith('-') || curr.text.trim() === '-') return false;
  const fontRatio = prev.fontSize > 0 ? curr.fontSize / prev.fontSize : 1;
  const reverse = curr.fontSize > 0 ? prev.fontSize / curr.fontSize : 1;
  const yDiff = Math.abs(curr.y - prev.y);
  if (fontRatio < 0.85 && yDiff > 1) return false;
  if (reverse < 0.85 && yDiff > 1) return false;
  if (shouldJoinItems(prev, curr)) return false;
  if (result.endsWith(' ') || curr.text.startsWith(' ')) return false;
  return true;
}

function formatLine(items: TextItem[], bold: boolean, italic: boolean, deco: boolean): string {
  let result = '';
  let curBold = false;
  let curItalic = false;
  let curUnder = false;
  let curStrike = false;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const trimmed = item.text.trim();
    if (trimmed.length === 0) continue;
    const strike = deco && item.isStrikeout;
    const under = deco && item.isUnderline && !strike;
    const itemBold = bold && item.isBold && !under && !strike;
    const itemItalic = italic && item.isItalic && !under && !strike;
    if (curItalic && !itemItalic) {
      result += '*';
      curItalic = false;
    }
    if (curBold && !itemBold) {
      result += '**';
      curBold = false;
    }
    if (curUnder && !under) {
      result += '</u>';
      curUnder = false;
    }
    if (curStrike && !strike) {
      result += '</s>';
      curStrike = false;
    }
    if (i > 0 && result.length > 0) {
      const prev = items[i - 1]!;
      if (needsSpace(prev, item, result) || (item.text.startsWith(' ') && !result.endsWith(' '))) {
        result += ' ';
      }
    }
    if (under && !curUnder) {
      result += '<u>';
      curUnder = true;
    }
    if (strike && !curStrike) {
      result += '<s>';
      curStrike = true;
    }
    if (itemBold && !curBold) {
      result += '**';
      curBold = true;
    }
    if (itemItalic && !curItalic) {
      result += '*';
      curItalic = true;
    }
    result += trimmed;
  }
  if (curItalic) result += '*';
  if (curBold) result += '**';
  if (curUnder) result += '</u>';
  if (curStrike) result += '</s>';
  return result;
}

function isListItem(text: string): boolean {
  const t = text.trimStart();
  if (
    t.startsWith('• ') ||
    t.startsWith('- ') ||
    t.startsWith('* ') ||
    t.startsWith('○ ') ||
    t.startsWith('● ') ||
    t.startsWith('◦ ')
  ) {
    return true;
  }
  const first = [...t].slice(0, 5).join('');
  if ([...first].some((c) => c >= '0' && c <= '9')) {
    const dot = first.search(/[.)]/);
    if (dot > 0 && [...first.slice(0, dot)].every((c) => c >= '0' && c <= '9')) return true;
  }
  const chars = [...t];
  if (chars.length >= 2 && /[A-Za-z]/.test(chars[0]!) && (chars[1] === '.' || chars[1] === ')')) {
    return true;
  }
  return false;
}

interface FlowBlock {
  kind: 'line' | 'table' | 'image';
  page: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
  items?: TextItem[];
  markdown?: string;
}

function itemsToMarkdown(
  items: TextItem[],
  strokeLines: StrokeLine[],
  pageRects: PdfRect[],
  imageBlocks: MarkdownBlock[] = [],
): string {
  const tables = detectTables(items, strokeLines, pageRects);
  const claimed = new Set<number>();
  for (const table of tables) {
    for (const idx of table.itemIndices) claimed.add(idx);
  }
  const remaining = items.filter((_, i) => !claimed.has(i));
  const rawLines = groupIntoLines(remaining);
  const flow: FlowBlock[] = [
    ...rawLines.map((line) => {
      const box = lineBox(line);
      return { kind: 'line' as const, page: line[0]!.page, ...box, items: line };
    }),
    ...tables.map((t) => ({
      kind: 'table' as const,
      page: t.page,
      x: t.x,
      y: t.y,
      x2: t.x2,
      y2: t.y2,
      markdown: t.markdown,
    })),
    ...imageBlocks.map((b) => ({
      kind: 'image' as const,
      page: b.page,
      x: b.x,
      y: b.y,
      x2: b.x + 1,
      y2: b.y - 1,
      markdown: b.markdown,
    })),
  ];
  const byPage = new Map<number, FlowBlock[]>();
  for (const block of flow) {
    const list = byPage.get(block.page) ?? [];
    list.push(block);
    byPage.set(block.page, list);
  }
  const ordered: FlowBlock[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    ordered.push(...orderBoxes(byPage.get(page)!));
  }
  const lines = ordered.filter((b) => b.kind === 'line').map((b) => b.items!);
  if (lines.length === 0 && tables.length === 0 && imageBlocks.length === 0) return '';
  if (lines.length === 0) {
    return `${ordered
      .map((b) => b.markdown?.trimEnd() ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n')}\n`;
  }

  const sizeCounts = new Map<number, number>();
  for (const line of lines) {
    const fs = line[0]!.fontSize;
    if (fs >= 9) {
      const key = Math.round(fs * 10);
      sizeCounts.set(key, (sizeCounts.get(key) ?? 0) + 1);
    }
  }
  let base = 12;
  if (sizeCounts.size > 0) {
    let bestKey = 120;
    let bestCount = -1;
    for (const [key, count] of sizeCounts) {
      if (count > bestCount || (count === bestCount && key < bestKey)) {
        bestCount = count;
        bestKey = key;
      }
    }
    base = bestKey / 10;
  }

  const tiers: number[] = [];
  for (const line of lines) {
    const fs = line[0]!.fontSize;
    if (fs / base < 1.2) continue;
    const text = line
      .map((it) => it.text)
      .join('')
      .trim();
    if (!text || ![...text].some((c) => /\p{L}/u.test(c))) continue;
    if (!tiers.some((t) => Math.abs(t - fs) < 0.5)) tiers.push(fs);
  }
  tiers.sort((a, b) => b - a);
  tiers.length = Math.min(tiers.length, 4);

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1]![0]!;
    const cur = lines[i]![0]!;
    if (prev.page !== cur.page) continue;
    const g = prev.y - cur.y;
    if (g > 0 && g < base * 10) gaps.push(g);
  }
  let paraTh = base * 1.8;
  if (gaps.length >= 5) {
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    paraTh = Math.max(median * 1.3, base * 1.5);
  }

  const isolated = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const plain = line
      .map((it) => it.text)
      .join('')
      .trim();
    const wc = plain.split(/\s+/).filter(Boolean).length;
    if (wc < 1 || wc > 6 || plain.length <= 3) continue;
    if (line[0]!.fontSize < base * 0.95) continue;
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const before = !prev || prev[0]!.page !== line[0]!.page || prev[0]!.y - line[0]!.y > paraTh;
    const after = !next || next[0]!.page !== line[0]!.page || line[0]!.y - next[0]!.y > paraTh;
    if (before && after) isolated.add(i);
  }

  const headerLevel = (i: number, line: TextItem[], plain: string): number | undefined => {
    if (plain.length <= 3 || plain.split(/\s+/).filter(Boolean).length > 15) return undefined;
    const fs = line[0]!.fontSize;
    const ratio = fs / base;
    if (ratio >= 1.2) {
      for (let t = 0; t < tiers.length; t += 1) {
        if (Math.abs(fs - tiers[t]!) < 0.5) return t + 1;
      }
    }
    if (isolated.has(i)) return Math.min(tiers.length + 1, 3) || 2;
    return undefined;
  };

  let out = '';
  let inPara = false;
  let inList = false;
  let prevY = Number.POSITIVE_INFINITY;
  let prevPage = 0;
  let lastListX: number | undefined;
  let lineIndex = 0;

  const emitBreak = (): void => {
    if (inPara) {
      out += '\n\n';
      inPara = false;
    }
    inList = false;
    lastListX = undefined;
  };

  for (const block of ordered) {
    if (block.kind !== 'line') {
      emitBreak();
      const md = block.markdown?.trimEnd() ?? '';
      if (md.length > 0) out += `${md}\n\n`;
      prevY = block.y2;
      prevPage = block.page;
      continue;
    }

    const line = block.items!;
    const page = line[0]!.page;
    const y = line[0]!.y;
    if (page !== prevPage) {
      prevY = Number.POSITIVE_INFINITY;
      prevPage = page;
      inList = false;
    }
    const yGap = prevY - y;
    if (inPara && (yGap > paraTh || yGap < -base * 0.8)) {
      out += '\n\n';
      inPara = false;
    }
    prevY = y;

    const formatted = formatLine(line, true, true, true);
    const trimmed = formatted.trim();
    const plain = line
      .map((it) => it.text)
      .join('')
      .trim();
    const i = lineIndex;
    lineIndex += 1;
    if (trimmed.length === 0) continue;

    const lvl = headerLevel(i, line, plain);
    if (lvl !== undefined) {
      if (inPara) out += '\n\n';
      out += `${'#'.repeat(lvl)} ${plain}\n\n`;
      inPara = false;
      inList = false;
      continue;
    }

    if (isListItem(plain)) {
      if (inPara) {
        out += '\n\n';
        inPara = false;
      }
      out += `${trimmed}\n`;
      inList = true;
      lastListX = line[0]!.x;
      continue;
    }
    if (inList) {
      const currX = line[0]!.x;
      const xOk = lastListX !== undefined && currX >= lastListX - 5 && currX <= lastListX + 50;
      if (xOk && yGap < base * 7 && !isListItem(plain)) {
        if (out.endsWith('\n')) out = `${out.slice(0, -1)} `;
        out += `${trimmed}\n`;
        continue;
      }
      inList = false;
      lastListX = undefined;
    }

    if (inPara) out += ' ';
    out += trimmed;
    inPara = true;
  }

  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out.length === 0 ? '' : `${out}\n`;
}
