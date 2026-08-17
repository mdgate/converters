import type { Element } from '@mdgate/containers';
import {
  type AnchorId,
  type Block,
  cellSpanning,
  GridBuilder,
  type ImageSource,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  type LinkTarget,
  type List,
  type ListItem,
  type MarkerKind,
  plain,
  resolveHeaderRows,
} from '@mdgate/document';
import {
  deltasEqual,
  emptyDelta,
  mergeDelta,
  rebaseEmphasis,
  resolveDelta,
  type StyleDelta,
} from '@mdgate/office-common';
import { cleanText, collapseWs, trim } from '@mdgate/utils';

/** Frontend hooks: how hrefs, image sources, and anchor ids resolve. */
export interface HtmlCtx {
  linkTarget(href: string): LinkTarget | undefined;
  imageSource(src: string): ImageSource | undefined;
  anchorId(raw: string): AnchorId;
}

export function toBlocks(body: Element, css: Stylesheet, ctx: HtmlCtx): Block[] {
  const builder = new Builder(css, ctx, true);
  builder.walkChildren(body, emptyDelta());
  return builder.finish();
}

export interface StyleProps {
  delta: StyleDelta;
  hidden: boolean | undefined;
}

const EMPTY_DELTA: StyleDelta = {
  bold: undefined,
  italic: undefined,
  strike: undefined,
  code: undefined,
};
const EMPTY_PROPS: StyleProps = { delta: EMPTY_DELTA, hidden: undefined };

function emptyProps(): StyleProps {
  return { delta: emptyDelta(), hidden: undefined };
}

function mergeProps(base: StyleProps, over: StyleProps): StyleProps {
  return {
    delta: mergeDelta(base.delta, over.delta),
    hidden: over.hidden ?? base.hidden,
  };
}

function propsAreDefault(p: StyleProps): boolean {
  return deltasEqual(p.delta, EMPTY_DELTA) && p.hidden === undefined;
}

const INLINE_PRIORITY = 100_000;
const IMPORTANT_PRIORITY = 1_000_000;

interface Rule {
  tag: string | undefined;
  className: string | undefined;
  priority: number;
  props: StyleProps;
}

interface DeclProps {
  normal: StyleProps;
  important: StyleProps;
}

const EMPTY_MATCHES: Array<[number, StyleProps]> = [];
const EMPTY_CLASSES: string[] = [];

export class Stylesheet {
  private readonly rules: Rule[] = [];

  get isEmpty(): boolean {
    return this.rules.length === 0;
  }

  /** Share already-parsed rules (rules are immutable after `add`). */
  addFrom(other: Stylesheet): void {
    const src = other.rules;
    for (let i = 0; i < src.length; i += 1) this.rules.push(src[i]!);
  }

  add(css: string): void {
    if (css.length === 0) return;
    const stripped = stripCssComments(css);
    if (stripped.length === 0) return;
    for (const chunk of stripped.split('}')) {
      const brace = chunk.indexOf('{');
      if (brace < 0) continue;
      const body = chunk.slice(brace + 1);
      if (!chunkMayHaveSemantic(body)) continue;
      const decls = parseDeclarations(body);
      if (propsAreDefault(decls.normal) && propsAreDefault(decls.important)) continue;
      const selectors = chunk.slice(0, brace);
      for (const selector of selectors.split(',')) {
        const s = selector.trim();
        if (s.length === 0 || s.includes(' ') || s.includes(':') || s.includes('[')) continue;
        const dot = s.indexOf('.');
        let tag: string | undefined;
        let className: string | undefined;
        if (dot >= 0) {
          const t = s.slice(0, dot);
          tag = t.length === 0 ? undefined : t.toLowerCase();
          className = s.slice(dot + 1);
        } else {
          tag = s.toLowerCase();
        }
        const specificity = (className !== undefined ? 10 : 0) + (tag !== undefined ? 1 : 0);
        if (!propsAreDefault(decls.normal)) {
          this.rules.push({ tag, className, priority: specificity, props: decls.normal });
        }
        if (!propsAreDefault(decls.important)) {
          this.rules.push({
            tag,
            className,
            priority: IMPORTANT_PRIORITY + specificity,
            props: decls.important,
          });
        }
      }
    }
  }

