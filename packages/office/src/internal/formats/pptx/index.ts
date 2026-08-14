//! OOXML PresentationML (.pptx / .pptm / .ppsx): slides in `sldIdLst` order,
//! with the full text cascade - slide -> layout -> master placeholder /
//! `txStyles` -> presentation defaults. Speaker notes are included (fixed
//! policy), rendered as a quote after each slide's content.

import { AssetSink, relImageSource } from '../../common/assets.js';
import { applyDelta, rebaseEmphasis, resolveDelta } from '../../common/delta.js';
import { chartBlocks, diagramBlocks } from '../../common/drawingml.js';
import { classifyRelTarget } from '../../common/fields.js';
import { resolveHeaderRows } from '../../common/header.js';
import { flushList, type ListEntry } from '../../common/list.js';
import { alternateBranch } from '../../common/mc.js';
import { cleanText } from '../../common/text.js';
import { ConvertError } from '../../error.js';
import { warn } from '../../log.js';
import {
  type Block,
  cellSpanning,
  type Document,
  GridBuilder,
  type ImageSource,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  type LinkTarget,
  type Style,
} from '../../model/index.js';
import { Package, probeOle } from '../../package/archive.js';
import { resolve } from '../../package/path.js';
import {
  type Relationship,
  type Relationships,
  type RelTarget,
  readRels,
  relsPartFor,
  relTargetBytes,
  relType,
} from '../../package/relationships.js';
import { type Element, ns, parseXml } from '../../package/xml.js';
import {
  collectPlaceholders,
  LEVELS,
  type LevelStyle,
  matchPlaceholder,
  mergeTextProps,
  numWrapLabel,
  type Placeholder,
  paragraphProps,
  parseLevelStyles,
  rprDelta,
  type TextProps,
  titleClass,
} from './cascade.js';

const LAYOUT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const MASTER_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

/** Namespaces whose markup this frontend understands; `mc:Choice` branches requiring anything else fall back to `mc:Fallback`. */
const SUPPORTED_NS: readonly string[] = [ns.P, ns.A, ns.R, ns.MC];

interface LayoutInfo {
  placeholders: Placeholder[];
  masterPath: string | undefined;
}

interface MasterInfo {
  title: LevelStyle;
  body: LevelStyle;
  other: LevelStyle;
  placeholders: Placeholder[];
}

