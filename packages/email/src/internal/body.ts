import { type Element, type MimePart, mimeHeader, parseXml } from '@mdgate/containers';
import {
  type Block,
  heading,
  type ImageSource,
  type Inline,
  type LinkTarget,
  plain,
} from '@mdgate/document';
import { type HtmlCtx, Stylesheet, toBlocks } from '@mdgate/html';
import { decode, isAbsoluteUri, trim } from '@mdgate/utils';

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
  anchorId(raw: string): string {
    return raw;
  },
};

export function headerBlocks(fields: {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
}): Block[] {
  const blocks: Block[] = [];
  const subject = fields.subject !== undefined ? trim(fields.subject) : '';
  if (subject.length > 0) blocks.push(heading(1, [plain(subject)]));
  pushDefinition(blocks, 'From', fields.from);
  pushDefinition(blocks, 'To', fields.to);
  pushDefinition(blocks, 'Cc', fields.cc);
  pushDefinition(blocks, 'Date', fields.date);
  return blocks;
}

export function attachmentBlocks(names: string[]): Block[] {
  const files = names.map((n) => trim(n)).filter((n) => n.length > 0);
  if (files.length === 0) return [];
  return [
    heading(2, [plain('Attachments')]),
    {
      type: 'list',
      list: {
        marker: 'bullet',
        start: 1,
        items: files.map((name) => ({
          blocks: [{ type: 'paragraph', inlines: [plain(name)] }],
          checked: undefined,
          markerLabel: undefined,
        })),
      },
    },
  ];
}

export function htmlToBlocks(html: string): Block[] {
  const tree = parseHtmlTree(html);
  if (tree === undefined) return plainParagraphs(stripTags(html));
  normalizeHtmlTree(tree);
  const css = new Stylesheet();
  for (const elem of tree.descendantElems()) {
    if (elem.local === 'style') css.add(elem.text());
  }
  return toBlocks(findBodyOrRoot(tree), css, HTML_CTX);
}

export function plainParagraphs(text: string): Block[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const chunks = normalized.split(/\n{2,}/);
  const blocks: Block[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((line) => trim(line));
    while (lines.length > 0 && lines[0]!.length === 0) lines.shift();
    while (lines.length > 0 && lines[lines.length - 1]!.length === 0) lines.pop();
    if (lines.length === 0) continue;
    const inlines: Inline[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) inlines.push({ type: 'lineBreak' });
      if (lines[i]!.length > 0) inlines.push(plain(lines[i]!));
    }
    if (inlines.length > 0) blocks.push({ type: 'paragraph', inlines });
  }
  return blocks;
}

export function decodePart(part: MimePart): string {
  const raw = mimeHeader(part, 'content-type');
  let charset = 'utf-8';
  if (raw !== undefined) {
    const match = /charset\s*=\s*("?)([^";\s]+)\1/i.exec(raw);
    if (match !== null) charset = match[2]!;
  }
  return decodeBytes(part.bytes, charset);
}

export function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return decode(bytes, charset);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function pushDefinition(blocks: Block[], term: string, value: string | undefined): void {
  const text = value !== undefined ? trim(value) : '';
  if (text.length === 0) return;
  blocks.push({
    type: 'paragraph',
    inlines: [plain(term), { type: 'lineBreak' }, plain(`: ${text}`)],
  });
}

function parseHtmlTree(html: string): Element | undefined {
  const attempts = [html, `<div>${html}</div>`];
  for (const text of attempts) {
    try {
      return parseXml(new TextEncoder().encode(text));
    } catch {
      // try the next wrapper
    }
  }
  return undefined;
}

function findBodyOrRoot(tree: Element): Element {
  if (tree.local === 'body') return tree;
  const html = tree.local === 'html' ? tree : tree.childElems().find((e) => e.local === 'html');
  if (html !== undefined) {
    const body = html.childElems().find((e) => e.local === 'body');
    return body ?? html;
  }
  return tree.childElems().find((e) => e.local === 'body') ?? tree;
}

function normalizeHtmlTree(elem: Element): void {
  elem.local = elem.local.toLowerCase();
  for (const attr of elem.attrs) attr.local = attr.local.toLowerCase();
  for (const child of elem.childElems()) normalizeHtmlTree(child);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}
