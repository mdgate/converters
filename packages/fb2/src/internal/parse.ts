import { type Element, ns, parseXml } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type Asset,
  type Block,
  cellSpanning,
  type Document,
  emptyDocument,
  GridBuilder,
  heading,
  type ImageSource,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  type LinkTarget,
  MAX_ASSET_TOTAL_BYTES,
  type Note,
  PLAIN,
  plain,
  resolveHeaderRows,
  type Style,
} from '@mdgate/document';
import { cleanText, collapseWs, isAbsoluteUri, trim } from '@mdgate/utils';

const ITALIC: Style = { bold: false, italic: true, strike: false, code: false };
const NOTE_BODIES = new Set(['notes', 'comments', 'footnotes']);

interface Ctx {
  assets: Asset[];
  assetTotal: number;
  byOrigin: Map<string, number>;
}

export function parse(bytes: Uint8Array): Document {
  const tree = parseXml(bytes);
  const root = findFictionBook(tree);
  if (root === undefined) {
    throw ConvertError.malformed('not a FictionBook document');
  }

  const ctx: Ctx = { assets: [], assetTotal: 0, byOrigin: new Map() };
  collectBinaries(root, ctx);

  const doc = emptyDocument();
  const bookTitle = emitTitleInfo(root, doc, ctx);

  const notes: Note[] = [];
  for (const body of children(root, 'body')) {
    const name = (body.attrAny('name') ?? '').toLowerCase();
    if (NOTE_BODIES.has(name)) {
      collectNotes(body, ctx, notes);
      continue;
    }
    emitBody(body, doc, ctx, bookTitle);
  }

  doc.notes = notes;
  doc.assets = ctx.assets;
  return doc;
}

function findFictionBook(tree: Element): Element | undefined {
  if (tree.local === 'FictionBook') return tree;
  for (const child of tree.childElems()) {
    if (child.local === 'FictionBook') return child;
  }
  return undefined;
}

function collectBinaries(root: Element, ctx: Ctx): void {
  for (const bin of root.childElems()) {
    if (bin.local !== 'binary') continue;
    const id = bin.attrAny('id');
    if (id === undefined || id.length === 0) continue;
    const decoded = decodeBase64(bin.text());
    if (decoded === undefined) continue;
    const media = bin.attrAny('content-type') ?? sniffImageMedia(decoded);
    addAsset(ctx, id, media, decoded);
  }
}

function emitTitleInfo(root: Element, doc: Document, ctx: Ctx): string | undefined {
  const description = child(root, 'description');
  const titleInfo = description !== undefined ? child(description, 'title-info') : undefined;
  if (titleInfo === undefined) return undefined;

  const title = childText(titleInfo, 'book-title');
  if (title.length > 0) doc.blocks.push(heading(1, [plain(title)]));

  const authors: string[] = [];
  for (const author of children(titleInfo, 'author')) {
    const name = authorName(author);
    if (name.length > 0) authors.push(name);
  }
  if (authors.length > 0) {
    doc.blocks.push({ type: 'paragraph', inlines: [plain(authors.join(', '))] });
  }

  const annotation = child(titleInfo, 'annotation');
  if (annotation !== undefined) {
    const blocks = parseFlow(annotation, ctx, 2);
    if (blocks.length > 0) doc.blocks.push({ type: 'blockQuote', blocks });
  }

  const cover = child(titleInfo, 'coverpage');
  if (cover !== undefined) {
    for (const img of children(cover, 'image')) {
      const inline = parseImage(img, ctx);
      if (inline !== undefined) doc.blocks.push({ type: 'paragraph', inlines: [inline] });
    }
  }

  return title.length > 0 ? title : undefined;
}

function emitBody(body: Element, doc: Document, ctx: Ctx, bookTitle: string | undefined): void {
  const titleEl = child(body, 'title');
  if (titleEl !== undefined) {
    const inlines = titleInlines(titleEl, ctx);
    const text = trim(inlinesToPlainText(inlines));
    if (!inlinesAreEmpty(inlines) && !sameTitle(text, bookTitle)) {
      doc.blocks.push({
        type: 'heading',
        level: bookTitle !== undefined ? 2 : 1,
        anchor: undefined,
        content: inlines,
      });
    }
  }

  const startLevel = bookTitle !== undefined ? 2 : 1;
  for (const el of body.childElems()) {
    if (el.local === 'title') continue;
    if (el.local === 'section') {
      doc.blocks.push(...parseSection(el, ctx, startLevel));
    } else {
      doc.blocks.push(...parseOne(el, ctx, startLevel));
    }
  }
}

