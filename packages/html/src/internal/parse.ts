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
    } catch (e) {
      if (e instanceof ConvertError && e.code === 'resourceLimit') throw e;
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
    const cid = this.resolveCid(src);
    if (cid !== undefined) return cid;
    if (isAbsoluteUri(src)) return { type: 'external', url: src };
    return undefined;
  }

  anchorId(raw: string): AnchorId {
    return raw;
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
