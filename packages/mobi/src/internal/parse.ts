import type { Element } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type Block,
  type Document,
  documentToMarkdown,
  emptyDocument,
  heading,
  type ImageSource,
  type LinkTarget,
  plain,
} from '@mdgate/document';
import { type HtmlCtx, parseHtml, Stylesheet, toBlocks } from '@mdgate/html';
import { decode, isAbsoluteUri, trim } from '@mdgate/utils';
import { asciiAt, asciiEq, concatBytes, u16, u32 } from './binary.js';
import {
  COMPRESS_HUFF,
  COMPRESS_NONE,
  COMPRESS_PALMDOC,
  decompressRecord,
  HuffReader,
  trimTrailing,
} from './decompress.js';

const PDB_HEADER = 78;
const NONE = 0xffffffff;

const HTML_CTX: HtmlCtx = {
  linkTarget(href: string): LinkTarget | undefined {
    if (href.length === 0) return undefined;
    if (href.startsWith('#')) {
      const id = href.slice(1);
      return id.length > 0 ? { type: 'anchor', id } : undefined;
    }
    if (isAbsoluteUri(href)) return { type: 'external', url: href };
    return { type: 'relative', url: href };
  },
  imageSource(src: string): ImageSource | undefined {
    if (src.length === 0) return undefined;
    if (isAbsoluteUri(src)) return { type: 'external', url: src };
    return undefined;
  },
  anchorId(raw: string) {
    return raw;
  },
};

export function looksLikeMobi(bytes: Uint8Array): boolean {
  if (isPdf(bytes) || isOle(bytes) || isZip(bytes)) return false;
  if (bytes.length >= 68) {
    const magic = asciiAt(bytes, 60, 8);
    if (magic === 'BOOKMOBI' || magic === 'TEXtREAd') return true;
  }
  return hasMobiRecord0(bytes);
}

export function convertBook(bytes: Uint8Array): string {
  const book = readBook(bytes);
  const htmlParts = isolateHtmlParts(book.text);
  if (htmlParts.length > 0) {
    const doc = emptyDocument();
    if (book.title !== undefined) doc.blocks.push(heading(1, [plain(book.title)]));
    for (const part of htmlParts) doc.blocks.push(...htmlPartToBlocks(part));
    if (doc.blocks.length === 0) throw ConvertError.malformed('empty text');
    return documentToMarkdown(dedupeTitle(doc, book.title));
  }

  const doc = emptyDocument();
  if (book.title !== undefined) doc.blocks.push(heading(1, [plain(book.title)]));
  for (const para of splitParagraphs(book.text)) {
    doc.blocks.push({ type: 'paragraph', inlines: [plain(para)] });
  }
  if (doc.blocks.length === 0) throw ConvertError.malformed('empty text');
  return documentToMarkdown(doc);
}

interface Book {
  title: string | undefined;
  text: string;
}

interface PalmHeader {
  compression: number;
  textLength: number;
  recordCount: number;
  encryption: number;
}

interface MobiHeader {
  headerLength: number;
  encoding: number;
  firstNonBook: number;
  fullNameOffset: number;
  fullNameLength: number;
  firstImage: number;
  huffOffset: number;
  huffCount: number;
  exthFlags: number;
  drmOffset: number;
  drmCount: number;
  firstContent: number;
  extraFlags: number;
}

interface Exth {
  title: string | undefined;
  kf8Boundary: number | undefined;
}