  matchingRules(tag: string, classes: string[]): Array<[number, StyleProps]> {
    const rules = this.rules;
    if (rules.length === 0) return EMPTY_MATCHES;
    const out: Array<[number, StyleProps]> = [];
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i]!;
      if (rule.tag !== undefined && rule.tag !== tag) continue;
      if (rule.className !== undefined && !classes.includes(rule.className)) continue;
      out.push([rule.priority, rule.props]);
    }
    return out;
  }
}

function chunkMayHaveSemantic(body: string): boolean {
  return (
    body.includes('display') ||
    body.includes('font-weight') ||
    body.includes('font-style') ||
    body.includes('text-decoration')
  );
}

function stripCssComments(css: string): string {
  const first = css.indexOf('/*');
  if (first < 0) return css;
  const parts: string[] = [];
  let i = 0;
  let start = first;
  while (start >= 0) {
    if (start > i) parts.push(css.slice(i, start));
    const end = css.indexOf('*/', start + 2);
    if (end < 0) return parts.join('');
    i = end + 2;
    start = css.indexOf('/*', i);
  }
  if (i < css.length) parts.push(css.slice(i));
  return parts.join('');
}

function parseDeclarations(body: string): DeclProps {
  const out: DeclProps = { normal: emptyProps(), important: emptyProps() };
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim().toLowerCase();
    let value = decl
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    let important = false;
    const bang = value.indexOf('!');
    if (bang >= 0) {
      if (value.slice(bang + 1).trim() === 'important') important = true;
      value = value.slice(0, bang).trimEnd();
    }
    const props = important ? out.important : out.normal;
    switch (name) {
      case 'font-weight': {
        const n = parseU32(value);
        props.delta.bold = value === 'bold' || value === 'bolder' || (n !== undefined && n >= 600);
        break;
      }
      case 'font-style':
        props.delta.italic = value === 'italic' || value === 'oblique';
        break;
      case 'text-decoration':
      case 'text-decoration-line':
        if (value.includes('line-through')) props.delta.strike = true;
        else if (value === 'none') props.delta.strike = false;
        break;
      case 'display':
        props.hidden = value === 'none';
        break;
      default:
        break;
    }
  }
  return out;
}

function parseU32(s: string): number | undefined {
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return undefined;
  return n;
}

class Builder {
  blocks: Block[] = [];
  inlines: Inline[] = [];
  readonly css: Stylesheet;
  readonly ctx: HtmlCtx;
  startBoundary: boolean;

  constructor(css: Stylesheet, ctx: HtmlCtx, startBoundary: boolean) {
    this.css = css;
    this.ctx = ctx;
    this.startBoundary = startBoundary;
  }

  finish(): Block[] {
    this.flushParagraph();
    return this.blocks;
  }

  private subBlocks(elem: Element, delta: StyleDelta): Block[] {
    return this.subBlocksAt(elem, delta, true);
  }

  private subBlocksAt(elem: Element, delta: StyleDelta, startBoundary: boolean): Block[] {
    const b = new Builder(this.css, this.ctx, startBoundary);
    b.walkChildren(elem, delta);
    return b.finish();
  }

