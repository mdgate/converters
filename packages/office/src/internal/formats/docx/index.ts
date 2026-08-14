//! OOXML WordprocessingML (.docx / .docm).
//!
//! Resolution pipeline: package parts -> style/numbering models ->
//! spec-order property resolution -> document model.

import { AssetSink } from '../../common/assets.js';
import { ConvertError } from '../../error.js';
import { warn } from '../../log.js';
import type { Document, Note } from '../../model/index.js';
import { Package, probeOle } from '../../package/archive.js';
import { resolve } from '../../package/path.js';
import { type Relationships, readRels, relsPartFor, relType } from '../../package/relationships.js';
import { ns } from '../../package/xml.js';
import { type Ctx, ctxForPart, parseBlocks } from './content.js';
import { Counters, Numbering, parseNumbering } from './numbering.js';
import { Styles } from './styles.js';

export function parse(bytes: Uint8Array): Document {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    const ole = probeOle(bytes);
    if (ole !== undefined) throw ole;
    throw e;
  }

  // OPC part discovery: the main part comes from the package-level
  // officeDocument relationship; its own parts (styles, numbering, notes)
  // from the main part's typed relationships. Conventional paths are the
  // fallback for packages with missing or unusable rels.
  const rootRels = readRels(pkg, '_rels/.rels');
  const officeRel = rootRels.firstOfType(relType.OFFICE_DOCUMENT);
  let mainPart = 'word/document.xml';
  if (officeRel !== undefined) {
    try {
      mainPart = resolve('', officeRel.target).path;
    } catch {
      mainPart = 'word/document.xml';
    }
  }
  const docRels = readRels(pkg, relsPartFor(mainPart));

  const stylesPart = typedPartPath(docRels, mainPart, relType.STYLES, 'styles.xml');
  const stylesTree = pkg.optionalXmlPart(stylesPart);
  const styles = Styles.parseOpt(stylesTree?.find(ns.W, 'styles'));

  const numberingPart = typedPartPath(docRels, mainPart, relType.NUMBERING, 'numbering.xml');
  const numberingTree = pkg.optionalXmlPart(numberingPart);
  const numberingRoot = numberingTree?.find(ns.W, 'numbering');
  const numbering =
    numberingRoot !== undefined
      ? parseNumbering(numberingRoot, (styleId) => styles.directNumId(styleId))
      : new Numbering();

  const docTree = pkg.requiredXmlPart(mainPart);
  const body = docTree.find(ns.W, 'document')?.find(ns.W, 'body');
  if (body === undefined) {
    throw ConvertError.malformedPart(mainPart, 'no document body');
  }

  const counters = new Counters();
  const assets = new AssetSink();

  const footnotesPart = typedPartPath(docRels, mainPart, relType.FOOTNOTES, 'footnotes.xml');
  const endnotesPart = typedPartPath(docRels, mainPart, relType.ENDNOTES, 'endnotes.xml');

  const ctx: Ctx = {
    pkg,
    rels: docRels,
    basePart: mainPart,
    styles,
    numbering,
    counters,
    assets,
  };
  const blocks = parseBlocks(body, ctx);

  const notes: Note[] = [];
  const noteSpecs = [
    {
      part: footnotesPart,
      rootName: 'footnotes',
      elemName: 'footnote',
      prefix: 'fn',
      kind: 'footnote' as const,
    },
    {
      part: endnotesPart,
      rootName: 'endnotes',
      elemName: 'endnote',
      prefix: 'en',
      kind: 'endnote' as const,
    },
  ];
  for (const spec of noteSpecs) {
    const tree = pkg.optionalXmlPart(spec.part);
    if (tree === undefined) continue;
    const root = tree.find(ns.W, spec.rootName);
    if (root === undefined) continue;
    const noteRels = readRels(pkg, relsPartFor(spec.part));
    const noteCtx = ctxForPart(ctx, noteRels, spec.part);
    for (const note of root.findAll(ns.W, spec.elemName)) {
      const ntype = note.attr(ns.W, 'type');
      if (
        ntype === 'separator' ||
        ntype === 'continuationSeparator' ||
        ntype === 'continuationNotice'
      ) {
        continue;
      }
      const id = note.attr(ns.W, 'id');
      if (id === undefined) continue;
      notes.push({
        id: `${spec.prefix}${id}`,
        kind: spec.kind,
        blocks: parseBlocks(note, noteCtx),
      });
    }
  }

  return { blocks, notes, assets: assets.assets };
}

/**
 * Path of a typed related part, resolved against the main part; falls back
 * to the conventional sibling name when the relationship is absent.
 */
function typedPartPath(rels: Relationships, base: string, type: string, fallback: string): string {
  const reference = rels.firstOfType(type)?.target ?? fallback;
  try {
    return resolve(base, reference).path;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warn(`skipping unresolvable related-part target ${JSON.stringify(reference)}: ${msg}`);
    try {
      return resolve(base, fallback).path;
    } catch {
      return fallback;
    }
  }
}
