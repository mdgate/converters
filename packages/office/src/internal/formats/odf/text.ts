/** Block and inline walking for ODF text content. */

import { type AssetSink, mediaTypeFor } from '../../common/assets.js';
import { StyledRun } from '../../common/blockstyle.js';
import { mergeDelta, rebaseEmphasis, resolveDelta, type StyleDelta } from '../../common/delta.js';
import { compositeLabel } from '../../common/numbering.js';
import { cleanText, collapseWs } from '../../common/text.js';
import { isAbsoluteUri } from '../../common/uri.js';
import { warn } from '../../log.js';
import {
  type Block,
  type ImageSource,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  type LinkTarget,
  type List,
  markerIsOrdered,
  markerLabel,
  type Note,
  type Style,
} from '../../model/index.js';
import type { Package } from '../../package/archive.js';
import { decodeFragment, resolve, type Target } from '../../package/path.js';
import { type Element, ns } from '../../package/xml.js';
import { LIST_LEVELS, listLevelPattern, type OdfStyles, parseStart } from './styles.js';
import { parseTable } from './table.js';

const PLAIN: Style = { bold: false, italic: false, strike: false, code: false };

export class Ctx {
  readonly styles: OdfStyles;
  readonly pkg: Package;
  readonly assets: AssetSink;
  notes: Note[] = [];
  /** Continuation counters per (list style, depth). */
  readonly listCounters = new Map<string, number>();
  /** Next number per list `xml:id`, resolved by `text:continue-list`. */
  readonly listIds = new Map<string, number>();
  /** Heading numbering state for `text:outline-style` (values, started). */
  readonly headingValues: number[] = Array.from({ length: LIST_LEVELS }, () => 0);
  readonly headingStarted: boolean[] = Array.from({ length: LIST_LEVELS }, () => false);

  constructor(styles: OdfStyles, pkg: Package, assets: AssetSink) {
    this.styles = styles;
    this.pkg = pkg;
    this.assets = assets;
  }
}

export function parseContainer(parent: Element, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  const run = new StyledRun();
  for (const child of parent.childElems()) {
    parseBlockElem(child, ctx, blocks, run);
  }
  run.flush(blocks);
  return blocks;
}

function parseBlockElem(elem: Element, ctx: Ctx, blocks: Block[], run: StyledRun): void {
  const inText = elem.ns === ns.TEXT;
  if (inText) {
    if (!elem.is(ns.TEXT, 'p')) run.flush(blocks);
    switch (elem.local) {
      case 'h': {
        const raw = elem.attr(ns.TEXT, 'outline-level');
        const parsed = raw !== undefined ? parseDecimalU8(raw) : undefined;
        const level = parsed ?? 1;
        const [inlines, boxes] = parseInlineContent(elem, ctx);
        if (!inlinesAreEmpty(inlines)) {
          const content = inlines;
          rebaseEmphasis(content, resolveDelta(paragraphBase(elem, ctx)));
          const anchor = inlinesToPlainText(content);
          const label = headingLabel(elem, level, ctx);
          if (label !== undefined) {
            content.unshift({ type: 'text', text: label, style: { ...PLAIN } });
          }
          blocks.push({ type: 'heading', level, anchor, content });
        }
        blocks.push(...boxes);
        return;
      }
      case 'p': {
        const [inlines, boxes] = parseInlineContent(elem, ctx);
        const styleName = elem.attr(ns.TEXT, 'style-name');
        const style = styleName !== undefined ? ctx.styles.blockStyle(styleName) : undefined;
        if (style !== undefined) {
          run.push(style, inlines, blocks);
        } else {
          run.flush(blocks);
          blocks.push({ type: 'paragraph', inlines });
        }
        if (boxes.length > 0) {
          run.flush(blocks);
          blocks.push(...boxes);
        }
        return;
      }
      case 'list':
        blocks.push(...parseList(elem, ctx, 0, undefined, []));
        return;
      case 'section':
      case 'index-body':
      case 'index-title':
        blocks.push(...parseContainer(elem, ctx));
        return;
      case 'table-of-content':
      case 'alphabetical-index':
      case 'bibliography':
      case 'illustration-index':
        blocks.push(...parseContainer(elem, ctx));
        return;
      default:
        return;
    }
  }
  if (elem.is(ns.TABLE, 'table')) {
    run.flush(blocks);
    blocks.push(...parseTable(elem, ctx));
  }
}

