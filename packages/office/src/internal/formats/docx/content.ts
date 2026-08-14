//! Block and inline walking for WordprocessingML parts.

import { type AssetSink, relImageSource } from '../../common/assets.js';
import { type BlockStyle, StyledRun } from '../../common/blockstyle.js';
import { applyDelta, rebaseEmphasis } from '../../common/delta.js';
import { chartBlocks, diagramBlocks } from '../../common/drawingml.js';
import {
  classifyRelTarget,
  emptyFieldFrame,
  type FieldFrame,
  fieldResult,
} from '../../common/fields.js';
import { resolveHeaderRows } from '../../common/header.js';
import { flushList, type ListEntry, type ListKey } from '../../common/list.js';
import { alternateBranch } from '../../common/mc.js';
import { cleanText, isXmlSpace } from '../../common/text.js';
import { ConvertError } from '../../error.js';
import { debug, warn } from '../../log.js';
import {
  type Block,
  cellSpanning,
  GridBuilder,
  type ImageSource,
  type Inline,
  inlinesAreEmpty,
  type LinkTarget,
  markerIsOrdered,
  markerLabel,
  PLAIN,
  type Style,
} from '../../model/index.js';
import type { Package } from '../../package/archive.js';
import { type Relationships, type RelTarget, relTargetBytes } from '../../package/relationships.js';
import { type Element, ns, parseXml } from '../../package/xml.js';
import { trim } from '../../unicode.js';
import { type Counters, LEVELS, type Numbering } from './numbering.js';
import {
  applyTogglesOver,
  emptyToggles,
  onOff,
  parseU8,
  parseUint,
  rprDelta,
  type Styles,
} from './styles.js';

/**
 * Namespaces whose markup this frontend understands; `mc:Choice` branches
 * requiring anything else fall back to `mc:Fallback`.
 */
const SUPPORTED_NS: readonly string[] = [
  ns.W,
  ns.A,
  ns.PIC,
  ns.WP,
  ns.MC,
  ns.CHART,
  ns.DGM,
  ns.VML,
  ns.O_VML,
  ns.WPS,
  ns.WPG,
];

export interface Ctx {
  pkg: Package;
  rels: Relationships;
  basePart: string;
  styles: Styles;
  numbering: Numbering;
  counters: Counters;
  assets: AssetSink;
}

/** The same document-wide dependencies scoped to another package part. */
export function ctxForPart(ctx: Ctx, rels: Relationships, basePart: string): Ctx {
  return {
    pkg: ctx.pkg,
    rels,
    basePart,
    styles: ctx.styles,
    numbering: ctx.numbering,
    counters: ctx.counters,
    assets: ctx.assets,
  };
}

function relPart(ctx: Ctx, relId: string): RelTarget | undefined {
  return relTargetBytes(ctx.pkg, ctx.rels, ctx.basePart, relId);
}

export type ParaKind =
  | {
      type: 'heading';
      level: number;
      /** Visible number of a numbered heading, with trailing separator. */
      label: string | undefined;
      /** The heading style's own emphasis, subtracted from its runs. */
      base: Style;
    }
  | {
      type: 'listItem';
      ilvl: number;
      key: ListKey;
      number: number;
      label: string | undefined;
    }
  | { type: 'styled'; style: BlockStyle }
  | { type: 'plain' };

/**
 * Block runs a following paragraph may extend: a list being built, and a
 * styled container. Only one is ever open, so starting either closes the
 * other.
 */
export class Runs {
  list: ListEntry[] = [];
  styled = new StyledRun();

  flush(blocks: Block[]): void {
    this.styled.flush(blocks);
    flushList(blocks, this.list);
  }
}

/** A paragraph's content in source order: inline runs interleaved with blocks. */
export type Piece = { type: 'inlines'; inlines: Inline[] } | { type: 'blocks'; blocks: Block[] };

export function parseBlocks(parent: Element, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  const runs = new Runs();
  collectBlocks(parent, ctx, blocks, runs);
  runs.flush(blocks);
  return blocks;
}