function readBook(bytes: Uint8Array): Book {
  const pdb = parsePdb(bytes);
  if (pdb.records.length === 0) throw ConvertError.missingPart('text');
  const rec0 = pdb.records[0]!;
  const palm = parsePalmDoc(rec0);
  if (palm.encryption !== 0) throw ConvertError.encrypted();

  const mobiHdr = parseMobiHeader(rec0);
  if (mobiHdr !== undefined && isDrm(mobiHdr)) throw ConvertError.encrypted();

  const exth = mobiHdr !== undefined ? parseExth(rec0, mobiHdr) : undefined;
  const encoding = encodingName(mobiHdr?.encoding ?? 1252);
  const title = bookTitle(rec0, pdb.name, mobiHdr, exth, encoding);

  let section = { records: pdb.records, header: rec0, palm, mobi: mobiHdr };
  const boundary = exth?.kf8Boundary;
  if (boundary !== undefined && boundary + 1 < pdb.records.length) {
    const marker = pdb.records[boundary]!;
    if (asciiEq(marker, 0, 'BOUNDARY')) {
      const kf8 = pdb.records[boundary + 1]!;
      const kf8Palm = parsePalmDoc(kf8);
      if (kf8Palm.encryption !== 0) throw ConvertError.encrypted();
      const kf8Mobi = parseMobiHeader(kf8);
      if (kf8Mobi !== undefined && isDrm(kf8Mobi)) throw ConvertError.encrypted();
      section = { records: pdb.records, header: kf8, palm: kf8Palm, mobi: kf8Mobi };
    }
  }

  const text = extractText(section.records, section.palm, section.mobi, encoding);
  return { title, text };
}

function parsePdb(bytes: Uint8Array): { name: string; records: Uint8Array[] } {
  if (bytes.length < PDB_HEADER + 8) {
    throw ConvertError.malformed('truncated Palm database');
  }
  const count = u16(bytes, 76);
  if (count === 0) throw ConvertError.malformed('Palm database has no records');
  if (bytes.length < PDB_HEADER + count * 8) {
    throw ConvertError.malformed('truncated record list');
  }
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    offsets.push(u32(bytes, PDB_HEADER + i * 8));
  }
  const records: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = offsets[i]!;
    const end = i + 1 < count ? offsets[i + 1]! : bytes.length;
    if (start > bytes.length || end < start) {
      throw ConvertError.malformed('invalid record offset');
    }
    records.push(bytes.subarray(start, Math.min(end, bytes.length)));
  }
  return { name: pdbName(bytes), records };
}

function parsePalmDoc(rec0: Uint8Array): PalmHeader {
  if (rec0.length < 16) throw ConvertError.malformed('truncated PalmDOC header');
  const compression = u16(rec0, 0);
  if (
    compression !== COMPRESS_NONE &&
    compression !== COMPRESS_PALMDOC &&
    compression !== COMPRESS_HUFF
  ) {
    throw ConvertError.unsupported(`compression ${compression}`);
  }
  return {
    compression,
    textLength: u32(rec0, 4),
    recordCount: u16(rec0, 8),
    encryption: u16(rec0, 12),
  };
}

function parseMobiHeader(rec0: Uint8Array): MobiHeader | undefined {
  if (rec0.length < 24 || !asciiEq(rec0, 16, 'MOBI')) return undefined;
  const headerLength = u32(rec0, 20);
  if (headerLength < 8) throw ConvertError.malformed('truncated MOBI header');
  const at = (off: number, fallback: number): number =>
    rec0.length >= off + 4 ? u32(rec0, off) : fallback;
  const extraFlags = headerLength >= 0xe4 && rec0.length >= 244 ? u32(rec0, 240) : 0;
  const firstContent = headerLength >= 0xc0 && rec0.length >= 194 ? u16(rec0, 192) : 1;
  return {
    headerLength,
    encoding: rec0.length >= 32 ? u32(rec0, 28) : 1252,
    firstNonBook: at(80, NONE),
    fullNameOffset: at(84, 0),
    fullNameLength: at(88, 0),
    firstImage: at(108, NONE),
    huffOffset: at(112, 0),
    huffCount: at(116, 0),
    exthFlags: at(128, 0),
    drmOffset: at(168, NONE),
    drmCount: at(172, 0),
    firstContent: firstContent === 0 ? 1 : firstContent,
    extraFlags,
  };
}