/**
 * One `text:list` → blocks. List headers render without markers; every
 * `text:start-value` restart after the first item splits the run.
 */
function parseList(
  elem: Element,
  ctx: Ctx,
  depth: number,
  inheritedStyle: string | undefined,
  ancestors: readonly number[],
): Block[] {
  const styleName = elem.attr(ns.TEXT, 'style-name') ?? inheritedStyle;
  const level = ctx.styles.listLevel(styleName ?? '', depth);
  const ordered = markerIsOrdered(level.marker);

  const counterKey = `${styleName ?? ''}\0${depth}`;
  let start = level.start;
  if (ordered) {
    const target = elem.attr(ns.TEXT, 'continue-list');
    if (target !== undefined) {
      const resume = ctx.listIds.get(target);
      if (resume !== undefined) start = resume;
    } else if (elem.attr(ns.TEXT, 'continue-numbering') === 'true') {
      const resume = ctx.listCounters.get(counterKey);
      if (resume !== undefined) start = resume;
    }
  }

  const out: Block[] = [];
  let current: List = { marker: level.marker, start, items: [] };
  let next = start;
  let firstItem = true;

  const flush = (newStart: number): void => {
    const done = current;
    current = { marker: current.marker, start: newStart, items: [] };
    if (done.items.length > 0) out.push({ type: 'list', list: done });
  };

  for (const item of elem.childElems()) {
    const header = item.is(ns.TEXT, 'list-header');
    if (!(header || item.is(ns.TEXT, 'list-item'))) continue;
    if (!header && ordered) {
      const svRaw = item.attr(ns.TEXT, 'start-value');
      const sv = svRaw !== undefined ? parseStart(svRaw) : undefined;
      if (sv !== undefined) {
        if (firstItem) current.start = sv;
        else flush(sv);
      }
    }
    const number = saturatingAdd(current.start, current.items.length);
    const chain = ancestors.concat(number);
    const itemBlocks: Block[] = [];
    const itemRun = new StyledRun();
    for (const child of item.childElems()) {
      if (child.is(ns.TEXT, 'list')) {
        itemRun.flush(itemBlocks);
        itemBlocks.push(...parseList(child, ctx, depth + 1, styleName, chain));
      } else {
        parseBlockElem(child, ctx, itemBlocks, itemRun);
      }
    }
    itemRun.flush(itemBlocks);
    if (header) {
      flush(next);
      out.push(...itemBlocks);
      continue;
    }
    firstItem = false;
    const label = itemLabel(ctx, styleName, depth, chain);
    current.items.push({ blocks: itemBlocks, checked: undefined, markerLabel: label });
    next = saturatingAdd(current.start, current.items.length);
  }
  flush(next);
  if (ordered && out.length > 0) {
    ctx.listCounters.set(counterKey, next);
    const id = elem.attrQualified(ns.XML, 'id');
    if (id !== undefined) ctx.listIds.set(id, next);
  }
  return out;
}

/**
 * A list item's composite marker label; `undefined` when the default `n.`
 * label is faithful.
 */
function itemLabel(
  ctx: Ctx,
  styleName: string | undefined,
  depth: number,
  chain: readonly number[],
): string | undefined {
  if (styleName === undefined) return undefined;
  const levels = ctx.styles.listLevels(styleName);
  if (levels === undefined) return undefined;
  const d = Math.min(depth, LIST_LEVELS - 1);
  const lvl = levels[d]!;
  if (!markerIsOrdered(lvl.marker)) return undefined;
  return compositeLabel(
    listLevelPattern(lvl, d),
    lvl.marker,
    chain[chain.length - 1] ?? 1,
    (l) => levels[Math.min(l, LIST_LEVELS - 1)]!.marker,
    (l) => chain[l] ?? levels[Math.min(l, LIST_LEVELS - 1)]!.start,
  );
}