function collectNotes(body: Element, ctx: Ctx, notes: Note[]): void {
  for (const section of children(body, 'section')) {
    collectNoteSection(section, ctx, notes);
  }
}

function collectNoteSection(elem: Element, ctx: Ctx, notes: Note[]): void {
  const id = elem.attrAny('id');
  if (id !== undefined && id.length > 0) {
    const blocks = parseNoteSection(elem, ctx);
    if (blocks.length > 0) notes.push({ id, kind: 'footnote', blocks });
  }
  for (const nested of children(elem, 'section')) {
    collectNoteSection(nested, ctx, notes);
  }
}

function parseNoteSection(elem: Element, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  for (const el of elem.childElems()) {
    if (el.local === 'section') continue;
    if (el.local === 'title') {
      const inlines = titleInlines(el, ctx);
      if (!inlinesAreEmpty(inlines)) blocks.push({ type: 'paragraph', inlines });
      continue;
    }
    blocks.push(...parseOne(el, ctx, 2));
  }
  return blocks;
}

function parseSection(elem: Element, ctx: Ctx, level: number): Block[] {
  const blocks: Block[] = [];
  const id = elem.attrAny('id');
  const titleEl = child(elem, 'title');
  if (titleEl !== undefined) {
    const inlines = titleInlines(titleEl, ctx);
    if (!inlinesAreEmpty(inlines)) {
      blocks.push({ type: 'heading', level, anchor: id, content: inlines });
    } else if (id !== undefined) {
      blocks.push({ type: 'paragraph', inlines: [{ type: 'anchor', id }] });
    }
  } else if (id !== undefined) {
    blocks.push({ type: 'paragraph', inlines: [{ type: 'anchor', id }] });
  }

  const next = Math.min(level + 1, 6);
  for (const el of elem.childElems()) {
    if (el.local === 'title') continue;
    if (el.local === 'section') blocks.push(...parseSection(el, ctx, next));
    else blocks.push(...parseOne(el, ctx, level));
  }
  return blocks;
}

function parseFlow(parent: Element, ctx: Ctx, level: number): Block[] {
  const blocks: Block[] = [];
  for (const el of parent.childElems()) {
    if (el.local === 'section') blocks.push(...parseSection(el, ctx, level));
    else blocks.push(...parseOne(el, ctx, level));
  }
  return blocks;
}

function parseOne(elem: Element, ctx: Ctx, level: number): Block[] {
  switch (elem.local) {
    case 'p': {
      const inlines = parseInlines(elem, ctx, PLAIN);
      return inlinesAreEmpty(inlines) ? [] : [{ type: 'paragraph', inlines }];
    }
    case 'subtitle': {
      const inlines = parseInlines(elem, ctx, PLAIN);
      if (inlinesAreEmpty(inlines)) return [];
      return [
        { type: 'heading', level: Math.min(level + 1, 6), anchor: undefined, content: inlines },
      ];
    }
    case 'empty-line':
      return [];
    case 'poem':
      return parsePoem(elem, ctx, level);
    case 'cite':
    case 'epigraph':
    case 'annotation': {
      const inner = parseFlow(elem, ctx, level);
      return inner.length === 0 ? [] : [{ type: 'blockQuote', blocks: inner }];
    }
    case 'text-author': {
      const inlines = parseInlines(elem, ctx, ITALIC);
      return inlinesAreEmpty(inlines) ? [] : [{ type: 'paragraph', inlines }];
    }
    case 'table': {
      const table = parseTable(elem, ctx, level);
      return table === undefined ? [] : [table];
    }
    case 'image': {
      const inline = parseImage(elem, ctx);
      return inline === undefined ? [] : [{ type: 'paragraph', inlines: [inline] }];
    }
    case 'title': {
      const inlines = titleInlines(elem, ctx);
      if (inlinesAreEmpty(inlines)) return [];
      return [{ type: 'heading', level, anchor: undefined, content: inlines }];
    }
    case 'stanza':
      return parseStanza(elem, ctx);
    case 'v': {
      const inlines = parseInlines(elem, ctx, PLAIN);
      return inlinesAreEmpty(inlines) ? [] : [{ type: 'paragraph', inlines }];
    }
    case 'date': {
      const inlines = parseInlines(elem, ctx, PLAIN);
      return inlinesAreEmpty(inlines) ? [] : [{ type: 'paragraph', inlines }];
    }
    default:
      return parseFlow(elem, ctx, level);
  }
}

