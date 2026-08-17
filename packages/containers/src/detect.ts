import { trim } from '@mdgate/utils';
import { Package } from './archive.js';
import { CompoundFile, hasOleMagic } from './cfb.js';
import { resolve, type Target } from './path.js';
import { readRels, relType } from './relationships.js';
import { type Element, ns } from './xml.js';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MANIFEST_NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** What a ZIP-based document container holds. */
export type ZipDocKind =
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'odg'
  | 'epub'
  | 'pages'
  | 'numbers'
  | 'keynote'
  | 'vsdx'
  | 'hwpx';

/** What an OLE compound file holds. */
export type OleDocKind = 'doc' | 'ppt' | 'xls' | 'vsd' | 'hwp' | 'one';

/**
 * Classify a ZIP-based document container by its content. Returns undefined
 * for non-ZIP bytes and unrecognized packages. Never throws.
 */
export function detectZipDoc(bytes: Uint8Array): ZipDocKind | undefined {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    return undefined;
  }
  try {
    return detectZip(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Classify an OLE compound file by its mandated content stream. Returns
 * undefined for non-OLE bytes and for encrypted OOXML packages (the inner
 * format is unknowable). Never throws.
 */
export function detectOleDoc(bytes: Uint8Array): OleDocKind | undefined {
  if (!hasOleMagic(bytes)) return undefined;
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch {
    return undefined;
  }
  try {
    for (const entry of ole.readRootStorage()) {
      const name = entry.name;
      if (eqIgnoreAsciiCase(name, 'WordDocument')) return 'doc';
      if (eqIgnoreAsciiCase(name, 'PowerPoint Document')) return 'ppt';
      if (eqIgnoreAsciiCase(name, 'Workbook') || eqIgnoreAsciiCase(name, 'Book')) return 'xls';
      if (eqIgnoreAsciiCase(name, 'VisioDocument')) return 'vsd';
      if (isHwpStream(name)) return 'hwp';
      if (isOneNoteStream(name)) return 'one';
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function detectZip(bytes: Uint8Array): ZipDocKind | undefined {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch {
    return undefined;
  }

  const mimeBytes = tryOptionalPart(pkg, 'mimetype');
  if (mimeBytes !== undefined) {
    const mimeText = utf8Strict(mimeBytes);
    if (mimeText === undefined) return undefined;
    return mimetypeKind(trim(mimeText));
  }

  try {
    const rels = readRels(pkg, '_rels/.rels');
    const rel = rels.firstOfType(relType.OFFICE_DOCUMENT);
    if (rel !== undefined) {
      let target: Target | undefined;
      try {
        target = resolve('', rel.target);
      } catch {
        target = undefined;
      }
      if (target !== undefined) {
        const types = tryOptionalXml(pkg, '[Content_Types].xml');
        if (types !== undefined) {
          const ct = contentTypeOf(types, target.path);
          if (ct !== undefined) {
            const kind = opcKind(ct);
            if (kind !== undefined) return kind;
          }
        }
        const tree = tryOptionalXml(pkg, target.path);
        if (tree !== undefined) {
          const root = tree.childElems()[0];
          const kind = root !== undefined ? rootElementKind(root) : undefined;
          if (kind !== undefined) return kind;
        }
        return opcKindByPath(target.path);
      }
    }
  } catch {
    // Detection never errors.
  }

  for (const [part, kind] of [
    ['word/document.xml', 'docx'],
    ['ppt/presentation.xml', 'pptx'],
    ['xl/workbook.xml', 'xlsx'],
    ['xl/workbook.bin', 'xlsx'],
    ['visio/document.xml', 'vsdx'],
    ['Contents/content.hpf', 'hwpx'],
  ] as const) {
    if (pkg.hasPart(part)) return kind;
  }

  try {
    const manifest = tryOptionalXml(pkg, 'META-INF/manifest.xml');
    if (manifest !== undefined) {
      for (const e of manifest.descendants(MANIFEST_NS, 'file-entry')) {
        if (e.attr(MANIFEST_NS, 'full-path') === '/') {
          const mime = e.attr(MANIFEST_NS, 'media-type');
          if (mime !== undefined) return mimetypeKind(trim(mime));
        }
      }
    }
  } catch {
    // continue
  }

  if (pkg.hasPart('META-INF/container.xml')) return 'epub';

  const iwork = detectIWorkStructure(pkg);
  if (iwork !== undefined) return iwork;

  return undefined;
}

/**
 * Coarse iWork detection from package layout only. Authoritative kind
 * classification (Document.iwa message type / fields) lives in
 * `@mdgate/iwork-common`; converters prefer that for sniff score 2.
 */
function detectIWorkStructure(pkg: Package): ZipDocKind | undefined {
  const names = pkg.partNames();
  if (names.length === 0) return undefined;

  let hasIwa = false;
  let hasIndexZip = false;
  let hasDocumentIwa = false;
  let keynoteHint = false;
  let numbersHint = false;

  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes('encrypted') || lower.endsWith('.iwae')) return undefined;
    if (lower.endsWith('.iwa')) {
      hasIwa = true;
      if (lower.endsWith('/document.iwa') || lower === 'document.iwa') hasDocumentIwa = true;
      if (lower.includes('slide') || lower.includes('masterslide')) keynoteHint = true;
      if (lower.includes('calculationengine') || lower.includes('tables/')) numbersHint = true;
    }
    if (lower === 'index.zip') hasIndexZip = true;
  }

  if (!hasIwa && !hasIndexZip) return undefined;
  // Nested Index.zip alone is enough to claim iWork; without opening it we
  // cannot tell which app — leave kind to converters / extension sniff.
  if (!hasIwa && hasIndexZip) return undefined;
  if (!hasDocumentIwa && !hasIndexZip && !keynoteHint && !numbersHint) return undefined;

  if (keynoteHint && !numbersHint) return 'keynote';
  if (numbersHint && !keynoteHint) return 'numbers';
  if (hasDocumentIwa) return 'pages';
  return undefined;
}

function tryOptionalPart(pkg: Package, name: string): Uint8Array | undefined {
  try {
    return pkg.optionalPart(name);
  } catch {
    return undefined;
  }
}

function tryOptionalXml(pkg: Package, name: string): Element | undefined {
  try {
    return pkg.optionalXmlPart(name);
  } catch {
    return undefined;
  }
}

function mimetypeKind(mime: string): ZipDocKind | undefined {
  const base = mime.endsWith('-template') ? mime.slice(0, -'-template'.length) : mime;
  switch (base) {
    case 'application/epub+zip':
      return 'epub';
    case 'application/vnd.oasis.opendocument.text':
      return 'odt';
    case 'application/vnd.oasis.opendocument.spreadsheet':
      return 'ods';
    case 'application/vnd.oasis.opendocument.presentation':
      return 'odp';
    case 'application/vnd.oasis.opendocument.graphics':
      return 'odg';
    case 'application/hwp+zip':
    case 'application/vnd.hancom.hwpx':
      return 'hwpx';
    default:
      return undefined;
  }
}

function contentTypeOf(types: Element, part: string): string | undefined {
  const partName = `/${part}`;
  for (const e of types.descendants(CT_NS, 'Override')) {
    const p = e.attrAny('PartName');
    if (p !== undefined && eqIgnoreAsciiCase(p, partName)) {
      const ct = e.attrAny('ContentType');
      if (ct !== undefined) return ct;
    }
  }
  const dot = part.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = part.slice(dot + 1);
  for (const e of types.descendants(CT_NS, 'Default')) {
    const x = e.attrAny('Extension');
    if (x !== undefined && eqIgnoreAsciiCase(x, ext)) {
      return e.attrAny('ContentType');
    }
  }
  return undefined;
}

function opcKind(contentType: string): ZipDocKind | undefined {
  const ct = contentType.toLowerCase();
  if (ct.includes('wordprocessingml')) return 'docx';
  if (ct.includes('presentationml')) return 'pptx';
  if (ct.includes('spreadsheetml') || ct.includes('ms-excel')) return 'xlsx';
  if (ct.includes('visio') || ct.includes('vnd.ms-visio')) return 'vsdx';
  return undefined;
}

function rootElementKind(root: Element): ZipDocKind | undefined {
  switch (root.ns) {
    case ns.W:
      return 'docx';
    case ns.P:
      return 'pptx';
    case SPREADSHEET_NS:
      return 'xlsx';
    default:
      return undefined;
  }
}

function opcKindByPath(part: string): ZipDocKind | undefined {
  if (part.startsWith('word/')) return 'docx';
  if (part.startsWith('ppt/')) return 'pptx';
  if (part.startsWith('xl/')) return 'xlsx';
  if (part.startsWith('visio/')) return 'vsdx';
  return undefined;
}

function isHwpStream(name: string): boolean {
  const bare = name.charCodeAt(0) === 5 ? name.slice(1) : name;
  return (
    eqIgnoreAsciiCase(name, 'FileHeader') ||
    eqIgnoreAsciiCase(bare, 'HwpSummaryInformation') ||
    eqIgnoreAsciiCase(name, 'HWPDocumentInfo')
  );
}

function isOneNoteStream(name: string): boolean {
  return name.length >= 7 && name.slice(0, 7).toLowerCase() === 'onenote';
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

function utf8Strict(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
