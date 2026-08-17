import {
  type Element,
  ns,
  Package,
  probeOle,
  type Relationship,
  type Relationships,
  readRels,
  relsPartFor,
  relType,
  resolve,
} from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Block, type Document, emptyDocument, heading, plain } from '@mdgate/document';
import { alternateBranch } from '@mdgate/office-common';
import { cleanText, collapseWs } from '@mdgate/utils';

const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const VISIO_2003_NS = 'http://schemas.microsoft.com/visio/2003/core';
const PAGES_REL = 'http://schemas.microsoft.com/visio/2010/relationships/pages';
const PAGE_REL = 'http://schemas.microsoft.com/visio/2010/relationships/page';
const MASTERS_REL = 'http://schemas.microsoft.com/visio/2010/relationships/masters';
const MASTER_REL = 'http://schemas.microsoft.com/visio/2010/relationships/master';
const SUPPORTED_NS: readonly string[] = [VISIO_NS, VISIO_2003_NS, ns.R, ns.MC];

interface NamedPart {
  name: string;
  path: string;
}

export function parseVsdx(bytes: Uint8Array): Document {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    throw mapOpenError(e, bytes);
  }

  const parts = collectParts(pkg);
  if (parts.length === 0) {
    throw ConvertError.missingPart('visio/pages/pages.xml');
  }

  const doc = emptyDocument();
  let any = false;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const tree = pkg.optionalXmlPart(part.path);
    if (tree === undefined) continue;
    const before = doc.blocks.length;
    const title = part.name.length > 0 ? part.name : `Page ${i + 1}`;
    doc.blocks.push(heading(1, [plain(title)]));
    walk(tree, doc.blocks);
    if (doc.blocks.length === before + 1) doc.blocks.pop();
    else any = true;
  }

  if (!any) throw ConvertError.malformed('no readable text in Visio document');
  return doc;
}

function collectParts(pkg: Package): NamedPart[] {
  const docPart = officeDocumentPart(pkg) ?? 'visio/document.xml';
  const docRels = readRels(pkg, relsPartFor(docPart));

  const pagesPath = relPath(docRels, docPart, PAGES_REL) ?? 'visio/pages/pages.xml';
  const fromPages = listFromIndex(pkg, pagesPath, 'Page', PAGE_REL);
  if (fromPages.length > 0) return fromPages;

  const scanned = scanParts(pkg, 'visio/pages/', 'pages.xml');
  if (scanned.length > 0) return scanned;

  const mastersPath = relPath(docRels, docPart, MASTERS_REL) ?? 'visio/masters/masters.xml';
  const fromMasters = listFromIndex(pkg, mastersPath, 'Master', MASTER_REL);
  if (fromMasters.length > 0) return fromMasters;

  return scanParts(pkg, 'visio/masters/', 'masters.xml');
}

function officeDocumentPart(pkg: Package): string | undefined {
  const rootRels = readRels(pkg, '_rels/.rels');
  const office = firstRelOf(rootRels, relType.OFFICE_DOCUMENT);
  if (office !== undefined) {
    const path = tryResolve('', office.target);
    if (path !== undefined) return path;
  }
  if (pkg.hasPart('visio/document.xml')) return 'visio/document.xml';
  return undefined;
}

function listFromIndex(
  pkg: Package,
  indexPath: string,
  itemLocal: string,
  itemRelType: string,
): NamedPart[] {
  const tree = pkg.optionalXmlPart(indexPath);
  if (tree === undefined) return [];
  const rels = readRels(pkg, relsPartFor(indexPath));
  const out: NamedPart[] = [];
  const seen = new Set<string>();
  for (const item of tree.descendantsAny(itemLocal)) {
    const rid = itemRelId(item);
    const target = rid !== undefined ? rels.internalTarget(rid) : undefined;
    const path = target !== undefined ? tryResolve(indexPath, target) : undefined;
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    out.push({ name: itemName(item), path });
  }
  if (out.length > 0) return out;
  for (const [, rel] of rels.entries()) {
    if (rel.mode !== 'internal' || !relMatches(rel.relType, itemRelType)) continue;
    const path = tryResolve(indexPath, rel.target);
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    out.push({ name: '', path });
  }
  return out;
}