export function parse(bytes: Uint8Array): Document {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    throw probeOle(bytes) ?? e;
  }

  // OPC part discovery: the presentation part comes from the package-level
  // officeDocument relationship, with the conventional path as fallback.
  const rootRels = readRels(pkg, '_rels/.rels');
  const officeRel = rootRels.firstOfType(relType.OFFICE_DOCUMENT);
  let presPart = 'ppt/presentation.xml';
  if (officeRel !== undefined) {
    const resolved = tryResolve('', officeRel.target);
    if (resolved !== undefined) presPart = resolved;
  }
  const pres = pkg.requiredXmlPart(presPart);
  const presRels = readRels(pkg, relsPartFor(presPart));

  const defaultText = parseLevelStyles(pres.firstDescendant(ns.P, 'defaultTextStyle'));

  const sldIdLst = pres.firstDescendant(ns.P, 'sldIdLst');
  const slidePaths: string[] = [];
  if (sldIdLst !== undefined) {
    for (const s of sldIdLst.findAll(ns.P, 'sldId')) {
      const rid = s.attrQualified(ns.R, 'id');
      if (rid === undefined) continue;
      const target = presRels.internalTarget(rid);
      if (target === undefined) continue;
      const path = tryResolve(presPart, target);
      if (path !== undefined) slidePaths.push(path);
    }
  }
  if (slidePaths.length === 0) {
    throw ConvertError.malformedPart(presPart, 'presentation has no slide list');
  }

  const assets = new AssetSink();
  const layouts = new Map<string, LayoutInfo>();
  const masters = new Map<string, MasterInfo>();
  const blocks: Block[] = [];
  let failed = 0;
  const instanceCounter = { n: 0 };
  // Every slide has a start anchor id so internal slide-to-slide links
  // resolve after concatenation; the anchor node is emitted only on
  // slides some link actually targets.
  const slideAnchors = new Map<string, string>();
  for (let i = 0; i < slidePaths.length; i += 1) {
    slideAnchors.set(slidePaths[i]!, `slide-${i + 1}`);
  }
  const allRels: Relationships[] = [];
  for (const p of slidePaths) {
    allRels.push(readRels(pkg, relsPartFor(p)));
  }
  const targeted = new Set<string>();
  for (let i = 0; i < slidePaths.length; i += 1) {
    const p = slidePaths[i]!;
    const rels = allRels[i]!;
    for (const [, r] of rels.entries()) {
      if (r.relType !== SLIDE_REL || r.mode !== 'internal') continue;
      const t = tryResolve(p, r.target);
      if (t !== undefined && slideAnchors.has(t)) targeted.add(t);
    }
  }

  for (let slideIndex = 0; slideIndex < slidePaths.length; slideIndex += 1) {
    const slidePath = slidePaths[slideIndex]!;
    const tree = pkg.optionalXmlPart(slidePath);
    if (tree === undefined) {
      warn(`skipping unusable slide ${slidePath}`);
      failed += 1;
      continue;
    }
    const spTree = tree.find(ns.P, 'sld')?.find(ns.P, 'cSld')?.find(ns.P, 'spTree');
    if (spTree === undefined) {
      warn(`skipping slide ${slidePath}: no shape tree`);
      failed += 1;
      continue;
    }
    const slideRels = allRels[slideIndex]!;

    const layoutPath = relTargetOfType(slideRels, slidePath, LAYOUT_REL);
    if (layoutPath !== undefined && !layouts.has(layoutPath)) {
      const info = loadLayout(pkg, layoutPath);
      if (info.masterPath !== undefined && !masters.has(info.masterPath)) {
        masters.set(info.masterPath, loadMaster(pkg, info.masterPath));
      }
      layouts.set(layoutPath, info);
    }
    const layout = layoutPath !== undefined ? layouts.get(layoutPath) : undefined;
    const master = layout?.masterPath !== undefined ? masters.get(layout.masterPath) : undefined;

    const ctx: SlideCtx = {
      pkg,
      rels: slideRels,
      basePart: slidePath,
      assets,
      defaultText,
      layout,
      master,
      instanceCounter,
      slideAnchors,
    };
    if (targeted.has(slidePath)) {
      const anchor = slideAnchors.get(slidePath);
      if (anchor !== undefined) {
        blocks.push({ type: 'paragraph', inlines: [{ type: 'anchor', id: anchor }] });
      }
    }
    parseShapes(spTree, ctx, blocks);

    // Speaker notes, set off as a quote (fixed policy: included).
    const notesPath = relTargetOfType(slideRels, slidePath, NOTES_REL);
    const notes =
      notesPath !== undefined
        ? (() => {
            const notesTree = pkg.optionalXmlPart(notesPath);
            return notesTree !== undefined ? ([notesPath, notesTree] as const) : undefined;
          })()
        : undefined;
    if (notes !== undefined) {
      const [np, notesTree] = notes;
      const notesRels = readRels(pkg, relsPartFor(np));
      const notesCtx: SlideCtx = {
        ...ctx,
        rels: notesRels,
        basePart: np,
        layout: undefined,
        master: undefined,
      };
      const notesBlocks: Block[] = [];
      for (const sp of notesTree.descendants(ns.P, 'sp')) {
        // Keep note text bodies (real producers use a body
        // placeholder; LibreOffice writes plain text boxes) but skip
        // the slide-image and chrome placeholders.
        const phType = placeholderType(sp);
        if (
          phType === 'sldImg' ||
          phType === 'sldNum' ||
          phType === 'hdr' ||
          phType === 'ftr' ||
          phType === 'dt'
        ) {
          continue;
        }
        const tx = sp.find(ns.P, 'txBody');
        if (tx !== undefined) parseTextBody(tx, notesCtx, undefined, notesBlocks);
      }
      if (notesBlocks.length > 0) {
        blocks.push({ type: 'blockQuote', blocks: notesBlocks });
      }
    }
  }
  if (failed === slidePaths.length) {
    throw ConvertError.malformed('no slide in the presentation could be read');
  }

  return { blocks, notes: [], assets: assets.assets };
}