/**
 * ODF heading numbering. Advances the outline sequence; `undefined` for
 * unnumbered headings.
 */
function headingLabel(elem: Element, level: number, ctx: Ctx): string | undefined {
  const levels = ctx.styles.outlineLevels();
  if (levels === undefined) return undefined;
  const idx = Math.min(Math.max(level, 1) - 1, LIST_LEVELS - 1);
  const lvl = levels[idx]!;
  if (!markerIsOrdered(lvl.marker)) return undefined;
  if (elem.attr(ns.TEXT, 'is-list-header') === 'true') return undefined;
  const values = ctx.headingValues;
  const started = ctx.headingStarted;
  const restart = elem.attr(ns.TEXT, 'restart-numbering') === 'true';
  const explicitRaw = elem.attr(ns.TEXT, 'start-value');
  const explicit = explicitRaw !== undefined ? parseStart(explicitRaw) : undefined;
  let value: number;
  if (explicit !== undefined) value = explicit;
  else if (started[idx] && !restart) value = saturatingAdd(values[idx]!, 1);
  else value = lvl.start;
  values[idx] = value;
  started[idx] = true;
  for (let i = idx + 1; i < started.length; i += 1) started[i] = false;
  const label = compositeLabel(
    listLevelPattern(lvl, idx),
    lvl.marker,
    value,
    (l) => levels[Math.min(l, LIST_LEVELS - 1)]!.marker,
    (l) => {
      const li = Math.min(l, LIST_LEVELS - 1);
      return started[li] ? values[li]! : levels[li]!.start;
    },
  );
  return `${label ?? markerLabel(lvl.marker, value)} `;
}

function parseInlineContent(elem: Element, ctx: Ctx): [Inline[], Block[]] {
  const base = paragraphBase(elem, ctx);
  const out: Inline[] = [];
  const boxes: Block[] = [];
  walkInlines(elem, ctx, base, out, boxes);
  return [out, boxes];
}

/** The style a paragraph's runs cascade from. */
function paragraphBase(elem: Element, ctx: Ctx): StyleDelta {
  return ctx.styles.delta('paragraph', elem.attr(ns.TEXT, 'style-name') ?? '');
}

function walkInlines(
  elem: Element,
  ctx: Ctx,
  delta: StyleDelta,
  out: Inline[],
  boxes: Block[],
): void {
  const style = resolveDelta(delta);
  for (const node of elem.children) {
    if (node.type === 'text') {
      const text = collapseWs(cleanText(node.text));
      if (text.length > 0) {
        out.push({ type: 'text', text, style: { ...style } });
      }
      continue;
    }
    const child = node.elem;
    const inText = child.ns === ns.TEXT;
    if (inText) {
      switch (child.local) {
        case 'span': {
          const name = child.attr(ns.TEXT, 'style-name');
          const merged =
            name !== undefined ? mergeDelta(delta, ctx.styles.delta('text', name)) : delta;
          walkInlines(child, ctx, merged, out, boxes);
          continue;
        }
        case 'a': {
          const href = child.attr(ns.XLINK, 'href') ?? '';
          const content: Inline[] = [];
          walkInlines(child, ctx, delta, content, boxes);
          const target = classifyHref(href);
          if (target !== undefined && !inlinesAreEmpty(content)) {
            out.push({ type: 'link', content, target });
          } else {
            out.push(...content);
          }
          continue;
        }
        case 's': {
          const raw = child.attr(ns.TEXT, 'c');
          const parsed = raw !== undefined ? parseDecimalU64(raw) : undefined;
          const n = Math.min(parsed ?? 1, 20);
          out.push({ type: 'text', text: ' '.repeat(n), style: { ...PLAIN } });
          continue;
        }
        case 'tab':
          out.push({ type: 'text', text: ' ', style: { ...PLAIN } });
          continue;
        case 'line-break':
          out.push({ type: 'lineBreak' });
          continue;
        case 'bookmark':
        case 'bookmark-start': {
          const name = child.attr(ns.TEXT, 'name');
          if (name !== undefined) out.push({ type: 'anchor', id: name });
          continue;
        }
        case 'note': {
          const idx = ctx.notes.length;
          const id = child.attr(ns.TEXT, 'id') ?? `odt${idx}`;
          const kind = child.attr(ns.TEXT, 'note-class') === 'endnote' ? 'endnote' : 'footnote';
          const body = child.find(ns.TEXT, 'note-body');
          const noteBlocks = body !== undefined ? parseContainer(body, ctx) : [];
          ctx.notes.push({ id, kind, blocks: noteBlocks });
          out.push({ type: 'noteRef', id });
          continue;
        }
        case 'annotation':
        case 'tracked-changes':
        case 'soft-page-break':
          continue;
        default:
          break;
      }
    }
    if (child.is(ns.DRAW, 'frame')) {
      walkFrame(child, ctx, out, boxes);
      continue;
    }
    walkInlines(child, ctx, delta, out, boxes);
  }
}

