/** OpenDocument packages (odt/ods/odp/odg) and flat XML (fodt/fods/fodp/fodg). */

import { type Element, ns, Package, parseXml } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type Block,
  type Document,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
} from '@mdgate/document';
import { AssetSink } from '@mdgate/office-common';
import { OdfStyles } from './styles.js';
import { parseSpreadsheet, parseTable } from './table.js';
import { Ctx, parseContainer, walkFrame } from './text.js';

export function parse(bytes: Uint8Array): Document {
  if (isZipMagic(bytes)) return parsePackage(bytes);
  return parseFlat(bytes);
}

function parsePackage(bytes: Uint8Array): Document {
  const pkg = Package.open(bytes);

  if (isEncrypted(pkg)) throw ConvertError.encrypted();

  const stylesTree = pkg.optionalXmlPart('styles.xml');
  const contentTree = pkg.requiredXmlPart('content.xml');

  const styles = new OdfStyles();
  if (stylesTree !== undefined) styles.collect(stylesTree);
  styles.collect(contentTree);

  const body = contentTree.find(ns.OFFICE, 'document-content')?.find(ns.OFFICE, 'body');
  if (body === undefined) {
    throw ConvertError.malformedPart('content.xml', 'no office:body');
  }

  return finish(body, styles, pkg, 'content.xml', stylesTree);
}

function parseFlat(bytes: Uint8Array): Document {
  const tree = parseXml(bytes);
  const root = tree.find(ns.OFFICE, 'document') ?? tree.find(ns.OFFICE, 'document-content');
  if (root === undefined) {
    throw ConvertError.malformed('no office:document');
  }
  const body = root.find(ns.OFFICE, 'body');
  if (body === undefined) {
    throw ConvertError.malformed('no office:body');
  }

  const styles = new OdfStyles();
  styles.collect(tree);
  return finish(body, styles, undefined, undefined, tree);
}

function finish(
  body: Element,
  styles: OdfStyles,
  pkg: Package | undefined,
  part: string | undefined,
  stylesTree: Element | undefined,
): Document {
  const assets = new AssetSink();
  const ctx = new Ctx(styles, pkg, assets);
  return {
    blocks: parseBody(body, ctx, part, collectMasters(stylesTree)),
    notes: ctx.notes,
    assets: assets.assets,
  };
}

function collectMasters(tree: Element | undefined): Map<string, Element> {
  const out = new Map<string, Element>();
  if (tree === undefined) return out;
  for (const master of tree.descendants(ns.STYLE, 'master-page')) {
    const name = master.attr(ns.STYLE, 'name');
    if (name !== undefined) out.set(name, master);
  }
  return out;
}

function parseBody(
  body: Element,
  ctx: Ctx,
  part: string | undefined,
  masters: Map<string, Element>,
): Block[] {
  const text = body.find(ns.OFFICE, 'text');
  const sheet = text === undefined ? body.find(ns.OFFICE, 'spreadsheet') : undefined;
  const pres =
    text === undefined && sheet === undefined ? body.find(ns.OFFICE, 'presentation') : undefined;
  const drawing =
    text === undefined && sheet === undefined && pres === undefined
      ? body.find(ns.OFFICE, 'drawing')
      : undefined;

  if (text !== undefined) {
    const blocks = parseContainer(text, ctx);
    blocks.push(...masterRegions(masters, ctx));
    return blocks;
  }
  if (sheet !== undefined) return parseSpreadsheet(sheet, ctx);
  if (pres !== undefined) return parsePages(pres, ctx, masters);
  if (drawing !== undefined) return parsePages(drawing, ctx, masters);

  const pages = body.findAll(ns.DRAW, 'page');
  if (pages.length > 0) return parsePages(body, ctx, masters);
  if (body.find(ns.TABLE, 'table') !== undefined) return parseSpreadsheet(body, ctx);
  if (
    body.find(ns.TEXT, 'p') !== undefined ||
    body.find(ns.TEXT, 'h') !== undefined ||
    body.find(ns.TEXT, 'list') !== undefined
  ) {
    return parseContainer(body, ctx);
  }

  const detail = 'no recognized office body (text, spreadsheet, presentation, or drawing)';
  if (part !== undefined) throw ConvertError.malformedPart(part, detail);
  throw ConvertError.malformed(detail);
}

function isZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Encrypted ODF packages carry `manifest:encryption-data` elements on file
 * entries. An absent or unreadable manifest proves nothing; fatal resource
 * limits propagate.
 */
function isEncrypted(pkg: Package): boolean {
  const tree = pkg.optionalXmlPart('META-INF/manifest.xml');
  if (tree === undefined) return false;
  return tree.firstDescendant(ns.MANIFEST, 'encryption-data') !== undefined;
}