function relTargetOfType(rels: Relationships, base: string, relType: string): string | undefined {
  // firstOfType picks the lowest id, so duplicate relationships resolve
  // deterministically.
  const rel = rels.firstOfType(relType);
  if (rel === undefined) return undefined;
  return tryResolve(base, rel.target);
}

function loadLayout(pkg: Package, layoutPath: string): LayoutInfo {
  const tree = pkg.optionalXmlPart(layoutPath);
  const placeholders =
    tree !== undefined
      ? (() => {
          const spTree = tree.firstDescendant(ns.P, 'spTree');
          return spTree !== undefined ? collectPlaceholders(spTree) : [];
        })()
      : [];
  const rels = readRels(pkg, relsPartFor(layoutPath));
  const masterPath = relTargetOfType(rels, layoutPath, MASTER_REL);
  return { placeholders, masterPath };
}

function loadMaster(pkg: Package, masterPath: string): MasterInfo {
  const info: MasterInfo = {
    title: parseLevelStyles(undefined),
    body: parseLevelStyles(undefined),
    other: parseLevelStyles(undefined),
    placeholders: [],
  };
  const tree = pkg.optionalXmlPart(masterPath);
  if (tree !== undefined) {
    const txStyles = tree.firstDescendant(ns.P, 'txStyles');
    if (txStyles !== undefined) {
      info.title = parseLevelStyles(txStyles.find(ns.P, 'titleStyle'));
      info.body = parseLevelStyles(txStyles.find(ns.P, 'bodyStyle'));
      info.other = parseLevelStyles(txStyles.find(ns.P, 'otherStyle'));
    }
    const spTree = tree.firstDescendant(ns.P, 'spTree');
    if (spTree !== undefined) info.placeholders = collectPlaceholders(spTree);
  }
  return info;
}

interface SlideCtx {
  pkg: Package;
  rels: Relationships;
  basePart: string;
  assets: AssetSink;
  defaultText: LevelStyle;
  layout: LayoutInfo | undefined;
  master: MasterInfo | undefined;
  /** Per-text-body list instance ids, unique document-wide. */
  instanceCounter: { n: number };
  /** Slide part path -> the slide's start anchor id, for internal slide-to-slide links. */
  slideAnchors: Map<string, string>;
}

/** Slide-to-slide relationships become anchor links to the target slide's start anchor; everything else classifies as usual. */
function linkTarget(ctx: SlideCtx, rel: Relationship): LinkTarget {
  if (rel.mode === 'internal') {
    try {
      const t = resolve(ctx.basePart, rel.target);
      const anchor = ctx.slideAnchors.get(t.path);
      if (anchor !== undefined) return { type: 'anchor', id: anchor };
    } catch {
      // Fall through to ordinary classification.
    }
  }
  return classifyRelTarget(rel.mode === 'external', rel.target);
}

/** Fold the cascade for a paragraph, outermost first. */
function baseProps(
  ctx: SlideCtx,
  ph: PhInfo | undefined,
  shapeStyles: LevelStyle,
  lvl: number,
): TextProps {
  let props = ctx.defaultText.level(lvl);
  if (ctx.master !== undefined) {
    const classStyle =
      ph === undefined
        ? ctx.master.other
        : titleClass(ph.phType) === 'title'
          ? ctx.master.title
          : ctx.master.body;
    props = mergeTextProps(props, classStyle.level(lvl));
    if (ph !== undefined) {
      const hit = matchPlaceholder(ctx.master.placeholders, ph.phType, ph.idx);
      if (hit !== undefined) props = mergeTextProps(props, hit.styles.level(lvl));
    }
  }
  if (ctx.layout !== undefined && ph !== undefined) {
    const hit = matchPlaceholder(ctx.layout.placeholders, ph.phType, ph.idx);
    if (hit !== undefined) props = mergeTextProps(props, hit.styles.level(lvl));
  }
  return mergeTextProps(props, shapeStyles.level(lvl));
}