  private elementProps(elem: Element): StyleProps {
    const style = elem.attrAny('style');
    if (this.css.isEmpty && style === undefined) return EMPTY_PROPS;
    const classAttr = elem.attrAny('class');
    const classes =
      classAttr !== undefined && classAttr.length > 0
        ? classAttr.split(/\s+/).filter((c) => c.length > 0)
        : EMPTY_CLASSES;
    const entries = this.css.matchingRules(elem.local, classes);
    if (style !== undefined) {
      const decls = parseDeclarations(style);
      entries.push([INLINE_PRIORITY, decls.normal]);
      entries.push([IMPORTANT_PRIORITY + INLINE_PRIORITY, decls.important]);
    }
    if (entries.length === 0) return EMPTY_PROPS;
    if (entries.length === 1) return mergeProps(EMPTY_PROPS, entries[0]![1]);
    entries.sort((a, b) => a[0] - b[0]);
    let props = emptyProps();
    for (let i = 0; i < entries.length; i += 1) props = mergeProps(props, entries[i]![1]);
    return props;
  }

  private pushAnchor(elem: Element): void {
    const id = elem.attrAny('id');
    if (id !== undefined && id.length > 0) {
      this.inlines.push({ type: 'anchor', id: this.ctx.anchorId(id) });
    }
    if (elem.local === 'a') {
      const name = elem.attrAny('name');
      if (name !== undefined && name.length > 0) {
        this.inlines.push({ type: 'anchor', id: this.ctx.anchorId(name) });
      }
    }
  }

  walkChildren(elem: Element, delta: StyleDelta): void {
    for (const node of elem.children) {
      if (node.type === 'text') this.pushText(node.text, delta);
      else this.walkElem(node.elem, delta);
    }
  }

  private pushText(text: string, delta: StyleDelta): void {
    const collapsed = collapseWs(cleanText(text));
    if (collapsed.length === 0) return;
    let next = collapsed;
    if (atSpaceBoundary(this.inlines, this.startBoundary)) {
      next = trimStartChar(collapsed, ' ');
    }
    if (next.length === 0) return;
    this.inlines.push({ type: 'text', text: next, style: resolveDelta(delta) });
  }

  private walkElem(elem: Element, delta: StyleDelta): void {
    const props = this.elementProps(elem);
    if (props.hidden === true) return;
    delta = mergeDelta(mergeInlineTag(elem, delta), props.delta);
    const name = elem.local;
    if (
      name === 'h1' ||
      name === 'h2' ||
      name === 'h3' ||
      name === 'h4' ||
      name === 'h5' ||
      name === 'h6'
    ) {
      this.flushParagraph();
      const level = Number.parseInt(name.slice(1), 10) || 1;
      const content = this.inlineChildren(elem, delta);
      rebaseEmphasis(content, resolveDelta(delta));
      const id = elem.attrAny('id');
      const anchor = id !== undefined ? this.ctx.anchorId(id) : undefined;
      if (!inlinesAreEmpty(content)) {
        this.blocks.push({ type: 'heading', level, anchor, content });
      } else {
        const kept: Inline[] = [];
        if (anchor !== undefined) kept.push({ type: 'anchor', id: anchor });
        for (const i of content) {
          if (i.type === 'anchor') kept.push(i);
        }
        if (kept.length > 0) this.blocks.push({ type: 'paragraph', inlines: kept });
      }
      return;
    }
    if (name === 'p') {
      this.flushParagraph();
      this.pushAnchor(elem);
      const content = this.inlines.splice(0, this.inlines.length);
      content.push(...this.inlineChildren(elem, delta));
      if (keepsParagraph(content)) this.blocks.push({ type: 'paragraph', inlines: content });
      return;
    }
    if (name === 'ul' || name === 'ol') {
      this.flushParagraph();
      this.blocks.push(...this.parseList(elem, delta));
      return;
    }
    if (name === 'table') {
      this.flushParagraph();
      const caption = elem.childElems().find((e) => e.local === 'caption');
      if (caption !== undefined) {
        const content = this.inlineChildren(caption, delta);
        if (keepsParagraph(content)) this.blocks.push({ type: 'paragraph', inlines: content });
      }
      const t = this.parseTable(elem, delta);
      if (t !== undefined) this.blocks.push(t);
      return;
    }
    if (name === 'blockquote') {
      this.flushParagraph();
      const inner = this.subBlocks(elem, delta);
      if (inner.length > 0) this.blocks.push({ type: 'blockQuote', blocks: inner });
      return;
    }
    if (name === 'pre') {
      this.flushParagraph();
      const text = elem.text();
      if (trim(text).length > 0) {
        this.blocks.push({ type: 'codeBlock', lang: undefined, text });
      }
      return;
    }
    if (name === 'hr') {
      this.flushParagraph();
      this.blocks.push({ type: 'rule' });
      return;
    }
    if (isContainerTag(name)) {
      this.pushAnchor(elem);
      if (hasBlockChildren(elem)) {
        this.flushParagraph();
        this.walkChildren(elem, delta);
        this.flushParagraph();
      } else {
        this.walkChildren(elem, delta);
      }
      return;
    }
    if (
      name === 'script' ||
      name === 'style' ||
      name === 'head' ||
      name === 'template' ||
      name === 'noscript'
    ) {
      return;
    }
    this.walkInline(elem, delta);
  }