function parseExth(rec0: Uint8Array, mobi: MobiHeader): Exth | undefined {
  if ((mobi.exthFlags & 0x40) === 0) return undefined;
  const start = 16 + mobi.headerLength;
  if (start + 12 > rec0.length || !asciiEq(rec0, start, 'EXTH')) return undefined;
  const length = u32(rec0, start + 4);
  const count = u32(rec0, start + 8);
  if (count > 10_000) throw ConvertError.malformed('truncated EXTH header');
  let off = start + 12;
  const end = Math.min(rec0.length, start + length);
  let title: string | undefined;
  let kf8Boundary: number | undefined;
  for (let i = 0; i < count && off + 8 <= end; i += 1) {
    const type = u32(rec0, off);
    const recLen = u32(rec0, off + 4);
    if (recLen < 8 || off + recLen > rec0.length) break;
    const data = rec0.subarray(off + 8, off + recLen);
    if (type === 503) {
      const text = trim(decodeLossy(data, encodingName(mobi.encoding)));
      if (text.length > 0) title = text;
    }
    if (type === 121 && data.length >= 4) kf8Boundary = u32(data, 0);
    off += recLen;
  }
  return { title, kf8Boundary };
}

function extractText(
  records: readonly Uint8Array[],
  palm: PalmHeader,
  mobi: MobiHeader | undefined,
  encoding: string,
): string {
  const first = mobi !== undefined && mobi.firstContent > 0 ? mobi.firstContent : 1;
  let last = first + Math.max(palm.recordCount, 1) - 1;
  if (mobi !== undefined && mobi.firstNonBook !== 0 && mobi.firstNonBook !== NONE) {
    last = Math.min(last, mobi.firstNonBook - 1);
  }
  if (mobi !== undefined && mobi.firstImage !== 0 && mobi.firstImage !== NONE) {
    last = Math.min(last, mobi.firstImage - 1);
  }
  if (first >= records.length || last < first) throw ConvertError.missingPart('text');

  const expected = palm.textLength > 0 ? palm.textLength : Number.MAX_SAFE_INTEGER;
  const huff = loadHuff(records, palm, mobi);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = first; i <= last && i < records.length; i += 1) {
    let rec = records[i]!;
    if (rec.length === 0) continue;
    if (mobi !== undefined && mobi.extraFlags !== 0) rec = trimTrailing(rec, mobi.extraFlags);
    const chunk = decompressRecord(rec, palm.compression, huff, expected - total);
    parts.push(chunk);
    total += chunk.length;
    if (palm.textLength > 0 && total >= palm.textLength) break;
  }
  if (total === 0) throw ConvertError.missingPart('text');
  let raw = concatBytes(parts, total);
  if (palm.textLength > 0 && raw.length > palm.textLength) raw = raw.subarray(0, palm.textLength);
  return stripNuls(decodeLossy(raw, encoding));
}

function loadHuff(
  records: readonly Uint8Array[],
  palm: PalmHeader,
  mobi: MobiHeader | undefined,
): HuffReader | undefined {
  if (palm.compression !== COMPRESS_HUFF) return undefined;
  if (mobi === undefined || mobi.huffCount === 0 || mobi.huffOffset >= records.length) {
    throw ConvertError.malformed('HUFF/CDIC dictionary is missing');
  }
  const end = Math.min(records.length, mobi.huffOffset + mobi.huffCount);
  return new HuffReader(records.slice(mobi.huffOffset, end));
}

function htmlPartToBlocks(markup: string): Block[] {
  const wrapped = wrapIfNeeded(markup);
  try {
    const tree = parseHtml(wrapped);
    const host = findBodyOrRoot(tree);
    const css = collectStyles(tree);
    const blocks = toBlocks(host, css, HTML_CTX);
    if (blocks.length > 0) return blocks;
  } catch (e) {
    if (e instanceof ConvertError && e.isFatal()) throw e;
  }
  const text = stripMarkup(markup);
  return text.length === 0 ? [] : [{ type: 'paragraph', inlines: [plain(text)] }];
}

function findBodyOrRoot(tree: Element): Element {
  if (tree.local === 'body') return tree;
  const htmlEl = tree.local === 'html' ? tree : findLocal(tree, 'html');
  if (htmlEl !== undefined) {
    const body = findLocal(htmlEl, 'body');
    return body ?? htmlEl;
  }
  return findLocal(tree, 'body') ?? tree;
}

function findLocal(elem: Element, local: string): Element | undefined {
  for (const child of elem.childElems()) {
    if (child.local === local) return child;
  }
  return undefined;
}