/** Load an internal relationship target's bytes, resolved against this part. Failures degrade (log + undefined); resource-limit errors always propagate. */
function relPart(ctx: SlideCtx, relId: string): RelTarget | undefined {
  return relTargetBytes(ctx.pkg, ctx.rels, ctx.basePart, relId);
}

interface PhInfo {
  phType: string;
  idx: string | undefined;
}

function placeholderType(sp: Element): string | undefined {
  const ph = sp.firstDescendant(ns.P, 'ph');
  return ph !== undefined ? (ph.attr(ns.P, 'type') ?? 'body') : undefined;
}

function parseShapes(parent: Element, ctx: SlideCtx, blocks: Block[]): void {
  for (const child of parent.childElems()) {
    if (child.is(ns.MC, 'AlternateContent')) {
      const branch = alternateBranch(child, SUPPORTED_NS);
      if (branch !== undefined) parseShapes(branch, ctx, blocks);
      continue;
    }
    if (child.ns !== ns.P) continue;
    switch (child.local) {
      // Connector shapes carry the same `p:txBody` as plain shapes.
      case 'sp':
      case 'cxnSp':
        parseShape(child, ctx, blocks);
        break;
      case 'grpSp':
        parseShapes(child, ctx, blocks);
        break;
      case 'graphicFrame':
        parseGraphicFrame(child, ctx, blocks);
        break;
      case 'pic': {
        const cNvPr = child.firstDescendant(ns.P, 'cNvPr');
        const descrRaw = cNvPr?.attr(ns.P, 'descr');
        const descr = descrRaw !== undefined ? cleanText(descrRaw) : '';
        const blip = child.firstDescendant(ns.A, 'blip');
        const rid =
          blip !== undefined
            ? (blip.attrQualified(ns.R, 'embed') ?? blip.attrQualified(ns.R, 'link'))
            : undefined;
        // External-mode targets (`r:link`) become external image
        // sources; embedded targets are retained as assets.
        const source =
          rid !== undefined
            ? relImageSource(ctx.pkg, ctx.rels, ctx.basePart, ctx.assets, rid)
            : undefined;
        if (source !== undefined || descr.trim().length > 0) {
          blocks.push({
            type: 'paragraph',
            inlines: [
              {
                type: 'image',
                alt: descr,
                source: source ?? { type: 'unavailable' },
              },
            ],
          });
        }
        break;
      }
      default:
        break;
    }
  }
}

function parseShape(sp: Element, ctx: SlideCtx, blocks: Block[]): void {
  const phEl = sp.firstDescendant(ns.P, 'ph');
  const ph: PhInfo | undefined =
    phEl !== undefined
      ? { phType: phEl.attr(ns.P, 'type') ?? 'body', idx: phEl.attr(ns.P, 'idx') }
      : undefined;
  if (ph !== undefined && (ph.phType === 'sldNum' || ph.phType === 'dt' || ph.phType === 'ftr')) {
    return;
  }
  const tx = sp.find(ns.P, 'txBody');
  if (tx === undefined) return;
  // Titles get heading semantics but keep their shape-order position.
  if (ph !== undefined && titleClass(ph.phType) === 'title') {
    pushTitleHeading(tx, ctx, ph, blocks);
  } else {
    parseTextBody(tx, ctx, ph, blocks);
  }
}

/** Collapse a title placeholder's paragraphs into one slide heading. Runs resolve through the full cascade like body text. */
function pushTitleHeading(
  tx: Element,
  ctx: SlideCtx,
  ph: PhInfo | undefined,
  blocks: Block[],
): void {
  const shapeStyles = parseLevelStyles(tx.find(ns.A, 'lstStyle'));
  const inlines: Inline[] = [];
  for (const p of tx.findAll(ns.A, 'p')) {
    const ppr = p.find(ns.A, 'pPr');
    const lvlRaw = ppr?.attr(ns.A, 'lvl');
    const lvl = lvlRaw !== undefined ? (parseUsize(lvlRaw) ?? 0) : 0;
    let props = baseProps(ctx, ph, shapeStyles, lvl);
    if (ppr !== undefined) props = mergeTextProps(props, paragraphProps(ppr));
    const base = resolveDelta(props.delta);
    const para = parseParaInlines(p, ctx, base);
    if (inlinesAreEmpty(para)) continue;
    rebaseEmphasis(para, base);
    if (inlines.length > 0) inlines.push({ type: 'lineBreak' });
    inlines.push(...para);
  }
  if (!inlinesAreEmpty(inlines)) {
    blocks.push({
      type: 'heading',
      level: 2,
      anchor: inlinesToPlainText(inlines),
      content: inlines,
    });
  }
}

