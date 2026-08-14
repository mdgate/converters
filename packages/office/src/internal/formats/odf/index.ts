/** OpenDocument Text (.odt), Spreadsheet (.ods), and Presentation (.odp). */

import { AssetSink } from '../../common/assets.js';
import { ConvertError } from '../../error.js';
import {
  type Block,
  type Document,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
} from '../../model/index.js';
import { Package } from '../../package/archive.js';
import { type Element, ns } from '../../package/xml.js';
import { OdfStyles } from './styles.js';
import { parseSpreadsheet, parseTable } from './table.js';
import { Ctx, parseContainer, walkFrame } from './text.js';

export function parse(bytes: Uint8Array): Document {
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

  const assets = new AssetSink();
  const ctx = new Ctx(styles, pkg, assets);

  const text = body.find(ns.OFFICE, 'text');
  const sheet = text === undefined ? body.find(ns.OFFICE, 'spreadsheet') : undefined;
  const pres =
    text === undefined && sheet === undefined ? body.find(ns.OFFICE, 'presentation') : undefined;

  let blocks: Block[];
  if (text !== undefined) {
    blocks = parseContainer(text, ctx);
  } else if (sheet !== undefined) {
    blocks = parseSpreadsheet(sheet, ctx);
  } else if (pres !== undefined) {
    blocks = parsePresentation(pres, ctx);
  } else {
    throw ConvertError.malformedPart(
      'content.xml',
      'no recognized office body (text, spreadsheet, or presentation)',
    );
  }

  return { blocks, notes: ctx.notes, assets: assets.assets };
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

function parsePresentation(pres: Element, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  for (const page of pres.findAll(ns.DRAW, 'page')) {
    const title: Block[] = [];
    const body: Block[] = [];
    const notes: Block[] = [];
    walkShapes(page, ctx, title, body, notes);
    blocks.push(...title);
    blocks.push(...body);
    if (notes.length > 0) {
      blocks.push({ type: 'blockQuote', blocks: notes });
    }
  }
  return blocks;
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
      for (const frame of child.descendants(ns.DRAW, 'frame')) {
        const textBox = frame.find(ns.DRAW, 'text-box');
        if (textBox !== undefined) notes.push(...parseContainer(textBox, ctx));
      }
      continue;
    }
    if (child.ns !== ns.DRAW) continue;
    switch (child.local) {
      case 'frame': {
        const cls = child.attr(ns.PRESENTATION, 'class') ?? '';
        if (cls === 'page-number' || cls === 'date-time' || cls === 'footer' || cls === 'header') {
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
