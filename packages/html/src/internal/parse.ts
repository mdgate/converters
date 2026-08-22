import {
  decodeFragment,
  type Element,
  type MimePart,
  mimeHeader,
  mimeTextHtml,
  mimeTextPlain,
  parseMime,
  parseXml,
  walkMimeParts,
} from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type AnchorId,
  type Document,
  emptyDocument,
  type ImageSource,
  type LinkTarget,
  plain,
} from '@mdgate/document';
import { AssetSink, mediaTypeFor } from '@mdgate/office-common';
import { decode, isAbsoluteUri, trim } from '@mdgate/utils';
import { isWellFormedXmlMarkup, parseHtml } from './html-parse.js';
import { type HtmlCtx, Stylesheet, toBlocks } from './walk.js';

export function parseHtmlBytes(bytes: Uint8Array): Document {
  const tree = parseMarkup(bytes);
  const assets = new AssetSink();
  return documentFromTree(tree, new DefaultCtx(undefined, assets), assets);
}

export function parseMhtml(bytes: Uint8Array): Document {
  const root = parseMime(bytes);
  const part = mimeTextHtml(root) ?? mimeTextPlain(root);
  if (part === undefined) {
    throw ConvertError.malformed('no text/html or text/plain part');
  }
  const assets = new AssetSink();
  const cids = indexCids(root);
  const text = decodePart(part);
  if (part.contentType === 'text/plain') {
    const doc = emptyDocument();
    const body = trim(text);
    if (body.length > 0) doc.blocks.push({ type: 'paragraph', inlines: [plain(body)] });
    doc.assets = assets.assets;
    return doc;
  }
  const tree = parseMarkupText(text, new TextEncoder().encode(text));
  return documentFromTree(tree, new DefaultCtx(cids, assets), assets);
}

function parseMarkup(bytes: Uint8Array): Element {
  return parseMarkupText(decodeHtmlBytes(bytes), bytes);
}

function parseMarkupText(text: string, bytes: Uint8Array): Element {
  if (isWellFormedXmlMarkup(text)) {
    try {
      return parseXml(bytes);
    } catch {
      // parse as HTML
    }
  }
  return parseHtml(text);
}

function documentFromTree(tree: Element, ctx: HtmlCtx, assets: AssetSink): Document {
  normalizeHtmlTree(tree);
  const css = collectStyles(tree);
  const host = findBodyOrRoot(tree);
  const doc = emptyDocument();
  doc.blocks.push(...toBlocks(host, css, ctx));
  doc.assets = assets.assets;
  return doc;
}

function collectStyles(tree: Element): Stylesheet {
  const css = new Stylesheet();
  for (const elem of tree.descendantElems()) {
    if (elem.local === 'style') css.add(elem.text());
  }
  return css;
}

function findBodyOrRoot(tree: Element): Element {
  if (tree.local === 'body') return tree;
  const html = tree.local === 'html' ? tree : findChild(tree, 'html');
  if (html !== undefined) {
    const body = findChild(html, 'body');
    if (body !== undefined) return body;
    return html;
  }
  const body = findChild(tree, 'body');
  return body ?? tree;
}

function findChild(elem: Element, local: string): Element | undefined {
  return elem.childElems().find((e) => e.local === local);
}

function normalizeHtmlTree(elem: Element): void {
  elem.local = elem.local.toLowerCase();
  const attrs = elem.attrs;
  for (let i = 0; i < attrs.length; i += 1) {
    attrs[i]!.local = attrs[i]!.local.toLowerCase();
  }
  for (const child of elem.childElems()) normalizeHtmlTree(child);
}

class DefaultCtx implements HtmlCtx {
  constructor(
    private readonly cids: Map<string, MimePart> | undefined,
    private readonly assets: AssetSink,
  ) {}

  linkTarget(href: string): LinkTarget | undefined {
    if (href.length === 0) return undefined;
    if (href.startsWith('#')) {
      const fragment = decodeFragment(href.slice(1));
      return fragment.length > 0 ? { type: 'anchor', id: fragment } : undefined;
    }
    if (isAbsoluteUri(href)) return { type: 'external', url: href };
    return { type: 'relative', url: href };
  }

