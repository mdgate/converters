import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { type Document, documentToMarkdown, emptyDocument, heading, plain } from '@mdgate/document';
import { mimeFromBytes, mimeFromPath, refuseForeign, resolveMime } from './mime.js';

export function svg(): Converter {
  return {
    id: 'svg',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (mimeFromBytes(bytes) === 'image/svg+xml') return 2;
      if (hint?.path !== undefined && mimeFromPath(hint.path) === 'image/svg+xml') return 1;
      return 0;
    },
    convert(bytes: Uint8Array, hint?: ConvertHint): ConvertResult {
      refuseForeign(bytes);
      const mime = resolveMime(bytes, hint);
      if (mime !== 'image/svg+xml') {
        throw ConvertError.unsupported(
          hint?.path === undefined
            ? 'unrecognized file content: name the format explicitly'
            : `unrecognized file content and extension: ${hint.path}`,
        );
      }
      return { markdown: documentToMarkdown(parseSvg(bytes)) };
    },
  };
}

export function svgToMarkdown(bytes: Uint8Array): string {
  return documentToMarkdown(parseSvg(bytes));
}

function parseSvg(bytes: Uint8Array): Document {
  const source = stripIgnored(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  const titles = extractTagged(source, 'title');
  const descs = extractTagged(source, 'desc');
  const texts = extractTagged(source, 'text');
  const doc = emptyDocument();
  if (titles.length === 0 && descs.length === 0 && texts.length === 0) {
    doc.blocks.push({ type: 'paragraph', inlines: [plain('This is an SVG image.')] });
    return doc;
  }
  for (let i = 0; i < titles.length; i += 1) {
    const title = titles[i]!;
    if (i === 0) doc.blocks.push(heading(1, [plain(title)]));
    else doc.blocks.push({ type: 'paragraph', inlines: [plain(title)] });
  }
  for (const desc of descs) doc.blocks.push({ type: 'paragraph', inlines: [plain(desc)] });
  for (const text of texts) doc.blocks.push({ type: 'paragraph', inlines: [plain(text)] });
  return doc;
}

function stripIgnored(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(?:[A-Za-z_][\w.-]*:)?(?:script|style)\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?(?:script|style)\s*>/gi,
      '',
    );
}

function extractTagged(source: string, local: string): string[] {
  const open = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${local}\\b([^>]*?)(/?)>`, 'gi');
  const close = new RegExp(`</(?:[A-Za-z_][\\w.-]*:)?${local}\\s*>`, 'i');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = open.exec(source)) !== null) {
    if (m[2] === '/') continue;
    const start = open.lastIndex;
    const rest = source.slice(start);
    const end = close.exec(rest);
    if (end === null) break;
    const text = normalizeText(rest.slice(0, end.index));
    if (text.length > 0) out.push(text);
    open.lastIndex = start + end.index + end[0].length;
  }
  return out;
}

function normalizeText(inner: string): string {
  const noCdata = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const noComments = noCdata.replace(/<!--[\s\S]*?-->/g, '');
  const noTags = noComments.replace(/<[^>]+>/g, '');
  return unescapeXml(noTags)
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => fromCode(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => fromCode(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}