function parseTextBody(tx: Element, ctx: SlideCtx, ph: PhInfo | undefined, blocks: Block[]): void {
  const shapeStyles = parseLevelStyles(tx.find(ns.A, 'lstStyle'));
  ctx.instanceCounter.n += 1;
  const instance = ctx.instanceCounter.n;
  const counters = new Array<number>(LEVELS).fill(0);
  const started = new Array<boolean>(LEVELS).fill(false);
  const listRun: ListEntry[] = [];

  for (const p of tx.findAll(ns.A, 'p')) {
    const ppr = p.find(ns.A, 'pPr');
    const lvlRaw = ppr?.attr(ns.A, 'lvl');
    const lvl = lvlRaw !== undefined ? (parseUsize(lvlRaw) ?? 0) : 0;
    let props = baseProps(ctx, ph, shapeStyles, lvl);
    if (ppr !== undefined) props = mergeTextProps(props, paragraphProps(ppr));
    const base = resolveDelta(props.delta);
    const inlines = parseParaInlines(p, ctx, base);
    if (inlinesAreEmpty(inlines)) {
      flushList(blocks, listRun);
      continue;
    }
    const bullet = props.bullet;
    if (bullet.kind === 'autoNum') {
      const lvlIdx = Math.min(lvl, LEVELS - 1);
      let number: number;
      if (started[lvlIdx]) {
        number = saturatingAdd(counters[lvlIdx]!, 1);
      } else {
        started[lvlIdx] = true;
        number = bullet.start;
      }
      counters[lvlIdx] = number;
      for (let i = lvlIdx + 1; i < started.length; i += 1) started[i] = false;
      listRun.push({
        level: lvl,
        key: { instance, marker: bullet.marker },
        number,
        label: numWrapLabel(bullet.wrap, bullet.marker, number),
        blocks: [{ type: 'paragraph', inlines }],
      });
    } else if (bullet.kind === 'char') {
      listRun.push({
        level: lvl,
        key: { instance, marker: 'bullet' },
        number: 0,
        label: undefined,
        blocks: [{ type: 'paragraph', inlines }],
      });
    } else {
      flushList(blocks, listRun);
      blocks.push({ type: 'paragraph', inlines });
    }
  }
  flushList(blocks, listRun);
}

function parseParaInlines(p: Element, ctx: SlideCtx, base: Style): Inline[] {
  const out: Inline[] = [];
  for (const child of p.childElems()) {
    if (child.ns !== ns.A) continue;
    switch (child.local) {
      case 'r':
      case 'fld': {
        const rpr = child.find(ns.A, 'rPr');
        const t = child.find(ns.A, 't');
        const text = cleanText(t !== undefined ? t.text() : '');
        if (text.length === 0) continue;
        const style = rpr !== undefined ? applyDelta(rprDelta(rpr), base) : base;
        const inline: Inline = { type: 'text', text, style };
        const hid = rpr?.find(ns.A, 'hlinkClick')?.attrQualified(ns.R, 'id');
        const rel = hid !== undefined ? ctx.rels.get(hid) : undefined;
        const target = rel !== undefined ? linkTarget(ctx, rel) : undefined;
        if (target !== undefined) out.push({ type: 'link', content: [inline], target });
        else out.push(inline);
        break;
      }
      case 'br':
        out.push({ type: 'lineBreak' });
        break;
      default:
        break;
    }
  }
  return out;
}