function collectBlocks(parent: Element, ctx: Ctx, blocks: Block[], runs: Runs): void {
  for (const child of parent.childElems()) {
    if (child.is(ns.MC, 'AlternateContent')) {
      const branch = alternateBranch(child, SUPPORTED_NS);
      if (branch !== undefined) collectBlocks(branch, ctx, blocks, runs);
      continue;
    }
    if (child.ns !== ns.W) continue;
    switch (child.local) {
      case 'p': {
        const { kind, pieces } = parseParagraph(child, ctx);
        emitParagraph(kind, pieces, blocks, runs);
        break;
      }
      case 'tbl': {
        runs.flush(blocks);
        blocks.push(...parseTable(child, ctx));
        break;
      }
      case 'sdt': {
        const content = child.find(ns.W, 'sdtContent');
        if (content !== undefined) collectBlocks(content, ctx, blocks, runs);
        break;
      }
      case 'customXml':
        collectBlocks(child, ctx, blocks, runs);
        break;
      default:
        break;
    }
  }
}

export function emitParagraph(kind: ParaKind, pieces: Piece[], blocks: Block[], runs: Runs): void {
  switch (kind.type) {
    case 'listItem': {
      runs.styled.flush(blocks);
      const item = piecesIntoBlocks(pieces);
      runs.list.push({
        level: kind.ilvl,
        key: kind.key,
        number: kind.number,
        label: kind.label,
        blocks: item,
      });
      break;
    }
    case 'styled': {
      flushList(blocks, runs.list);
      for (const piece of pieces) {
        if (piece.type === 'inlines') {
          runs.styled.push(kind.style, piece.inlines, blocks);
        } else {
          runs.styled.flush(blocks);
          blocks.push(...piece.blocks);
        }
      }
      break;
    }
    case 'heading': {
      runs.flush(blocks);
      let label = kind.label;
      let emittedHeading = false;
      for (const piece of pieces) {
        if (piece.type === 'inlines') {
          if (inlinesAreEmpty(piece.inlines)) continue;
          const content = piece.inlines;
          rebaseEmphasis(content, kind.base);
          if (!emittedHeading) {
            if (label !== undefined) {
              content.unshift({ type: 'text', text: label, style: { ...PLAIN } });
              label = undefined;
            }
            blocks.push({ type: 'heading', level: kind.level, anchor: undefined, content });
            emittedHeading = true;
          } else {
            blocks.push({ type: 'paragraph', inlines: content });
          }
        } else {
          blocks.push(...piece.blocks);
        }
      }
      break;
    }
    case 'plain': {
      runs.flush(blocks);
      blocks.push(...piecesIntoBlocks(pieces));
      break;
    }
  }
}

function parseParagraph(p: Element, ctx: Ctx): { kind: ParaKind; pieces: Piece[] } {
  const ppr = p.find(ns.W, 'pPr');
  const pstyleId = ppr?.find(ns.W, 'pStyle')?.attr(ns.W, 'val');

  // Direct paragraph properties overlay the style chain: an explicit
  // outlineLvl of 9 ("no outline level") turns a style heading off.
  const outlineRaw = ppr?.find(ns.W, 'outlineLvl')?.attr(ns.W, 'val');
  const outlineParsed = outlineRaw !== undefined ? parseU8(outlineRaw) : undefined;
  const directOutline =
    outlineParsed !== undefined
      ? { level: outlineParsed < 9 ? outlineParsed + 1 : undefined }
      : undefined;
  const styleHeading = pstyleId !== undefined ? ctx.styles.headingLevel(pstyleId) : undefined;
  const heading = (directOutline ?? styleHeading)?.level;
  const styleBlock = pstyleId !== undefined ? ctx.styles.blockStyle(pstyleId) : undefined;

  const numbering = resolveNumbering(ppr, pstyleId, ctx);

  const parity = pstyleId !== undefined ? ctx.styles.runToggles(pstyleId) : emptyToggles();
  const paragraphLevel = applyTogglesOver(parity, ctx.styles.docDefaults);

  let kind: ParaKind;
  if (heading !== undefined) {
    let label: string | undefined;
    if (numbering !== undefined && markerIsOrdered(numbering.key.marker)) {
      label = `${numbering.label ?? markerLabel(numbering.key.marker, numbering.number)} `;
    }
    kind = { type: 'heading', level: heading, label, base: paragraphLevel };
  } else if (numbering !== undefined) {
    kind = {
      type: 'listItem',
      ilvl: numbering.ilvl,
      key: numbering.key,
      number: numbering.number,
      label: numbering.label,
    };
  } else if (styleBlock !== undefined) {
    kind = { type: 'styled', style: styleBlock };
  } else {
    kind = { type: 'plain' };
  }

  const walker = new InlineWalker(ctx, paragraphLevel);
  walker.walk(p);
  return { kind, pieces: walker.finish() };
}

