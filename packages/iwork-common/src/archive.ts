import { Package } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { warn } from '@mdgate/utils';
import { type IwaObject, parseIwa } from './iwa.js';
import { fieldBytes, type ProtoField, readReference, readReferences } from './protobuf.js';
import { type IWorkKind, TYPE } from './types.js';

export interface IWorkArchive {
  kind: IWorkKind;
  objects: Map<number, IwaObject>;
}

/** Open a `.pages` / `.numbers` / `.key` package and load every `.iwa` object. */
export function openIWork(bytes: Uint8Array, expected?: IWorkKind): IWorkArchive {
  if (!isZip(bytes)) {
    throw ConvertError.malformed('not a readable iWork package');
  }

  let root: Package;
  try {
    root = Package.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw ConvertError.malformed(
      `not a readable iWork package: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (isEncryptedPackage(root)) throw ConvertError.encrypted();

  const objects = new Map<number, IwaObject>();
  loadIwaParts(root, objects);

  const indexZip = root.optionalPart('Index.zip');
  if (indexZip !== undefined) {
    let nested: Package;
    try {
      nested = Package.open(indexZip);
    } catch (e) {
      throw ConvertError.malformed(
        `unreadable Index.zip: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    loadIwaParts(nested, objects);
  }

  if (objects.size === 0) {
    throw ConvertError.malformed('no IWA objects found');
  }

  const kind = classifyKind(objects) ?? expected;
  if (kind === undefined) {
    throw ConvertError.malformed('unrecognized iWork document kind');
  }
  if (expected !== undefined && kind !== expected) {
    throw ConvertError.malformed(`expected ${expected} document, found ${kind}`);
  }

  return { kind, objects };
}

export function detectIWorkKind(bytes: Uint8Array): IWorkKind | undefined {
  if (!isZip(bytes)) return undefined;
  try {
    const archive = openIWork(bytes);
    return archive.kind;
  } catch (e) {
    if (e instanceof ConvertError && e.code === 'encrypted') return undefined;
    return undefined;
  }
}

export function getObject(archive: IWorkArchive, id: number | undefined): IwaObject | undefined {
  if (id === undefined) return undefined;
  return archive.objects.get(id);
}

export function deref(
  archive: IWorkArchive,
  fields: readonly ProtoField[],
  field: number,
): IwaObject | undefined {
  const id = readReference(fieldBytes(fields, field));
  return getObject(archive, id);
}

export function derefAll(
  archive: IWorkArchive,
  fields: readonly ProtoField[],
  field: number,
): IwaObject[] {
  const out: IwaObject[] = [];
  for (const id of readReferences(fields, field)) {
    const obj = archive.objects.get(id);
    if (obj !== undefined) out.push(obj);
  }
  return out;
}

function loadIwaParts(pkg: Package, objects: Map<number, IwaObject>): void {
  for (const name of pkg.partNames()) {
    if (!name.toLowerCase().endsWith('.iwa')) continue;
    const part = pkg.optionalPart(name);
    if (part === undefined) continue;
    let parsed: IwaObject[];
    try {
      parsed = parseIwa(part);
    } catch (e) {
      if (e instanceof ConvertError && (e.code === 'encrypted' || e.isFatal())) throw e;
      warn(`skipping unreadable IWA ${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const obj of parsed) {
      if (!objects.has(obj.id)) objects.set(obj.id, obj);
    }
  }
}

function classifyKind(objects: Map<number, IwaObject>): IWorkKind | undefined {
  for (const obj of objects.values()) {
    if (obj.type === TYPE.TP_DOCUMENT) return 'pages';
  }
  // Prefer Document id 1 when present.
  const root = objects.get(1);
  if (root !== undefined && root.type === 1) {
    return classifyDocumentType1(root.fields);
  }
  for (const obj of objects.values()) {
    if (obj.type === 1) {
      const kind = classifyDocumentType1(obj.fields);
      if (kind !== undefined) return kind;
    }
  }
  // Fall back to structural hints from object types in the graph.
  for (const obj of objects.values()) {
    if (obj.type === TYPE.KN_SLIDE || obj.type === TYPE.KN_SLIDE_ALT || obj.type === TYPE.KN_SHOW) {
      return 'keynote';
    }
    if (obj.type === TYPE.TN_SHEET) return 'numbers';
  }
  return undefined;
}

function classifyDocumentType1(fields: readonly ProtoField[]): IWorkKind | undefined {
  // Numbers: repeated sheet refs at field 1, TSA.DocumentArchive super at 8.
  // Keynote: show ref at field 2, TSA.DocumentArchive super at 3.
  const sheetRefs = readReferences(fields, 1);
  const showRef = readReference(fieldBytes(fields, 2));
  const hasNumbersSuper = fieldBytes(fields, 8) !== undefined;
  const hasKeynoteSuper = fieldBytes(fields, 3) !== undefined && !hasNumbersSuper;

  if (sheetRefs.length > 0 || hasNumbersSuper) return 'numbers';
  if (showRef !== undefined || hasKeynoteSuper) return 'keynote';
  return undefined;
}

function isEncryptedPackage(pkg: Package): boolean {
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