  private walkInline(elem: Element, delta: StyleDelta): void {
    this.pushAnchor(elem);
    const name = elem.local;
    if (name === 'br') {
      this.inlines.push({ type: 'lineBreak' });
      return;
    }
    if (name === 'img' || name === 'image') {
      const alt = cleanText(elem.attrAny('alt') ?? '');
      const src = elem.attrAny('src') ?? elem.attrAny('href') ?? '';
      const source = this.ctx.imageSource(src);
      if (source !== undefined || trim(alt).length > 0) {
        this.inlines.push({ type: 'image', alt, source: source ?? { type: 'unavailable' } });
      }
      return;
    }
    if (name === 'a') {
      const href = elem.attrAny('href');
      const target = href !== undefined ? this.ctx.linkTarget(href) : undefined;
      const content = this.inlineChildrenAt(
        elem,
        delta,
        atSpaceBoundary(this.inlines, this.startBoundary),
      );
      if (target !== undefined) this.inlines.push({ type: 'link', content, target });
      else this.inlines.push(...content);
      return;
    }
    this.walkChildren(elem, delta);
  }

  private inlineChildren(elem: Element, delta: StyleDelta): Inline[] {
    return this.inlineChildrenAt(elem, delta, true);
  }

  private inlineChildrenAt(elem: Element, delta: StyleDelta, startBoundary: boolean): Inline[] {
    const blocks = this.subBlocksAt(elem, delta, startBoundary);
    if (blocks.length === 1 && blocks[0]!.type === 'paragraph') {
      return blocks[0]!.inlines;
    }
    const out: Inline[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
      if (i > 0) out.push({ type: 'lineBreak' });
      const block = blocks[i]!;
      if (block.type === 'paragraph') out.push(...block.inlines);
      else if (block.type === 'heading') out.push(...block.content);
      else out.push(plain(collapseWs(blockText(block))));
    }
    return out;
  }

