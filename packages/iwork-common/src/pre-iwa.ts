import { type Element, Package, parseXml } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument, heading, plain } from '@mdgate/document';
import { trim } from '@mdgate/utils';
import type { IWorkKind } from './types.js';

const INDEX_PARTS = ['index.xml', 'index.apxl', 'presentation.apxl'];

export function detectPreIwaKind(bytes: Uint8Array): IWorkKind | undefined {
  if (!isZip(bytes)) return undefined;
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch {
    return undefined;
  }
  if (isEpubMimetype(pkg)) return undefined;
  if (isEncryptedPackage(pkg)) return kindFromNames(pkg) ?? 'pages';
  return classifyPreIwa(pkg);
}

export function parsePreIwa(bytes: Uint8Array, expected?: IWorkKind): Document {
  if (!isZip(bytes)) {
    throw ConvertError.malformed('not a readable iWork package');
  }
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw ConvertError.malformed(
      `not a readable iWork package: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (isEncryptedPackage(pkg)) throw ConvertError.encrypted();
  const kind = classifyPreIwa(pkg) ?? expected;
  if (kind === undefined) {
    throw ConvertError.malformed('unrecognized iWork document kind');
  }
  if (expected !== undefined && kind !== expected) {
    throw ConvertError.malformed(`expected ${expected} document, found ${kind}`);
  }
  const tree = loadIndexTree(pkg);
  if (tree === undefined) {
    throw ConvertError.malformed('no IWA objects found');
  }
  const paragraphs = collectParagraphs(tree);
  const doc = emptyDocument();
  if (paragraphs.length === 0) return doc;
  if (kind === 'keynote' || kind === 'numbers') {
    doc.blocks.push(heading(2, [plain(paragraphs[0]!)]));
    for (const para of paragraphs.slice(1)) {
      doc.blocks.push({ type: 'paragraph', inlines: [plain(para)] });
    }
    return doc;
  }
  for (const para of paragraphs) {
    doc.blocks.push({ type: 'paragraph', inlines: [plain(para)] });
  }
  return doc;
}

function classifyPreIwa(pkg: Package): IWorkKind | undefined {
  const names = [...pkg.partNames()].map((n) => n.toLowerCase());
  const fromNames = kindFromNames(pkg);
  const tree = loadIndexTree(pkg);
  if (tree !== undefined) {
    const root = tree.childElems()[0] ?? tree;
    const ns = root.ns ?? '';
    const local = root.local;
    if (ns.includes('/ls') || local === 'workbook') return 'numbers';
    if (ns.includes('/key') || local === 'presentation' || local === 'slideshow') return 'keynote';
    if (ns.includes('/sl') && local === 'presentation') return 'keynote';
    if (ns.includes('/pg') || ns.includes('/sl') || local === 'document') {
      return fromNames ?? 'pages';
    }
  }
  if (fromNames !== undefined) return fromNames;
  if (names.some((n) => n.endsWith('index.xml') || n.endsWith('index.apxl'))) return 'pages';
  return undefined;
}

function kindFromNames(pkg: Package): IWorkKind | undefined {
  let keynote = false;
  let numbers = false;
  let pages = false;
  for (const name of pkg.partNames()) {
    const lower = name.toLowerCase();
    if (lower.endsWith('presentation.apxl') || lower.includes('slide')) keynote = true;
    if (lower.includes('calculation') || lower.includes('tables/')) numbers = true;
    if (lower.endsWith('index.xml') || lower.endsWith('index.apxl')) pages = true;
  }
  if (keynote && !numbers) return 'keynote';
  if (numbers && !keynote) return 'numbers';
  if (pages) return 'pages';
  return undefined;
}

function loadIndexTree(pkg: Package): Element | undefined {
  for (const name of INDEX_PARTS) {
    const tree = tryXml(pkg, name);
    if (tree !== undefined) return tree;
  }
  for (const name of pkg.partNames()) {
    const lower = name.toLowerCase();
    if (!(lower.endsWith('.xml') || lower.endsWith('.apxl'))) continue;
    if (lower.includes('preview') || lower.includes('quicklook') || lower.includes('thumbnail')) {
      continue;
    }
    if (lower.includes('index') || lower.includes('presentation') || lower.includes('document')) {
      const tree = tryXml(pkg, name);
      if (tree !== undefined) return tree;
    }
  }
  return undefined;
}

function tryXml(pkg: Package, name: string): Element | undefined {
  try {
    const bytes = pkg.optionalPart(name);
    if (bytes === undefined) return undefined;
    return parseXml(bytes);
  } catch {
    return undefined;
  }
}

function collectParagraphs(tree: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const elem of tree.descendantElems()) {
    if (elem.local === 'ct') {
      const s = trim((elem.attrAny('s') ?? '').replace(/\s+/g, ' '));
      if (s.length === 0 || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      continue;
    }
    if (elem.local !== 'p' && elem.local !== 'text') continue;
    const text = trim(elem.text().replace(/\s+/g, ' '));
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  if (out.length > 0) return out;
  const fallback = trim(tree.text().replace(/\s+/g, ' '));
  return fallback.length === 0 ? [] : [fallback];
}

function isEpubMimetype(pkg: Package): boolean {
  const mime = pkg.optionalPart('mimetype');
  if (mime === undefined) return false;
  const text = trim(new TextDecoder().decode(mime));
  return text === 'application/epub+zip' || text === 'application/x-ibooks+zip';
}

export function isEpubZip(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  try {
    return isEpubMimetype(Package.open(bytes));
  } catch {
    return false;
  }
}

function isEncryptedPackage(pkg: Package): boolean {
  if (pkg.hasEncryptedEntries()) return true;
  for (const name of pkg.partNames()) {
    const lower = name.toLowerCase();
    if (lower.includes('encrypted') || lower.endsWith('.iwae')) return true;
  }
  return false;
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
