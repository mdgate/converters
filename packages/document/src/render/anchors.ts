import { isAlphanumeric, toAsciiLower, trim, trimMatches } from '@mdgate/utils';
import type { Block, Document, Inline } from '../model/index.js';
import { inlinesToPlainText } from '../model/index.js';

export interface AnchorMap {
  fragment(id: string): string | undefined;
  htmlId(id: string): string | undefined;
}

interface Resolved {
  fragment: string;
  emitHtml: boolean;
}

class AnchorMapImpl implements AnchorMap {
  constructor(private readonly resolved: Map<string, Resolved>) {}

  fragment(id: string): string | undefined {
    return this.resolved.get(id)?.fragment;
  }

  htmlId(id: string): string | undefined {
    const r = this.resolved.get(id);
    return r?.emitHtml ? r.fragment : undefined;
  }
}

export function resolveAnchors(doc: Document): AnchorMap {
  const ids = new UniqueIds();
  const resolved = new Map<string, Resolved>();

  const linked = new Set<string>();
  walkBlocks(doc.blocks, (block) => collectLinkTargets(block, linked));
  for (const note of doc.notes) {
    walkBlocks(note.blocks, (block) => collectLinkTargets(block, linked));
  }

  walkBlocks(doc.blocks, (block) => {
    if (block.type !== 'heading') return;
    const slug = ids.claim(gfmSlug(inlinesToPlainText(block.content)));
    if (slug === undefined) return;
    const bind = (id: string): void => {
      if (!resolved.has(id)) {
        resolved.set(id, { fragment: slug, emitHtml: false });
      }
    };
    if (block.anchor !== undefined) bind(block.anchor);
    forEachAnchor(block.content, bind);
  });

  const assign = (id: string): void => {
    if (linked.has(id) && !resolved.has(id)) {
      const html = ids.claim(sanitizeId(id));
      if (html !== undefined) {
        resolved.set(id, { fragment: html, emitHtml: true });
      }
    }
  };
  walkBlocks(doc.blocks, (block) => bindBlockAnchors(block, assign));
  for (const note of doc.notes) {
    walkBlocks(note.blocks, (block) => bindBlockAnchors(block, assign));
  }

  return new AnchorMapImpl(resolved);
}

function collectLinkTargets(block: Block, out: Set<string>): void {
  if (block.type === 'heading') forEachLinkTarget(block.content, out);
  else if (block.type === 'paragraph') forEachLinkTarget(block.inlines, out);
}

function forEachLinkTarget(inlines: readonly Inline[], out: Set<string>): void {
  for (const inline of inlines) {
    if (inline.type === 'link') {
      if (inline.target.type === 'anchor') out.add(inline.target.id);
      forEachLinkTarget(inline.content, out);
    }
  }
}

function bindBlockAnchors(block: Block, assign: (id: string) => void): void {
  if (block.type === 'heading') forEachAnchor(block.content, assign);
  else if (block.type === 'paragraph') forEachAnchor(block.inlines, assign);
}

function walkBlocks(blocks: readonly Block[], f: (block: Block) => void): void {
  const stack: Block[] = [];
  for (let i = blocks.length - 1; i >= 0; i -= 1) stack.push(blocks[i]!);
  while (stack.length > 0) {
    const block = stack.pop()!;
    f(block);
    switch (block.type) {
      case 'list':
        for (let i = block.list.items.length - 1; i >= 0; i -= 1) {
          const itemBlocks = block.list.items[i]!.blocks;
          for (let j = itemBlocks.length - 1; j >= 0; j -= 1) stack.push(itemBlocks[j]!);
        }
        break;
      case 'table':
        for (let r = block.table.grid.length - 1; r >= 0; r -= 1) {
          const row = block.table.grid[r]!;
          for (let c = row.length - 1; c >= 0; c -= 1) {
            const slot = row[c]!;
            if (slot.type === 'origin') {
              const cellBlocks = slot.cell.blocks;
              if (cellBlocks.length === 0) continue;
              for (let j = cellBlocks.length - 1; j >= 0; j -= 1) stack.push(cellBlocks[j]!);
            }
          }
        }
        break;
      case 'blockQuote':
        for (let i = block.blocks.length - 1; i >= 0; i -= 1) stack.push(block.blocks[i]!);
        break;
      default:
        break;
    }
  }
}

function forEachAnchor(inlines: readonly Inline[], f: (id: string) => void): void {
  for (const inline of inlines) {
    if (inline.type === 'anchor') f(inline.id);
    else if (inline.type === 'link') forEachAnchor(inline.content, f);
  }
}

class UniqueIds {
  private readonly used = new Set<string>();
  private readonly nextSuffix = new Map<string, number>();

  claim(base: string): string | undefined {
    if (!this.used.has(base)) {
      this.used.add(base);
      if (!this.nextSuffix.has(base)) this.nextSuffix.set(base, 1);
      return base;
    }
    let n = this.nextSuffix.get(base) ?? 1;
    for (;;) {
      const candidate = `${base}-${n}`;
      if (n >= Number.MAX_SAFE_INTEGER) return undefined;
      n += 1;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        this.nextSuffix.set(base, n);
        if (!this.nextSuffix.has(candidate)) this.nextSuffix.set(candidate, 1);
        return candidate;
      }
    }
  }
}

/**
 * GFM-style heading slugs: full-Unicode lowercase, spaces become hyphens,
 * and everything except word-forming characters (letters, numbers, marks,
 * connector punctuation) and hyphens drops. An empty result becomes
 * `section` so the anchor stays linkable.
 */
export function gfmSlug(text: string): string {
  let slug = '';
  for (const c of trim(text)) {
    for (const lc of c.toLowerCase()) {
      if (lc === ' ') slug += '-';
      else if (lc === '-') slug += lc;
      else if (isAlphanumeric(lc) || isCombiningMark(lc) || isConnectorPunctuation(lc)) {
        slug += lc;
      }
    }
  }
  return slug.length === 0 ? 'section' : slug;
}

function isCombiningMark(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x0483 && cp <= 0x0489) ||
    (cp >= 0x0900 && cp <= 0x0903) ||
    (cp >= 0x093a && cp <= 0x094f) ||
    (cp >= 0x0951 && cp <= 0x0957) ||
    (cp >= 0x0962 && cp <= 0x0963) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

function isConnectorPunctuation(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  return (
    cp === 0x005f ||
    cp === 0x203f ||
    cp === 0x2040 ||
    cp === 0x2054 ||
    cp === 0xfe33 ||
    cp === 0xfe34 ||
    (cp >= 0xfe4d && cp <= 0xfe4f) ||
    cp === 0xff3f
  );
}

/** Sanitize a source anchor id into a stable `[a-z0-9-_]` HTML id. */
function sanitizeId(id: string): string {
  let out = '';
  let prevDash = false;
  for (const c of id) {
    const lower = toAsciiLower(c);
    const mapped =
      (lower >= 'a' && lower <= 'z') ||
      (lower >= '0' && lower <= '9') ||
      lower === '_' ||
      lower === '-'
        ? lower
        : '-';
    if (mapped === '-' && prevDash) continue;
    prevDash = mapped === '-';
    out += mapped;
  }
  const trimmed = trimMatches(out, '-');
  return trimmed.length === 0 ? 'anchor' : trimmed;
}