function scanParts(pkg: Package, prefix: string, skip: string): NamedPart[] {
  const lowerPrefix = prefix.toLowerCase();
  const lowerSkip = skip.toLowerCase();
  const names: string[] = [];
  for (const name of pkg.partNames()) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(lowerPrefix) || !lower.endsWith('.xml')) continue;
    if (lower.endsWith('.rels') || lower.endsWith(`/${lowerSkip}`) || lower === lowerSkip) continue;
    names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return names.map((path, i) => ({ name: `Page ${i + 1}`, path }));
}

function itemRelId(item: Element): string | undefined {
  const own = item.attrQualified(ns.R, 'id') ?? item.attrAny('id');
  if (own !== undefined && own.length > 0 && own.toLowerCase().startsWith('rid')) return own;
  for (const rel of item.descendantsAny('Rel')) {
    const id = rel.attrQualified(ns.R, 'id') ?? rel.attrAny('id');
    if (id !== undefined && id.length > 0) return id;
  }
  return undefined;
}

function itemName(item: Element): string {
  const name = item.attrAny('Name') ?? item.attrAny('NameU') ?? '';
  return collapseWs(cleanText(name)).trim();
}

function relPath(rels: Relationships, base: string, type: string): string | undefined {
  const rel = firstRelOf(rels, type);
  if (rel === undefined) return undefined;
  return tryResolve(base, rel.target);
}

function firstRelOf(rels: Relationships, type: string): Relationship | undefined {
  const exact = rels.firstOfType(type);
  if (exact !== undefined) return exact;
  let bestId: string | undefined;
  let best: Relationship | undefined;
  for (const [id, rel] of rels.entries()) {
    if (rel.mode !== 'internal' || !relMatches(rel.relType, type)) continue;
    if (bestId === undefined || id < bestId) {
      bestId = id;
      best = rel;
    }
  }
  return best;
}

function relMatches(actual: string, canonical: string): boolean {
  if (actual === canonical) return true;
  const tail = canonical.slice(canonical.lastIndexOf('/'));
  return tail.length > 1 && actual.endsWith(tail);
}

function walk(el: Element, blocks: Block[]): void {
  if (el.is(ns.MC, 'AlternateContent')) {
    const branch = alternateBranch(el, SUPPORTED_NS);
    if (branch !== undefined) walk(branch, blocks);
    return;
  }

  if (el.local === 'Text') {
    pushText(blocks, el.text());
    return;
  }

  if (el.local === 'TextBlock') {
    pushText(blocks, el.text());
    const value = el.attrAny('V') ?? el.attrAny('Value');
    if (value !== undefined) pushText(blocks, value);
  } else if (el.local === 'Cell' && eqIgnoreAsciiCase(el.attrAny('N') ?? '', 'TextBlock')) {
    const value = el.attrAny('V') ?? el.attrAny('Value');
    if (value !== undefined) pushText(blocks, value);
    return;
  }

  for (const child of el.childElems()) walk(child, blocks);
}

function pushText(blocks: Block[], raw: string): void {
  const text = collapseWs(cleanText(raw)).trim();
  if (text.length === 0 || isNumericish(text)) return;
  blocks.push({ type: 'paragraph', inlines: [plain(text)] });
}

function isNumericish(text: string): boolean {
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text);
}

function tryResolve(base: string, target: string): string | undefined {
  try {
    return resolve(base, target).path;
  } catch {
    return undefined;
  }
}

function mapOpenError(e: unknown, bytes: Uint8Array): ConvertError {
  if (e instanceof ConvertError) {
    if (e.code === 'encrypted' || isEncryptedError(e)) return ConvertError.encrypted();
    return e;
  }
  const ole = probeOle(bytes);
  if (ole !== undefined) return ole;
  const text = e instanceof Error ? e.message : String(e);
  if (isEncryptedText(text)) return ConvertError.encrypted();
  return ConvertError.malformed(`not a readable zip archive: ${text}`);
}

function isEncryptedError(e: unknown): boolean {
  if (e instanceof ConvertError && e.code === 'encrypted') return true;
  const detail = e instanceof ConvertError ? (e.detail ?? '') : '';
  const text = e instanceof Error ? `${e.message} ${detail}` : String(e);
  return isEncryptedText(text);
}

function isEncryptedText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('encrypted') || lower.includes('password');
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}