/**
 * Resolve a paragraph's effective numbering per ECMA-376: the direct
 * `numPr` children are tri-state and merge property-by-property with the
 * style-inherited `numPr` (a missing `numId`/`ilvl` inherits; an explicit
 * `numId` of 0 suppresses).
 */
function resolveNumbering(
  ppr: Element | undefined,
  pstyleId: string | undefined,
  ctx: Ctx,
): { ilvl: number; key: ListKey; number: number; label: string | undefined } | undefined {
  const direct = ppr?.find(ns.W, 'numPr');
  const directNumIdRaw = direct?.find(ns.W, 'numId')?.attr(ns.W, 'val');
  const directNumId = directNumIdRaw !== undefined ? parseUint(directNumIdRaw) : undefined;
  const directIlvlRaw = direct?.find(ns.W, 'ilvl')?.attr(ns.W, 'val');
  const directIlvl = directIlvlRaw !== undefined ? parseUint(directIlvlRaw) : undefined;

  const numId =
    directNumId !== undefined
      ? directNumId
      : pstyleId !== undefined
        ? ctx.styles.styleNumPr(pstyleId)
        : undefined;
  if (numId === undefined) return undefined;
  if (numId === 0) return undefined;
  const instance = ctx.numbering.instance(numId);
  if (instance === undefined) {
    debug(`paragraph references undefined numbering instance ${numId}`);
    return undefined;
  }
  let ilvl: number;
  if (directIlvl !== undefined) {
    ilvl = directIlvl;
  } else if (pstyleId !== undefined) {
    ilvl = ctx.styles.styleNumberingLevel(pstyleId, instance) ?? 0;
  } else {
    ilvl = 0;
  }
  const def = instance.levels[Math.min(ilvl, LEVELS - 1)]!;
  const marker = def.marker;
  if (marker === undefined) return undefined;
  let number = 0;
  let label: string | undefined;
  if (markerIsOrdered(marker)) {
    const next = ctx.counters.next(numId, ilvl, instance);
    number = next.value;
    label = next.label;
  }
  return { ilvl, key: { instance: numId, marker }, number, label };
}

class InlineWalker {
  private readonly ctx: Ctx;
  private readonly base: Style;
  private readonly pieces: Piece[] = [];
  private current: Inline[] = [];
  private readonly fields: FieldFrame[] = [];

  constructor(ctx: Ctx, base: Style) {
    this.ctx = ctx;
    this.base = base;
  }

  private push(inline: Inline): void {
    const f = this.fields[this.fields.length - 1];
    if (f?.inResult) f.inlines.push(inline);
    else if (f !== undefined) {
      /* instruction side: discard displayed content */
    } else this.current.push(inline);
  }

  /** Attach block content at the current position in run order. */
  private pushBlocks(blocks: Block[]): void {
    if (blocks.length === 0) return;
    if (this.current.length > 0) {
      this.pieces.push({ type: 'inlines', inlines: this.current });
      this.current = [];
    }
    this.pieces.push({ type: 'blocks', blocks });
  }