function parsePages(root: Element, ctx: Ctx, masters: Map<string, Element>): Block[] {
  const pages = root.findAll(ns.DRAW, 'page');
  const targets = pages.length > 0 ? pages : [root];
  const blocks: Block[] = [];
  const fallbackMaster = masters.size === 1 ? [...masters.values()][0] : undefined;
  for (const page of targets) {
    const title: Block[] = [];
    const body: Block[] = [];
    const notes: Block[] = [];
    walkShapes(page, ctx, title, body, notes);
    const masterName =
      page.attr(ns.DRAW, 'master-page-name') ?? page.attr(ns.STYLE, 'master-page-name');
    const master =
      (masterName !== undefined ? masters.get(masterName) : undefined) ?? fallbackMaster;
    if (master !== undefined) {
      walkMasterChrome(master, ctx, body);
      body.push(...masterRegions(new Map([['page', master]]), ctx));
    }
    blocks.push(...title);
    blocks.push(...body);
    if (notes.length > 0) {
      blocks.push({ type: 'blockQuote', blocks: notes });
    }
  }
  return blocks;
}

function walkMasterChrome(master: Element, ctx: Ctx, body: Block[]): void {
  const chrome: Block[] = [];
  const unused: Block[] = [];
  for (const child of master.childElems()) {
    if (child.ns !== ns.DRAW) continue;
    const cls = child.attr(ns.PRESENTATION, 'class') ?? '';
    if (cls !== 'header' && cls !== 'footer' && cls !== 'header-left' && cls !== 'footer-left') {
      continue;
    }
    walkShapes(child, ctx, unused, chrome, unused);
  }
  for (const block of chrome) {
    if (!isPageFieldBlock(block)) body.push(block);
  }
}

function masterRegions(masters: Map<string, Element>, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  for (const master of masters.values()) {
    for (const local of ['header', 'footer', 'header-left', 'footer-left']) {
      const region = master.find(ns.STYLE, local);
      if (region === undefined) continue;
      for (const block of parseContainer(region, ctx)) {
        if (!isPageFieldBlock(block)) blocks.push(block);
      }
    }
  }
  return blocks;
}

function isPageFieldBlock(block: Block): boolean {
  if (block.type !== 'paragraph') return false;
  const text = inlinesToPlainText(block.inlines).trim();
  return text.length === 0 || text === '<number>' || text === '<date>' || text === '<time>';
}

/** Walk a page's shapes in document order, recursing into `draw:g` groups. */
function walkShapes(
  parent: Element,
  ctx: Ctx,
  title: Block[],
  body: Block[],
  notes: Block[],
): void {
  for (const child of parent.childElems()) {
    if (child.is(ns.PRESENTATION, 'notes')) {
      for (const box of child.descendants(ns.DRAW, 'text-box')) {
        notes.push(...parseContainer(box, ctx));
      }
      continue;
    }
    if (child.ns !== ns.DRAW) continue;
    switch (child.local) {
      case 'text-box': {
        const cls = child.attr(ns.PRESENTATION, 'class') ?? '';
        if (cls === 'page-number' || cls === 'date-time') {
          continue;
        }
        const inner = parseContainer(child, ctx);
        if (cls === 'title') pushTitleHeading(inner, title);
        else body.push(...inner);
        break;
      }
      case 'frame': {
        const cls = child.attr(ns.PRESENTATION, 'class') ?? '';
        if (cls === 'page-number' || cls === 'date-time') {
          continue;
        }
        const inner: Block[] = [];
        for (const content of child.childElems()) {
          if (content.is(ns.DRAW, 'text-box')) {
            inner.push(...parseContainer(content, ctx));
          } else if (content.is(ns.TABLE, 'table')) {
            inner.push(...parseTable(content, ctx));
          } else if (content.is(ns.DRAW, 'image')) {
            const out: Inline[] = [];
            const boxes: Block[] = [];
            walkFrame(child, ctx, out, boxes);
            if (!inlinesAreEmpty(out)) inner.push({ type: 'paragraph', inlines: out });
            inner.push(...boxes);
            break;
          }
        }
        if (cls === 'title') pushTitleHeading(inner, title);
        else body.push(...inner);
        break;
      }
      case 'g':
        walkShapes(child, ctx, title, body, notes);
        break;
      case 'custom-shape':
      case 'rect':
      case 'ellipse':
      case 'polygon':
      case 'path':
      case 'line':
      case 'connector':
      case 'caption': {
        for (const content of child.childElems()) {
          if (content.is(ns.TEXT, 'p') || content.is(ns.TEXT, 'list')) {
            body.push(...parseContainer(child, ctx));
            break;
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Collapse a title frame's paragraphs into one slide heading. */
function pushTitleHeading(inner: Block[], blocks: Block[]): void {
  const inlines: Inline[] = [];
  for (const block of inner) {
    if (block.type !== 'paragraph') continue;
    if (inlinesAreEmpty(block.inlines)) continue;
    if (inlines.length > 0) inlines.push({ type: 'lineBreak' });
    inlines.push(...block.inlines);
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
