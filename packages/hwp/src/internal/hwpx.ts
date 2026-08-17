/** HWPX / HWTX: ZIP + OWPML section XML. */

import { type Element, Package } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type Block,
  cellSpanning,
  type Document,
  emptyDocument,
  GridBuilder,
  type Inline,
  inlinesAreEmpty,
  plain,
  resolveHeaderRows,
} from '@mdgate/document';
import { cleanText } from '@mdgate/utils';

interface Ctx {
  styles: Map<string, number>;
}

export function parseHwpx(bytes: Uint8Array): Document {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    throw mapZipError(e);
  }

  const header =
    pkg.optionalXmlPart('Contents/header.xml') ?? pkg.optionalXmlPart('Contents/Header.xml');
  const ctx: Ctx = { styles: header !== undefined ? collectHeadingStyles(header) : new Map() };

  const sections = sectionNames(pkg);
  if (sections.length === 0) throw ConvertError.missingPart('Contents/section0.xml');

  const doc = emptyDocument();
  for (const name of sections) {
    const tree = pkg.optionalXmlPart(name);
    if (tree === undefined) continue;
    walkBlocks(tree, doc.blocks, ctx);
  }

  if (doc.blocks.length === 0) {
    collectPreview(pkg, doc);
  }
  if (doc.blocks.length === 0) {
    throw ConvertError.malformed('no readable text in HWPX document');
  }
  return doc;
}

function sectionNames(pkg: Package): string[] {
  const names: string[] = [];
  for (const name of pkg.partNames()) {
    if (/^Contents\/section\d+\.xml$/i.test(name)) names.push(name);
  }
  names.sort((a, b) => sectionIndex(a) - sectionIndex(b));
  return names;
}

function sectionIndex(name: string): number {
  const m = name.match(/section(\d+)/i);
  return m !== null ? Number(m[1]) : 0;
}

function collectHeadingStyles(tree: Element): Map<string, number> {
  const out = new Map<string, number>();
  for (const el of tree.descendantsAny('style')) {
    const id = el.attrAny('id');
    if (id === undefined) continue;
    const level = headingLevelFromStyle(el);
    if (level !== undefined) out.set(id, level);
  }
  return out;
}

function headingLevelFromStyle(el: Element): number | undefined {
  const type = (el.attrAny('type') ?? '').toLowerCase();
  const name = `${el.attrAny('name') ?? ''} ${el.attrAny('engName') ?? ''}`;
  const m = name.match(/(?:개요|제목|outline|heading)\s*(\d+)/i);
  if (m !== null) return clampLevel(Number(m[1]));
  if (type === 'outline' || type === 'heading') return 1;
  return undefined;
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > 6 ? 6 : n | 0;
}

function walkBlocks(elem: Element, blocks: Block[], ctx: Ctx): void {
  if (elem.local === 'tbl') {
    const table = parseTable(elem, ctx);
    if (table !== undefined) blocks.push(table);
    return;
  }
  if (elem.local === 'p') {
    parseParagraph(elem, blocks, ctx);
    return;
  }
  for (const child of elem.childElems()) walkBlocks(child, blocks, ctx);
}

function parseParagraph(elem: Element, blocks: Block[], ctx: Ctx): void {
  const level = headingLevelOf(elem, ctx);
  let inlines: Inline[] = [];
  let headingUsed = false;

  const flush = (): void => {
    if (inlinesAreEmpty(inlines)) {
      inlines = [];
      return;
    }
    if (level !== undefined && !headingUsed) {
      blocks.push({ type: 'heading', level, anchor: undefined, content: inlines });
      headingUsed = true;
    } else {
      blocks.push({ type: 'paragraph', inlines });
    }
    inlines = [];
  };

  const walk = (el: Element): void => {
    for (const node of el.children) {
      if (node.type === 'text') {
        const text = cleanText(node.text);
        if (text.length > 0) inlines.push(plain(text));
        continue;
      }
      const child = node.elem;
      switch (child.local) {
        case 'tbl': {
          flush();
          const table = parseTable(child, ctx);
          if (table !== undefined) blocks.push(table);
          break;
        }
        case 't': {
          const text = cleanText(child.text());
          if (text.length > 0) inlines.push(plain(text));
          break;
        }
        case 'lineBreak':
        case 'line-break':
          inlines.push({ type: 'lineBreak' });
          break;
        case 'tab':
          inlines.push(plain('\t'));
          break;
        default:
          walk(child);
      }
    }
  };

  walk(elem);
  flush();
}

