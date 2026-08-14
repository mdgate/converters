import type { Format } from './format.js';
import { Package } from './package/archive.js';
import { CompoundFile, hasOleMagic } from './package/cfb.js';
import { resolve, type Target } from './package/path.js';
import { readRels, relType } from './package/relationships.js';
import { type Element, ns } from './package/xml.js';
import { trim } from './unicode.js';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MANIFEST_NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/**
 * Detect the format from the content itself. Plain-text formats (CSV) carry
 * no signature and return undefined.
 */
export function formatFromBytes(bytes: Uint8Array): Format | undefined {
  try {
    return detectFromBytes(bytes);
  } catch {
    return undefined;
  }
}

function detectFromBytes(bytes: Uint8Array): Format | undefined {
  if (startsWithAscii(bytes, '{\\rtf')) return 'rtf';
  if (hasOleMagic(bytes)) return detectOle(bytes);
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return detectZip(bytes);
  }
  return undefined;
}

/**
 * Classify an OLE compound file by its mandated content stream. Encrypted
 * OOXML packages stay undefined: the inner format is unknowable.
 */
function detectOle(bytes: Uint8Array): Format | undefined {
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch {
    return undefined;
  }
  for (const entry of ole.readRootStorage()) {
    const name = entry.name;
    if (eqIgnoreAsciiCase(name, 'WordDocument')) return 'doc';
    if (eqIgnoreAsciiCase(name, 'PowerPoint Document')) return 'ppt';
    if (eqIgnoreAsciiCase(name, 'Workbook') || eqIgnoreAsciiCase(name, 'Book')) return 'excel';
  }
  return undefined;
}

function detectZip(bytes: Uint8Array): Format | undefined {
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
    return mimetypeFormat(trim(mimeText));
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
            const format = opcFormat(ct);
            if (format !== undefined) return format;
          }
        }
        const tree = tryOptionalXml(pkg, target.path);
        if (tree !== undefined) {
          const root = tree.childElems()[0];
          const format = root !== undefined ? rootElementFormat(root) : undefined;
          if (format !== undefined) return format;
        }
        return opcFormatByPath(target.path);
      }
    }
  } catch {
    // Detection never errors.
  }

  for (const [part, format] of [
    ['word/document.xml', 'docx'],
    ['ppt/presentation.xml', 'pptx'],
    ['xl/workbook.xml', 'excel'],
    ['xl/workbook.bin', 'excel'],
  ] as const) {
    if (pkg.hasPart(part)) return format;
  }

  try {
    const manifest = tryOptionalXml(pkg, 'META-INF/manifest.xml');
    if (manifest !== undefined) {
      for (const e of manifest.descendants(MANIFEST_NS, 'file-entry')) {
        if (e.attr(MANIFEST_NS, 'full-path') === '/') {
          const mime = e.attr(MANIFEST_NS, 'media-type');
          if (mime !== undefined) return mimetypeFormat(trim(mime));
        }
      }
    }
  } catch {
    // continue
  }

  if (pkg.hasPart('META-INF/container.xml')) return 'epub';
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

function mimetypeFormat(mime: string): Format | undefined {
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

function opcFormat(contentType: string): Format | undefined {
  const ct = contentType.toLowerCase();
  if (ct.includes('wordprocessingml')) return 'docx';
  if (ct.includes('presentationml')) return 'pptx';
  if (ct.includes('spreadsheetml') || ct.includes('ms-excel')) return 'excel';
  return undefined;
}

function rootElementFormat(root: Element): Format | undefined {
  switch (root.ns) {
    case ns.W:
      return 'docx';
    case ns.P:
      return 'pptx';
    case SPREADSHEET_NS:
      return 'excel';
    default:
      return undefined;
  }
}

function opcFormatByPath(part: string): Format | undefined {
  if (part.startsWith('word/')) return 'docx';
  if (part.startsWith('ppt/')) return 'pptx';
  if (part.startsWith('xl/')) return 'excel';
  return undefined;
}

/** The format a bare extension names (no leading dot), case-insensitive. */
export function formatFromExtension(ext: string): Format | undefined {
  switch (ext.toLowerCase()) {
    case 'doc':
      return 'doc';
    case 'docx':
    case 'docm':
      return 'docx';
    case 'odt':
      return 'odt';
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'ppsm':
      return 'pptx';
    case 'ppt':
    case 'pps':
    case 'pot':
      return 'ppt';
    case 'rtf':
      return 'rtf';
    case 'epub':
      return 'epub';
    case 'xlsx':
    case 'xlsm':
    case 'xlsb':
    case 'xls':
      return 'excel';
    case 'ods':
      return 'ods';
    case 'odp':
      return 'odp';
    case 'csv':
      return 'csv';
    default:
      return undefined;
  }
}

/** The format a path's extension names. */
export function formatFromPath(filePath: string): Format | undefined {
  const ext = extensionOf(filePath);
  return ext === undefined ? undefined : formatFromExtension(ext);
}

function extensionOf(filePath: string): string | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1);
}

function startsWithAscii(bytes: Uint8Array, s: string): boolean {
  if (bytes.length < s.length) return false;
  for (let i = 0; i < s.length; i += 1) {
    if (bytes[i] !== s.charCodeAt(i)) return false;
  }
  return true;
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