  private parseList(elem: Element, delta: StyleDelta): Block[] {
    const ordered = elem.local === 'ol';
    const items = elem.childElems().filter((e) => e.local === 'li');
    if (items.length === 0) return [];
    if (!ordered) {
      const listItems: ListItem[] = items.map((li) => ({
        blocks: this.subBlocks(li, delta),
        checked: undefined,
        markerLabel: undefined,
      }));
      return [{ type: 'list', list: { marker: 'bullet', start: 1, items: listItems } }];
    }
    const typeAttr = elem.attrAny('type');
    let marker: MarkerKind = 'decimal';
    if (typeAttr === 'a') marker = 'lowerAlpha';
    else if (typeAttr === 'A') marker = 'upperAlpha';
    else if (typeAttr === 'i') marker = 'lowerRoman';
    else if (typeAttr === 'I') marker = 'upperRoman';
    const reversed = elem.attrAny('reversed') !== undefined;
    const startAttr = elem.attrAny('start');
    const parsedStart = startAttr !== undefined ? parseI64(startAttr) : undefined;
    let next = parsedStart ?? (reversed ? items.length : 1);
    const numbers: number[] = [];
    for (const li of items) {
      const v = li.attrAny('value');
      const parsed = v !== undefined ? parseI64(v) : undefined;
      if (parsed !== undefined) next = parsed;
      numbers.push(next);
      next = reversed ? next - 1 : next + 1;
    }
    if (numbers.some((n) => n < 1)) {
      const listItems: ListItem[] = items.map((li, i) => ({
        blocks: this.subBlocks(li, delta),
        checked: undefined,
        markerLabel: `${numbers[i]!}.`,
      }));
      return [{ type: 'list', list: { marker, start: 1, items: listItems } }];
    }
    const out: Block[] = [];
    let current: List | undefined;
    let lastNumber = 0;
    for (let i = 0; i < items.length; i += 1) {
      const number = numbers[i]!;
      const item: ListItem = {
        blocks: this.subBlocks(items[i]!, delta),
        checked: undefined,
        markerLabel: undefined,
      };
      const contiguous = current !== undefined && lastNumber + 1 === number;
      if (!contiguous) {
        if (current !== undefined) out.push({ type: 'list', list: current });
        current = { marker, start: number, items: [] };
      }
      current!.items.push(item);
      lastNumber = number;
    }
    if (current !== undefined) out.push({ type: 'list', list: current });
    return out;
  }

  private parseTable(elem: Element, delta: StyleDelta): Block | undefined {
    const rowElems: Array<[Element, boolean, number]> = [];
    let group = 0;
    let inImplicitGroup = false;
    for (const child of elem.childElems()) {
      if (child.local === 'thead' || child.local === 'tbody' || child.local === 'tfoot') {
        if (inImplicitGroup) {
          inImplicitGroup = false;
          group += 1;
        }
        const inHead = child.local === 'thead';
        for (const tr of child.childElems()) {
          if (tr.local === 'tr') rowElems.push([tr, inHead, group]);
        }
        group += 1;
      } else if (child.local === 'tr') {
        inImplicitGroup = true;
        rowElems.push([child, false, group]);
      }
    }
    if (rowElems.length === 0) return undefined;
    const groupEnd = new Map<number, number>();
    for (let i = 0; i < rowElems.length; i += 1) {
      groupEnd.set(rowElems[i]![2], i);
    }
    const builder = new GridBuilder();
    let headerRows = 0;
    for (let i = 0; i < rowElems.length; i += 1) {
      const [tr, inHead, grp] = rowElems[i]!;
      builder.nextRow();
      let allTh = true;
      let anyCell = false;
      for (const cell of tr.childElems()) {
        if (cell.local !== 'td' && cell.local !== 'th') continue;
        anyCell = true;
        if (cell.local !== 'th') allTh = false;
        const colSpan = clamp(parseU32(cell.attrAny('colspan') ?? '') ?? 1, 1, 1000);
        let rowSpan: number;
        const rawRs = cell.attrAny('rowspan');
        const parsedRs = rawRs !== undefined ? parseU32(rawRs) : undefined;
        if (parsedRs === 0) {
          rowSpan = (groupEnd.get(grp) ?? i) - i + 1;
        } else if (parsedRs !== undefined) {
          rowSpan = clamp(parsedRs, 1, 65534);
        } else {
          rowSpan = 1;
        }
        builder.place(cellSpanning(this.subBlocks(cell, delta), colSpan, rowSpan));
      }
      if (i === headerRows && (inHead || (allTh && anyCell))) headerRows += 1;
    }
    const table = builder.finish('data');
    if (table.grid.length === 0) return undefined;
    table.headerRows = resolveHeaderRows(table, headerRows);
    return { type: 'table', table };
  }

  private flushParagraph(): void {
    if (this.inlines.length > 0) {
      const inlines = this.inlines.splice(0, this.inlines.length);
      if (keepsParagraph(inlines)) this.blocks.push({ type: 'paragraph', inlines });
    }
    this.startBoundary = true;
  }
}