  walk(elem: Element): void {
    for (const child of elem.childElems()) {
      if (child.is(ns.MC, 'AlternateContent')) {
        const branch = alternateBranch(child, SUPPORTED_NS);
        if (branch !== undefined) this.walk(branch);
        continue;
      }
      if (child.ns !== ns.W) continue;
      switch (child.local) {
        case 'pPr':
          break;
        case 'r':
          this.walkRun(child);
          break;
        case 'hyperlink': {
          const target = this.hyperlinkLinkTarget(child);
          const inner = new InlineWalker(this.ctx, this.base);
          inner.walk(child);
          const { content, attachments } = splitPieces(inner.finish());
          if (target !== undefined) {
            this.push({ type: 'link', content, target });
          } else {
            for (const inline of content) this.push(inline);
          }
          this.pushBlocks(attachments);
          break;
        }
        case 'fldSimple': {
          const instr = child.attr(ns.W, 'instr') ?? '';
          const inner = new InlineWalker(this.ctx, this.base);
          inner.walk(child);
          const { content, attachments } = splitPieces(inner.finish());
          this.pushFieldResult(instr, content);
          this.pushBlocks(attachments);
          break;
        }
        case 'bookmarkStart': {
          const name = child.attr(ns.W, 'name');
          if (name !== undefined && name !== '_GoBack') {
            this.push({ type: 'anchor', id: name });
          }
          break;
        }
        case 'sdt': {
          const content = child.find(ns.W, 'sdtContent');
          if (content !== undefined) this.walk(content);
          break;
        }
        case 'smartTag':
        case 'ins':
        case 'bdo':
        case 'dir':
        case 'moveTo':
        case 'customXml':
          this.walk(child);
          break;
        default:
          break;
      }
    }
  }

  private hyperlinkLinkTarget(link: Element): LinkTarget | undefined {
    const id = link.attrQualified(ns.R, 'id');
    if (id !== undefined) {
      const rel = this.ctx.rels.get(id);
      if (rel !== undefined) {
        return classifyRelTarget(rel.mode === 'external', rel.target);
      }
    }
    const anchor = link.attr(ns.W, 'anchor');
    return anchor !== undefined ? { type: 'anchor', id: anchor } : undefined;
  }

  private walkRun(run: Element): void {
    const rpr = run.find(ns.W, 'rPr');
    let style: Style;
    if (rpr !== undefined) {
      const charId = rpr.find(ns.W, 'rStyle')?.attr(ns.W, 'val');
      const charParity = charId !== undefined ? this.ctx.styles.runToggles(charId) : emptyToggles();
      const withChar = applyTogglesOver(charParity, this.base);
      style = applyDelta(rprDelta(rpr), withChar);
    } else {
      style = this.base;
    }
    this.walkRunContent(run, style);
  }