function parsePoem(elem: Element, ctx: Ctx, level: number): Block[] {
  const inner: Block[] = [];
  for (const el of elem.childElems()) {
    switch (el.local) {
      case 'title': {
        const inlines = titleInlines(el, ctx);
        if (!inlinesAreEmpty(inlines)) {
          inner.push({
            type: 'heading',
            level: Math.min(level + 1, 6),
            anchor: undefined,
            content: inlines,
          });
        }
        break;
      }
      case 'epigraph': {
        const blocks = parseFlow(el, ctx, level);
        if (blocks.length > 0) inner.push({ type: 'blockQuote', blocks });
        break;
      }
      case 'stanza':
        inner.push(...parseStanza(el, ctx));
        break;
      case 'text-author': {
        const inlines = parseInlines(el, ctx, ITALIC);
        if (!inlinesAreEmpty(inlines)) inner.push({ type: 'paragraph', inlines });
        break;
      }
      case 'date': {
        const inlines = parseInlines(el, ctx, PLAIN);
        if (!inlinesAreEmpty(inlines)) inner.push({ type: 'paragraph', inlines });
        break;
      }
      default:
        inner.push(...parseOne(el, ctx, level));
        break;
    }
  }
  return inner.length === 0 ? [] : [{ type: 'blockQuote', blocks: inner }];
}

function parseStanza(elem: Element, ctx: Ctx): Block[] {
  const verses: Inline[][] = [];
  const extra: Block[] = [];
  for (const el of elem.childElems()) {
    if (el.local === 'title') {
      const inlines = titleInlines(el, ctx);
      if (!inlinesAreEmpty(inlines)) extra.push({ type: 'paragraph', inlines });
      continue;
    }
    if (el.local === 'v') {
      const inlines = parseInlines(el, ctx, PLAIN);
      if (!inlinesAreEmpty(inlines)) verses.push(inlines);
    }
  }
  if (verses.length > 0) {
    const joined: Inline[] = [];
    for (let i = 0; i < verses.length; i += 1) {
      if (i > 0) joined.push({ type: 'lineBreak' });
      joined.push(...verses[i]!);
    }
    extra.push({ type: 'paragraph', inlines: joined });
  }
  return extra;
}

function parseTable(elem: Element, ctx: Ctx, level: number): Block | undefined {
  const rows = children(elem, 'tr');
  if (rows.length === 0) return undefined;
  const builder = new GridBuilder();
  let headerRows = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const tr = rows[i]!;
    builder.nextRow();
    let allTh = true;
    let anyCell = false;
    for (const cell of tr.childElems()) {
      if (cell.local !== 'td' && cell.local !== 'th') continue;
      anyCell = true;
      if (cell.local !== 'th') allTh = false;
      const colSpan = parseSpan(cell.attrAny('colspan'));
      const rowSpan = parseSpan(cell.attrAny('rowspan'));
      builder.place(cellSpanning(parseFlow(cell, ctx, level), colSpan, rowSpan));
    }
    if (i === headerRows && allTh && anyCell) headerRows += 1;
  }
  const table = builder.finish('data');
  if (table.grid.length === 0) return undefined;
  table.headerRows = resolveHeaderRows(table, headerRows);
  return { type: 'table', table };
}

function parseInlines(elem: Element, ctx: Ctx, style: Style): Inline[] {
  const out: Inline[] = [];
  for (const node of elem.children) {
    if (node.type === 'text') {
      const text = collapseWs(cleanText(node.text));
      if (text.length > 0) out.push({ type: 'text', text, style });
      continue;
    }
    pushInlineElem(node.elem, ctx, style, out);
  }
  return out;
}

function pushInlineElem(elem: Element, ctx: Ctx, style: Style, out: Inline[]): void {
  switch (elem.local) {
    case 'emphasis':
      out.push(...parseInlines(elem, ctx, { ...style, italic: true }));
      return;
    case 'strong':
      out.push(...parseInlines(elem, ctx, { ...style, bold: true }));
      return;
    case 'strikethrough':
      out.push(...parseInlines(elem, ctx, { ...style, strike: true }));
      return;
    case 'code':
      out.push(...parseInlines(elem, ctx, { ...style, code: true }));
      return;
    case 'a': {
      const href = hrefOf(elem);
      const kind = (elem.attrAny('type') ?? '').toLowerCase();
      if (href !== undefined && (kind === 'note' || kind === 'footnote')) {
        const id = href.startsWith('#') ? href.slice(1) : href;
        if (id.length > 0) out.push({ type: 'noteRef', id });
        return;
      }
      const content = parseInlines(elem, ctx, style);
      const target = linkTarget(href);
      if (target !== undefined) out.push({ type: 'link', content, target });
      else out.push(...content);
      return;
    }
    case 'image': {
      const image = parseImage(elem, ctx);
      if (image !== undefined) out.push(image);
      return;
    }
    case 'style':
    case 'sub':
    case 'sup':
      out.push(...parseInlines(elem, ctx, style));
      return;
    default:
      if (isBlockLike(elem.local)) {
        const text = collapseWs(cleanText(elem.text()));
        if (text.length > 0) out.push({ type: 'text', text, style });
        return;
      }
      out.push(...parseInlines(elem, ctx, style));
  }
}