function mergeInlineTag(elem: Element, delta: StyleDelta): StyleDelta {
  const next = { ...delta };
  switch (elem.local) {
    case 'b':
    case 'strong':
      next.bold = true;
      break;
    case 'i':
    case 'em':
    case 'cite':
    case 'dfn':
    case 'var':
      next.italic = true;
      break;
    case 's':
    case 'del':
    case 'strike':
      next.strike = true;
      break;
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      next.code = true;
      break;
    default:
      break;
  }
  return next;
}

function blockText(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return inlinesToPlainText(block.inlines);
    case 'heading':
      return inlinesToPlainText(block.content);
    case 'list':
      return block.list.items.flatMap((it) => it.blocks.map(blockText)).join(' ');
    case 'blockQuote':
      return block.blocks.map(blockText).join(' ');
    case 'codeBlock':
      return block.text;
    case 'table':
      return block.table.grid
        .flatMap((row) =>
          row.flatMap((slot) =>
            slot.type === 'origin' ? [slot.cell.blocks.map(blockText).join(' ')] : [],
          ),
        )
        .join(' ');
    case 'rule':
      return '';
  }
}

function isContainerTag(name: string): boolean {
  return (
    name === 'div' ||
    name === 'section' ||
    name === 'article' ||
    name === 'aside' ||
    name === 'main' ||
    name === 'nav' ||
    name === 'header' ||
    name === 'footer' ||
    name === 'figure' ||
    name === 'figcaption' ||
    name === 'center' ||
    name === 'details' ||
    name === 'summary' ||
    name === 'li' ||
    name === 'dl' ||
    name === 'dt' ||
    name === 'dd' ||
    name === 'body'
  );
}

function isBlockTag(name: string): boolean {
  return (
    isContainerTag(name) ||
    name === 'p' ||
    name === 'ul' ||
    name === 'ol' ||
    name === 'table' ||
    name === 'blockquote' ||
    name === 'pre' ||
    name === 'hr' ||
    name === 'h1' ||
    name === 'h2' ||
    name === 'h3' ||
    name === 'h4' ||
    name === 'h5' ||
    name === 'h6'
  );
}

function hasBlockChildren(elem: Element): boolean {
  return elem.childElems().some((e) => isBlockTag(e.local));
}

function keepsParagraph(inlines: Inline[]): boolean {
  return !inlinesAreEmpty(inlines) || inlines.some((i) => i.type === 'anchor');
}

function atSpaceBoundary(inlines: Inline[], start: boolean): boolean {
  for (let i = inlines.length - 1; i >= 0; i -= 1) {
    const inline = inlines[i]!;
    if (inline.type === 'anchor') continue;
    if (inline.type === 'text') {
      if (inline.text.length === 0) continue;
      return isUnicodeWhitespaceCp(lastCodePoint(inline.text));
    }
    if (inline.type === 'lineBreak') return true;
    if (inline.type === 'link') {
      if (inlinesAreEmpty(inline.content)) continue;
      return atSpaceBoundary(inline.content, false);
    }
    return false;
  }
  return start;
}

function lastCodePoint(s: string): number {
  const n = s.length;
  if (n === 0) return 0;
  const c = s.charCodeAt(n - 1);
  if (c >= 0xdc00 && c <= 0xdfff && n >= 2) {
    const hi = s.charCodeAt(n - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      return ((hi - 0xd800) << 10) + (c - 0xdc00) + 0x10000;
    }
  }
  return c;
}

function isUnicodeWhitespaceCp(cp: number): boolean {
  return (
    (cp >= 0x09 && cp <= 0x0d) ||
    cp === 0x20 ||
    cp === 0x85 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  );
}

function trimStartChar(s: string, ch: string): string {
  let i = 0;
  while (i < s.length && s[i] === ch) i += 1;
  return s.slice(i);
}

function parseI64(s: string): number | undefined {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