/**
 * A draw:frame inline in text: an image (resolved into the asset store) or
 * a text box (attached as blocks after the paragraph).
 */
export function walkFrame(frame: Element, ctx: Ctx, out: Inline[], boxes: Block[]): void {
  const textBox = frame.find(ns.DRAW, 'text-box');
  if (textBox !== undefined) {
    boxes.push(...parseContainer(textBox, ctx));
    return;
  }
  const title = frame.firstDescendant(ns.SVG_COMPAT, 'title');
  const desc = title === undefined ? frame.firstDescendant(ns.SVG_COMPAT, 'desc') : undefined;
  const rawAlt = (title ?? desc)?.text() ?? '';
  const alt = cleanText(rawAlt.trim());
  const image = frame.firstDescendant(ns.DRAW, 'image');
  if (image !== undefined) {
    const href = image.attr(ns.XLINK, 'href') ?? '';
    const source = loadImage(ctx, href);
    if (source !== undefined || alt.length > 0) {
      out.push({ type: 'image', alt, source: source ?? { type: 'unavailable' } });
    }
    return;
  }
  if (alt.length > 0) {
    out.push({ type: 'image', alt, source: { type: 'unavailable' } });
  }
}

/**
 * Failures degrade (log + `undefined`) per the unified policy; resource-limit
 * errors always propagate.
 */
function loadImage(ctx: Ctx, href: string): ImageSource | undefined {
  if (href.length === 0) return undefined;
  if (isAbsoluteUri(href)) return { type: 'external', url: href };
  let target: Target;
  try {
    target = resolve('content.xml', href);
  } catch (e) {
    warn(
      `skipping unresolvable image reference ${JSON.stringify(href)}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  const bytes = ctx.pkg.optionalPart(target.path);
  if (bytes !== undefined) {
    const media = mediaTypeFor(target.path);
    const id = ctx.assets.add(media, target.path, bytes);
    return { type: 'asset', id };
  }
  warn(`image part ${target.path} is missing`);
  return undefined;
}

/**
 * ODF hrefs: external URLs, package-relative paths, or `#target` internal
 * references (with `|outline`-style suffixes on generated links).
 */
export function classifyHref(href: string): LinkTarget | undefined {
  if (href.length === 0) return undefined;
  if (href.startsWith('#')) {
    const fragment = href.slice(1);
    const target = fragment.split('|')[0] ?? fragment;
    if (target.length === 0) return undefined;
    return { type: 'anchor', id: decodeFragment(target) };
  }
  if (isAbsoluteUri(href)) return { type: 'external', url: href };
  return { type: 'relative', url: href };
}

function parseDecimalU8(v: string): number | undefined {
  if (v.length === 0 || !/^[0-9]+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n > 255) return undefined;
  return n;
}

function parseDecimalU64(v: string): number | undefined {
  if (v.length === 0 || !/^[0-9]+$/.test(v)) return undefined;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    return undefined;
  }
  if (n > 0xffff_ffff_ffff_ffffn) return undefined;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(n);
}

function saturatingAdd(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s) || s > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return s;
}