function collectStyles(tree: Element): Stylesheet {
  const css = new Stylesheet();
  for (const elem of tree.descendantElems()) {
    if (elem.local === 'style') css.add(elem.text());
  }
  return css;
}

function isolateHtmlParts(text: string): string[] {
  const parts: string[] = [];
  const re = /<html\b[\s\S]*?<\/html>/gi;
  let m = re.exec(text);
  while (m !== null) {
    parts.push(m[0]!);
    m = re.exec(text);
  }
  if (parts.length > 0) return parts;
  if (/<[a-zA-Z][^>]*>/.test(text)) return [text];
  return [];
}

function wrapIfNeeded(markup: string): string {
  if (/<html[\s>]/i.test(markup)) return markup;
  return `<html><body>${markup}</body></html>`;
}

function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out: string[] = [];
  for (const chunk of normalized.split(/\n(?:[ \t]*\n)+/)) {
    const para = trim(chunk.replace(/[ \t]*\n[ \t]*/g, ' '));
    if (para.length > 0) out.push(para);
  }
  return out;
}

function stripMarkup(s: string): string {
  return trim(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function dedupeTitle(doc: Document, title: string | undefined): Document {
  if (title === undefined || doc.blocks.length < 2) return doc;
  const first = doc.blocks[0];
  const second = doc.blocks[1];
  if (first?.type !== 'heading' || second?.type !== 'heading') return doc;
  const a = first.content[0];
  const b = second.content[0];
  if (a?.type !== 'text' || b?.type !== 'text') return doc;
  if (a.text.toLowerCase() !== b.text.toLowerCase()) return doc;
  return { ...doc, blocks: doc.blocks.slice(1) };
}

function bookTitle(
  rec0: Uint8Array,
  pdbName: string,
  mobi: MobiHeader | undefined,
  exth: Exth | undefined,
  encoding: string,
): string | undefined {
  if (exth?.title !== undefined && exth.title.length > 0) return exth.title;
  if (mobi !== undefined && mobi.fullNameLength > 0 && mobi.fullNameOffset > 0) {
    const start = mobi.fullNameOffset;
    const end = start + mobi.fullNameLength;
    if (end <= rec0.length) {
      const name = trim(decodeLossy(rec0.subarray(start, end), encoding));
      if (name.length > 0) return name;
    }
  }
  return pdbName.length > 0 ? pdbName : undefined;
}

function pdbName(bytes: Uint8Array): string {
  const n = Math.min(32, bytes.length);
  let end = 0;
  while (end < n && bytes[end] !== 0) end += 1;
  if (end === 0) return '';
  return trim(decodeLossy(bytes.subarray(0, end), 'windows-1252'));
}

function encodingName(code: number): string {
  if (code === 65001 || code === 65000) return 'utf-8';
  if (code === 932) return 'shift_jis';
  if (code === 950) return 'big5';
  if (code === 949) return 'euc-kr';
  if (code === 936) return 'gbk';
  return 'windows-1252';
}

function decodeLossy(bytes: Uint8Array, label: string): string {
  try {
    return decode(bytes, label);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function stripNuls(s: string): string {
  return s.includes('\0') ? s.replace(/\0+/g, '') : s;
}

function isDrm(mobi: MobiHeader): boolean {
  if (mobi.drmOffset === 0 || mobi.drmOffset === NONE) return false;
  return mobi.drmCount !== 0 && mobi.drmCount !== NONE;
}

function hasMobiRecord0(bytes: Uint8Array): boolean {
  if (bytes.length < PDB_HEADER + 8) return false;
  const count = u16(bytes, 76);
  if (count < 1) return false;
  const rec0 = u32(bytes, PDB_HEADER);
  return rec0 + 20 <= bytes.length && asciiEq(bytes, rec0 + 16, 'MOBI');
}

function isPdf(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return (
    i + 5 <= bytes.length &&
    bytes[i] === 0x25 &&
    bytes[i + 1] === 0x50 &&
    bytes[i + 2] === 0x44 &&
    bytes[i + 3] === 0x46 &&
    bytes[i + 4] === 0x2d
  );
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
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}