  imageSource(src: string): ImageSource | undefined {
    if (src.length === 0) return undefined;
    if (isDataUri(src)) return this.resolveDataUri(src);
    const cid = this.resolveCid(src);
    if (cid !== undefined) return cid;
    if (isAbsoluteUri(src)) return { type: 'external', url: src };
    return { type: 'relative', url: src };
  }

  anchorId(raw: string): AnchorId {
    return raw;
  }

  private resolveDataUri(src: string): ImageSource | undefined {
    const parsed = decodeDataUri(src);
    if (parsed === undefined) return undefined;
    const id = this.assets.add(parsed.mediaType, src, parsed.bytes);
    return { type: 'asset', id };
  }

  private resolveCid(src: string): ImageSource | undefined {
    if (this.cids === undefined) return undefined;
    if (src.length < 4 || src.slice(0, 4).toLowerCase() !== 'cid:') return undefined;
    let cid = src.slice(4);
    try {
      cid = decodeURIComponent(cid);
    } catch {
      // keep the raw cid
    }
    if (cid.startsWith('<') && cid.endsWith('>') && cid.length >= 2) cid = cid.slice(1, -1);
    const part = this.cids.get(cid.toLowerCase());
    if (part === undefined) return undefined;
    const origin = part.filename ?? cid;
    const media = part.contentType.length > 0 ? part.contentType : mediaTypeFor(origin);
    const id = this.assets.add(media, origin, part.bytes);
    return { type: 'asset', id };
  }
}

function indexCids(root: MimePart): Map<string, MimePart> {
  const map = new Map<string, MimePart>();
  for (const part of walkMimeParts(root)) {
    const raw = mimeHeader(part, 'content-id');
    if (raw === undefined) continue;
    const cid = unwrapCid(raw);
    if (cid.length > 0) map.set(cid.toLowerCase(), part);
  }
  return map;
}

function unwrapCid(value: string): string {
  let s = trim(value);
  if (s.startsWith('<') && s.endsWith('>') && s.length >= 2) s = s.slice(1, -1);
  return s;
}

function decodePart(part: MimePart): string {
  const raw = mimeHeader(part, 'content-type');
  let charset = 'utf-8';
  if (raw !== undefined) {
    const match = /charset\s*=\s*("?)([^";\s]+)\1/i.exec(raw);
    if (match !== null) charset = match[2]!;
  }
  try {
    return decode(part.bytes, charset);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(part.bytes);
  }
}

function decodeHtmlBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function isDataUri(src: string): boolean {
  return src.length >= 5 && src.slice(0, 5).toLowerCase() === 'data:';
}

function decodeDataUri(src: string): { mediaType: string; bytes: Uint8Array } | undefined {
  const body = src.slice(5);
  const comma = body.indexOf(',');
  if (comma < 0) return undefined;
  const parts = body.slice(0, comma).split(';');
  let mediaType = parts[0]!.trim();
  if (mediaType.length === 0) mediaType = 'application/octet-stream';
  let base64 = false;
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i]!.trim().toLowerCase() === 'base64') base64 = true;
  }
  const payload = body.slice(comma + 1);
  const bytes = base64 ? decodeBase64(payload) : decodePercent(payload);
  if (bytes === undefined || bytes.length === 0) return undefined;
  return { mediaType: mediaType.toLowerCase(), bytes };
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

function decodePercent(raw: string): Uint8Array | undefined {
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    if (c === 0x25) {
      if (i + 2 >= raw.length) return undefined;
      const hi = fromHex(raw.charCodeAt(i + 1));
      const lo = fromHex(raw.charCodeAt(i + 2));
      if (hi === undefined || lo === undefined) return undefined;
      out.push((hi << 4) | lo);
      i += 2;
      continue;
    }
    if (c < 128) {
      out.push(c);
      continue;
    }
    const encoded = new TextEncoder().encode(raw[i]!);
    for (let j = 0; j < encoded.length; j += 1) out.push(encoded[j]!);
  }
  return out.length === 0 ? undefined : new Uint8Array(out);
}

function fromHex(c: number): number | undefined {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return undefined;
}
