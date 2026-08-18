import { CompoundFile, hasOleMagic, Package, probeOle } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import type { Document } from '@mdgate/document';
import { type SheetRange, sheetsToDocument } from './workbook.js';
import { parseXlsCfb } from './xls.js';
import { parseXlsbPackage } from './xlsb.js';
import { parseXlsxPackage } from './xlsx.js';

/**
 * Parse an Excel workbook (xlsx, xlsm, xlsb, xls) into the document model.
 * Multi-sheet workbooks get per-sheet headings; merged cells, header-row
 * detection, and typed cell text are preserved.
 */
export function parse(bytes: Uint8Array): Document {
  try {
    return sheetsToDocument(readSheets(bytes));
  } catch (e) {
    throw mapOpenError(e);
  }
}

function readSheets(bytes: Uint8Array): SheetRange[] {
  if (hasOleMagic(bytes)) {
    let ole: CompoundFile;
    try {
      ole = CompoundFile.open(bytes);
    } catch (e) {
      throw mapOpenError(e);
    }
    if (ole.exists('EncryptionInfo') || ole.exists('EncryptedPackage')) {
      throw ConvertError.encrypted();
    }
    return parseXlsCfb(ole);
  }

  if (!isZip(bytes)) {
    throw ConvertError.malformed('unreadable workbook: Cannot detect file format');
  }

  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    const ole = probeOle(bytes);
    if (ole !== undefined) throw ole;
    throw mapOpenError(e);
  }

  if (pkg.hasPart('xl/workbook.xml')) {
    return parseXlsxPackage(pkg);
  }
  if (pkg.hasPart('xl/workbook.bin')) {
    return parseXlsbPackage(pkg);
  }
  return parseXlsxPackage(pkg);
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

function mapOpenError(e: unknown): ConvertError {
  if (e instanceof ConvertError) {
    if (e.code === 'encrypted' || e.code === 'resourceLimit' || e.code === 'io') return e;
    if (e.code === 'malformed') {
      if (e.message.toLowerCase().includes('password')) return ConvertError.encrypted();
      if (e.message.startsWith('malformed document: unreadable workbook:')) return e;
      if (e.message.startsWith('malformed document: no sheet')) return e;
      return ConvertError.malformed(`unreadable workbook: ${e.detail ?? e.message}`);
    }
    return e;
  }
  const text = e instanceof Error ? e.message : String(e);
  if (text.toLowerCase().includes('password')) return ConvertError.encrypted();
  return ConvertError.malformed(`unreadable workbook: ${text}`);
}