function headingLevelOf(elem: Element, ctx: Ctx): number | undefined {
  const ref = elem.attrAny('styleIDRef') ?? elem.attrAny('styleId') ?? elem.attrAny('styleID');
  if (ref === undefined) return undefined;
  return ctx.styles.get(ref);
}

function parseTable(elem: Element, ctx: Ctx): Block | undefined {
  const rows = tableRows(elem);
  if (rows.length === 0) return undefined;
  const builder = new GridBuilder();
  for (const row of rows) {
    builder.nextRow();
    for (const cell of rowCells(row)) {
      builder.place(
        cellSpanning(cellBlocks(cell, ctx), spanOf(cell, 'colSpan'), spanOf(cell, 'rowSpan')),
      );
    }
  }
  const table = builder.finish('data');
  if (table.grid.length === 0) return undefined;
  table.headerRows = resolveHeaderRows(table, 0);
  return { type: 'table', table };
}

function tableRows(elem: Element): Element[] {
  const direct = elem.childElems().filter((e) => e.local === 'tr');
  if (direct.length > 0) return direct;
  return [...elem.descendantsAny('tr')];
}

function rowCells(row: Element): Element[] {
  const direct = row.childElems().filter((e) => e.local === 'tc');
  if (direct.length > 0) return direct;
  return [...row.descendantsAny('tc')];
}

function cellBlocks(cell: Element, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  const sub = cell.childElems().find((e) => e.local === 'subList');
  if (sub !== undefined) {
    walkBlocks(sub, blocks, ctx);
    return blocks;
  }
  for (const child of cell.childElems()) {
    if (child.local === 'p' || child.local === 'tbl') walkBlocks(child, blocks, ctx);
  }
  return blocks;
}

function spanOf(cell: Element, name: string): number {
  const raw =
    cell.attrAny(name) ??
    cell
      .childElems()
      .find((e) => e.local === 'cellSpan')
      ?.attrAny(name);
  if (raw === undefined || raw.length === 0) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > 1_000 ? 1_000 : n | 0;
}

function collectPreview(pkg: Package, doc: Document): void {
  const part =
    pkg.optionalPart('Preview/PrvText.txt') ??
    pkg.optionalPart('Preview/PrvText.dat') ??
    pkg.optionalPart('Preview/PrvText');
  if (part === undefined) return;
  for (const para of splitPreview(decodePreview(part))) {
    doc.blocks.push({ type: 'paragraph', inlines: [plain(para)] });
  }
}

function decodePreview(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  const even = bytes.length & ~1;
  if (even >= 4 && looksUtf16le(bytes.subarray(0, even))) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(0, even));
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function looksUtf16le(bytes: Uint8Array): boolean {
  let zeros = 0;
  for (let i = 1; i < bytes.length; i += 2) {
    if (bytes[i] === 0) zeros += 1;
  }
  return zeros * 2 >= bytes.length / 2;
}

function splitPreview(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/\0+/)) {
    const cleaned = cleanText(part).trim();
    if (cleaned.length > 0) out.push(cleaned);
  }
  return out;
}

function mapZipError(e: unknown): ConvertError {
  if (e instanceof ConvertError) {
    if (e.code === 'encrypted' || isEncryptedText(e.message) || isEncryptedText(e.detail ?? '')) {
      return ConvertError.encrypted();
    }
    return e;
  }
  const text = e instanceof Error ? e.message : String(e);
  if (isEncryptedText(text)) return ConvertError.encrypted();
  return ConvertError.malformed(`not a readable zip archive: ${text}`);
}

function isEncryptedText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('encrypted') || lower.includes('password');
}