function parseGraphicFrame(frame: Element, ctx: SlideCtx, blocks: Block[]): void {
  const tbl = frame.firstDescendant(ns.A, 'tbl');
  if (tbl !== undefined) {
    parseTable(tbl, ctx, blocks);
    return;
  }
  // Embedded OLE objects: retain identity, media type, and payload.
  const ole = frame.firstDescendant(ns.P, 'oleObj');
  if (ole !== undefined) {
    const progId = ole.attr(ns.P, 'progId') ?? 'object';
    const name = (ole.attr(ns.P, 'name') ?? '').trim();
    const alt = name.length === 0 ? `Embedded object: ${progId}` : name;
    const rid = ole.attrQualified(ns.R, 'id');
    let source: ImageSource | undefined;
    if (rid !== undefined) {
      const loaded = relPart(ctx, rid);
      if (loaded !== undefined) {
        const [part, oleBytes] = loaded;
        source = {
          type: 'asset',
          id: ctx.assets.add('application/vnd.ms-ole-object', part, oleBytes),
        };
      }
    }
    blocks.push({
      type: 'paragraph',
      inlines: [
        {
          type: 'image',
          alt,
          source: source ?? { type: 'unavailable' },
        },
      ],
    });
    return;
  }
  const chartRef = frame.firstDescendant(ns.CHART, 'chart');
  const chartRid = chartRef?.attrQualified(ns.R, 'id');
  if (chartRid !== undefined) {
    const loaded = relPart(ctx, chartRid);
    if (loaded !== undefined) {
      const [part, chartBytes] = loaded;
      try {
        blocks.push(...chartBlocks(parseXml(chartBytes)));
      } catch (e) {
        if (e instanceof ConvertError && e.isFatal()) throw e;
        warn(`skipping corrupt chart part ${part}: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
  }
  const relIds = frame.firstDescendant(ns.DGM, 'relIds');
  const dmRid = relIds?.attrQualified(ns.R, 'dm');
  if (dmRid !== undefined) {
    const loaded = relPart(ctx, dmRid);
    if (loaded !== undefined) {
      const [part, dgmBytes] = loaded;
      try {
        blocks.push(...diagramBlocks(parseXml(dgmBytes)));
      } catch (e) {
        if (e instanceof ConvertError && e.isFatal()) throw e;
        warn(
          `skipping corrupt diagram part ${part}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

/** DrawingML slide table: origins carry `gridSpan`/`rowSpan`; merged continuation cells (`hMerge`/`vMerge`) consume covered positions. */
function parseTable(tbl: Element, ctx: SlideCtx, blocks: Block[]): void {
  const tblPr = tbl.find(ns.A, 'tblPr');
  const firstRow = tblPr?.attr(ns.A, 'firstRow');
  const headerRows = firstRow === '1' || firstRow === 'true' ? 1 : 0;
  const builder = new GridBuilder();
  for (const tr of tbl.findAll(ns.A, 'tr')) {
    builder.nextRow();
    for (const tc of tr.findAll(ns.A, 'tc')) {
      const hMerge = tc.attr(ns.A, 'hMerge');
      const vMerge = tc.attr(ns.A, 'vMerge');
      const merged = hMerge === '1' || hMerge === 'true' || vMerge === '1' || vMerge === 'true';
      if (merged) {
        builder.covered();
        continue;
      }
      const colSpanRaw = tc.attr(ns.A, 'gridSpan');
      const rowSpanRaw = tc.attr(ns.A, 'rowSpan');
      const colSpan = Math.max(colSpanRaw !== undefined ? (parseU32(colSpanRaw) ?? 1) : 1, 1);
      const rowSpan = Math.max(rowSpanRaw !== undefined ? (parseU32(rowSpanRaw) ?? 1) : 1, 1);
      const cellBlocks: Block[] = [];
      const tx = tc.find(ns.A, 'txBody');
      if (tx !== undefined) parseTextBody(tx, ctx, undefined, cellBlocks);
      builder.place(cellSpanning(cellBlocks, colSpan, rowSpan));
    }
  }
  const table = builder.finish('data');
  if (table.grid.length === 0) return;
  table.headerRows = resolveHeaderRows(table, headerRows);
  blocks.push({ type: 'table', table });
}

function tryResolve(base: string, target: string): string | undefined {
  try {
    return resolve(base, target).path;
  } catch {
    return undefined;
  }
}

function parseUsize(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) return undefined;
  return n;
}

function parseU32(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return undefined;
  return n;
}

function saturatingAdd(a: number, b: number): number {
  const s = a + b;
  return s > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : s;
}