function parseImage(elem: Element, ctx: Ctx): Inline | undefined {
  const href = hrefOf(elem);
  const alt = trim(elem.attrAny('alt') ?? elem.attrAny('title') ?? '');
  const source = imageSource(href, ctx);
  const label = alt.length > 0 ? alt : hrefLabel(href);
  if (source === undefined && label.length === 0) return undefined;
  return { type: 'image', alt: label, source: source ?? { type: 'unavailable' } };
}

function imageSource(href: string | undefined, ctx: Ctx): ImageSource | undefined {
  if (href === undefined || href.length === 0) return undefined;
  if (isAbsoluteUri(href) && !href.startsWith('#')) return { type: 'external', url: href };
  const id = href.startsWith('#') ? href.slice(1) : href;
  if (id.length === 0) return undefined;
  const assetId = ctx.byOrigin.get(id);
  if (assetId === undefined) return { type: 'unavailable' };
  return { type: 'asset', id: assetId };
}

function hrefLabel(href: string | undefined): string {
  if (href === undefined || href.length === 0) return '';
  return href.startsWith('#') ? href.slice(1) : href;
}

function linkTarget(href: string | undefined): LinkTarget | undefined {
  if (href === undefined || href.length === 0) return undefined;
  if (href.startsWith('#')) {
    const id = href.slice(1);
    return id.length > 0 ? { type: 'anchor', id } : undefined;
  }
  if (isAbsoluteUri(href)) return { type: 'external', url: href };
  return { type: 'relative', url: href };
}

function titleInlines(elem: Element, ctx: Ctx): Inline[] {
  const parts: Inline[] = [];
  for (const el of elem.childElems()) {
    if (el.local === 'empty-line') continue;
    const piece = parseInlines(el, ctx, PLAIN);
    if (inlinesAreEmpty(piece)) continue;
    if (parts.length > 0) parts.push({ type: 'text', text: ' ', style: PLAIN });
    parts.push(...piece);
  }
  if (parts.length > 0) return parts;
  return parseInlines(elem, ctx, PLAIN);
}

function authorName(elem: Element): string {
  const first = childText(elem, 'first-name');
  const middle = childText(elem, 'middle-name');
  const last = childText(elem, 'last-name');
  const nick = childText(elem, 'nickname');
  const parts = [first, middle, last].filter((s) => s.length > 0);
  if (parts.length > 0) return parts.join(' ');
  return nick;
}

function addAsset(ctx: Ctx, origin: string, mediaType: string, bytes: Uint8Array): number {
  const existing = ctx.byOrigin.get(origin);
  if (existing !== undefined) return existing;
  ctx.assetTotal += bytes.length;
  if (ctx.assetTotal > MAX_ASSET_TOTAL_BYTES) {
    throw ConvertError.resourceLimit(
      'max_asset_total_bytes',
      'embedded assets exceed the retained-bytes cap',
    );
  }
  const id = ctx.assets.length;
  ctx.byOrigin.set(origin, id);
  ctx.assets.push({ id, mediaType, originPart: origin, bytes: bytes.slice() });
  return id;
}

function decodeBase64(raw: string): Uint8Array | undefined {
  let s = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20) continue;
    s += raw[i]!;
  }
  if (s.length === 0) return undefined;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

function sniffImageMedia(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  return 'application/octet-stream';
}

function hrefOf(elem: Element): string | undefined {
  return elem.attr(ns.XLINK, 'href') ?? elem.attrAny('href');
}

function child(elem: Element, name: string): Element | undefined {
  return elem.childElems().find((e) => e.local === name);
}

function children(elem: Element, name: string): Element[] {
  return elem.childElems().filter((e) => e.local === name);
}

function childText(elem: Element, name: string): string {
  const found = child(elem, name);
  return found === undefined ? '' : trim(collapseWs(cleanText(found.text())));
}

function sameTitle(a: string, b: string | undefined): boolean {
  if (b === undefined) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function isBlockLike(name: string): boolean {
  return (
    name === 'p' ||
    name === 'poem' ||
    name === 'cite' ||
    name === 'table' ||
    name === 'subtitle' ||
    name === 'empty-line' ||
    name === 'section' ||
    name === 'epigraph'
  );
}

function parseSpan(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1000);
}