  private walkRunContent(run: Element, style: Style): void {
    for (const child of run.childElems()) {
      if (child.is(ns.MC, 'AlternateContent')) {
        const branch = alternateBranch(child, SUPPORTED_NS);
        if (branch !== undefined) this.walkRunContent(branch, style);
        continue;
      }
      if (child.ns !== ns.W) continue;
      switch (child.local) {
        case 't': {
          // Open XML text-space contract: edge whitespace in w:t is
          // significant only under xml:space="preserve".
          const preserved = child.attrQualified(ns.XML, 'space') === 'preserve';
          const raw = child.text();
          const text = cleanText(preserved ? raw : trimXmlSpace(raw));
          if (text.length > 0) {
            this.push({ type: 'text', text, style: { ...style } });
          }
          break;
        }
        case 'tab':
        case 'ptab':
          this.push({ type: 'text', text: ' ', style: { ...PLAIN } });
          break;
        case 'br':
        case 'cr':
          this.push({ type: 'lineBreak' });
          break;
        case 'footnoteReference': {
          const id = child.attr(ns.W, 'id');
          if (id !== undefined) this.push({ type: 'noteRef', id: `fn${id}` });
          break;
        }
        case 'endnoteReference': {
          const id = child.attr(ns.W, 'id');
          if (id !== undefined) this.push({ type: 'noteRef', id: `en${id}` });
          break;
        }
        case 'drawing':
        case 'pict':
        case 'object':
          this.walkDrawing(child);
          break;
        case 'fldChar': {
          switch (child.attr(ns.W, 'fldCharType')) {
            case 'begin':
              this.fields.push(emptyFieldFrame());
              break;
            case 'separate': {
              const f = this.fields[this.fields.length - 1];
              if (f !== undefined) f.inResult = true;
              break;
            }
            case 'end': {
              const frame = this.fields.pop();
              if (frame !== undefined) this.pushFieldResult(frame.instr, frame.inlines);
              break;
            }
            default:
              break;
          }
          break;
        }
        case 'instrText': {
          const f = this.fields[this.fields.length - 1];
          if (f !== undefined) f.instr += child.text();
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Drawings, VML picts, and embedded objects: text boxes become block
   * attachments; images/charts/diagrams/objects resolve through relationships.
   */
  private walkDrawing(elem: Element): void {
    const boxes: Element[] = [];
    collectTextBoxes(elem, boxes);
    if (boxes.length > 0) {
      const blocks: Block[] = [];
      for (const tb of boxes) blocks.push(...parseBlocks(tb, this.ctx));
      this.pushBlocks(blocks);
      return;
    }

    const hits: DrawingHits = {};
    scanDrawingMeta(elem, hits);
    const descrRaw = hits.docPr?.attr(ns.WP, 'descr');
    const descr = descrRaw !== undefined ? cleanText(descrRaw) : '';

    const chartRel = hits.chart?.attrQualified(ns.R, 'id');
    if (chartRel !== undefined) {
      this.pushBlocks(this.chartBlocks(chartRel));
      return;
    }
    const dmRel = hits.relIds?.attrQualified(ns.R, 'dm');
    if (dmRel !== undefined) {
      this.pushBlocks(this.diagramBlocks(dmRel));
      return;
    }

    const ole = hits.ole;
    if (ole !== undefined) {
      const progId = ole.attr(ns.O_VML, 'ProgID') ?? 'object';
      const alt = trim(descr).length === 0 ? `Embedded object: ${progId}` : descr;
      const oleRel = ole.attrQualified(ns.R, 'id');
      let source: ImageSource = { type: 'unavailable' };
      if (oleRel !== undefined) {
        const loaded = relPart(this.ctx, oleRel);
        if (loaded !== undefined) {
          const [part, bytes] = loaded;
          source = {
            type: 'asset',
            id: this.ctx.assets.add('application/vnd.ms-ole-object', part, bytes),
          };
        }
      }
      this.push({ type: 'image', alt, source });
      return;
    }

    const blip = hits.blip;
    const imageRel =
      blip?.attrQualified(ns.R, 'embed') ??
      blip?.attrQualified(ns.R, 'link') ??
      hits.imagedata?.attrQualified(ns.R, 'id');
    if (imageRel !== undefined) {
      const source = relImageSource(
        this.ctx.pkg,
        this.ctx.rels,
        this.ctx.basePart,
        this.ctx.assets,
        imageRel,
      );
      if (source !== undefined) {
        this.push({ type: 'image', alt: descr, source });
      } else if (trim(descr).length > 0) {
        this.push({ type: 'image', alt: descr, source: { type: 'unavailable' } });
      }
      return;
    }

    if (trim(descr).length > 0) {
      this.push({ type: 'image', alt: descr, source: { type: 'unavailable' } });
    }
  }

  private chartBlocks(relId: string): Block[] {
    const loaded = relPart(this.ctx, relId);
    if (loaded === undefined) return [];
    const [part, bytes] = loaded;
    try {
      return chartBlocks(parseXml(bytes));
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(`skipping corrupt chart part ${part}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private diagramBlocks(relId: string): Block[] {
    const loaded = relPart(this.ctx, relId);
    if (loaded === undefined) return [];
    const [part, bytes] = loaded;
    try {
      return diagramBlocks(parseXml(bytes));
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(`skipping corrupt diagram part ${part}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private pushFieldResult(instr: string, content: Inline[]): void {
    for (const inline of fieldResult(instr, content)) this.push(inline);
  }

  finish(): Piece[] {
    while (this.fields.length > 0) {
      const frame = this.fields.pop()!;
      for (const inline of frame.inlines) this.push(inline);
    }
    if (this.current.length > 0) {
      this.pieces.push({ type: 'inlines', inlines: this.current });
    }
    return this.pieces;
  }
}

function splitPieces(pieces: Piece[]): { content: Inline[]; attachments: Block[] } {
  const content: Inline[] = [];
  const attachments: Block[] = [];
  for (const piece of pieces) {
    if (piece.type === 'inlines') content.push(...piece.inlines);
    else attachments.push(...piece.blocks);
  }
  return { content, attachments };
}

function piecesIntoBlocks(pieces: Piece[]): Block[] {
  const blocks: Block[] = [];
  for (const piece of pieces) {
    if (piece.type === 'inlines') blocks.push({ type: 'paragraph', inlines: piece.inlines });
    else blocks.push(...piece.blocks);
  }
  return blocks;
}

/**
 * Find text-box content (`w:txbxContent`) in a drawing or VML pict, skipping
 * `mc:Fallback` so AlternateContent shapes aren't collected twice.
 */
function collectTextBoxes(elem: Element, out: Element[]): void {
  for (const child of elem.childElems()) {
    if (child.is(ns.MC, 'Fallback')) continue;
    if (child.is(ns.W, 'txbxContent')) out.push(child);
    else collectTextBoxes(child, out);
  }
}

/** First-in-document-order drawing targets, matching `firstDescendant`. */
interface DrawingHits {
  docPr?: Element;
  chart?: Element;
  relIds?: Element;
  ole?: Element;
  blip?: Element;
  imagedata?: Element;
}

function scanDrawingMeta(elem: Element, hits: DrawingHits): void {
  const children = elem.childElems();
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    if (hits.docPr === undefined && child.is(ns.WP, 'docPr')) hits.docPr = child;
    else if (hits.chart === undefined && child.is(ns.CHART, 'chart')) hits.chart = child;
    else if (hits.relIds === undefined && child.is(ns.DGM, 'relIds')) hits.relIds = child;
    else if (hits.ole === undefined && child.is(ns.O_VML, 'OLEObject')) hits.ole = child;
    else if (hits.blip === undefined && child.is(ns.A, 'blip')) hits.blip = child;
    else if (hits.imagedata === undefined && child.is(ns.VML, 'imagedata')) hits.imagedata = child;
    if (
      hits.docPr !== undefined &&
      hits.chart !== undefined &&
      hits.relIds !== undefined &&
      hits.ole !== undefined &&
      hits.blip !== undefined &&
      hits.imagedata !== undefined
    ) {
      return;
    }
    scanDrawingMeta(child, hits);
    if (
      hits.docPr !== undefined &&
      hits.chart !== undefined &&
      hits.relIds !== undefined &&
      hits.ole !== undefined &&
      hits.blip !== undefined &&
      hits.imagedata !== undefined
    ) {
      return;
    }
  }
}

function trimXmlSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isXmlSpace(s[start]!)) start += 1;
  while (end > start && isXmlSpace(s[end - 1]!)) end -= 1;
  return s.slice(start, end);
}

// ---------------------------------------------------------------------------
// Tables

interface TcInfo {
  elem: Element | undefined;
  /** Legacy `hMerge` continuation cells folded into this origin. */
  merged: Element[];
  colSpan: number;
  rowSpan: number;
  /** vMerge continuation: this position belongs to the origin above. */
  covered: boolean;
}

function filler(): TcInfo {
  return { elem: undefined, merged: [], colSpan: 1, rowSpan: 1, covered: false };
}

/** A `w:trPr` grid filler count (`gridBefore`/`gridAfter`). */
function gridFiller(trpr: Element | undefined, name: string): number {
  const raw = trpr?.find(ns.W, name)?.attr(ns.W, 'val');
  const n = raw !== undefined ? parseUint(raw) : undefined;
  return Math.min(n ?? 0, 1000);
}

export function parseTable(tbl: Element, ctx: Ctx): Block[] {
  const matrix: TcInfo[][] = [];
  for (const tr of tbl.findAll(ns.W, 'tr')) {
    const trpr = tr.find(ns.W, 'trPr');
    const row: TcInfo[] = [];
    for (let i = 0; i < gridFiller(trpr, 'gridBefore'); i += 1) row.push(filler());
    collectRowCells(tr, row);
    for (let i = 0; i < gridFiller(trpr, 'gridAfter'); i += 1) row.push(filler());
    matrix.push(row);
  }

  // Active vertical-merge chains by grid column.
  let active = new Map<number, [number, number]>();
  for (let r = 0; r < matrix.length; r += 1) {
    let col = 0;
    const nextActive: Array<[number, [number, number]]> = [];
    for (let i = 0; i < matrix[r]!.length; i += 1) {
      const covered = matrix[r]![i]!.covered;
      const span = matrix[r]![i]!.colSpan;
      if (covered) {
        const origin = active.get(col);
        if (origin !== undefined) {
          matrix[origin[0]]![origin[1]]!.rowSpan += 1;
          for (let c = col; c < col + span; c += 1) nextActive.push([c, origin]);
        } else {
          matrix[r]![i]!.covered = false;
        }
      } else {
        for (let c = col; c < col + span; c += 1) nextActive.push([c, [r, i]]);
      }
      col += span;
    }
    active = new Map(nextActive);
  }

  // tblHeader is ST_OnOff: an explicit false value is not a header row.
  let headerRows = 0;
  for (const tr of tbl.findAll(ns.W, 'tr')) {
    const trpr = tr.find(ns.W, 'trPr');
    if (trpr !== undefined && onOff(trpr, 'tblHeader') === true) headerRows += 1;
    else break;
  }

  const builder = new GridBuilder();
  for (const row of matrix) {
    builder.nextRow();
    for (const tc of row) {
      if (tc.covered) {
        for (let i = 0; i < tc.colSpan; i += 1) builder.covered();
      } else {
        const cellBlocks: Block[] = tc.elem !== undefined ? parseBlocks(tc.elem, ctx) : [];
        for (const merged of tc.merged) cellBlocks.push(...parseBlocks(merged, ctx));
        builder.place(cellSpanning(cellBlocks, tc.colSpan, tc.rowSpan));
      }
    }
  }
  const table = builder.finish('data');
  if (table.grid.length === 0) return [];
  table.headerRows = resolveHeaderRows(table, headerRows);
  return [{ type: 'table', table }];
}

function collectRowCells(parent: Element, cells: TcInfo[]): void {
  for (const child of parent.childElems()) {
    if (child.ns !== ns.W) continue;
    switch (child.local) {
      case 'tc': {
        const tcpr = child.find(ns.W, 'tcPr');
        const vMerge = tcpr?.find(ns.W, 'vMerge');
        const covered = vMerge !== undefined && vMerge.attr(ns.W, 'val') !== 'restart';
        const spanRaw = tcpr?.find(ns.W, 'gridSpan')?.attr(ns.W, 'val');
        const parsed = spanRaw !== undefined ? parseUint(spanRaw) : undefined;
        const colSpan = Math.min(Math.max(parsed ?? 1, 1), 1000);
        const hMerge = tcpr?.find(ns.W, 'hMerge');
        const hmergeCont = hMerge !== undefined && hMerge.attr(ns.W, 'val') !== 'restart';
        if (hmergeCont) {
          const prev = cells[cells.length - 1];
          if (prev !== undefined && !prev.covered) {
            prev.colSpan += colSpan;
            prev.merged.push(child);
            break;
          }
        }
        cells.push({ elem: child, merged: [], colSpan, rowSpan: 1, covered });
        break;
      }
      case 'sdt': {
        const content = child.find(ns.W, 'sdtContent');
        if (content !== undefined) collectRowCells(content, cells);
        break;
      }
      case 'customXml':
        collectRowCells(child, cells);
        break;
      default:
        break;
    }
  }
}
