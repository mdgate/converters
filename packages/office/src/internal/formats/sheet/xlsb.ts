import { ConvertError } from '../../error.js';
import { warn } from '../../log.js';
import {
  type Package,
  type Relationships,
  readRels,
  relsPartFor,
  resolve,
} from '../../package/index.js';
import { builtinFormatByCode, type CellFormat, detectCustomNumberFormat } from './numfmt.js';
import { type CellValue, errorFromCode, formatExcelF64, formatExcelI64 } from './values.js';
import { fromSparse, type SheetRange, type SparseCell } from './workbook.js';

const REL_SHARED_STRINGS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const REL_STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

export function parseXlsbPackage(pkg: Package): SheetRange[] {
  const wbPath = pkg.hasPart('xl/workbook.bin') ? 'xl/workbook.bin' : undefined;
  if (wbPath === undefined) {
    throw ConvertError.malformed('unreadable workbook: missing xl/workbook.bin');
  }
  const rels = readRels(pkg, relsPartFor(wbPath));
  const strings = readSharedStrings(pkg, rels, wbPath);
  const formats = readStyles(pkg, rels, wbPath);
  const { sheets, is1904 } = readWorkbook(pkg, rels, wbPath);

  const out: SheetRange[] = [];
  let failed = 0;
  for (const sheet of sheets) {
    try {
      const range = readWorksheet(pkg, sheet.path, sheet.name, strings, formats, is1904);
      if (range !== undefined) out.push(range);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(
        `skipping unreadable sheet ${JSON.stringify(sheet.name)}: ${e instanceof Error ? e.message : String(e)}`,
      );
      failed += 1;
    }
  }
  if (sheets.length > 0 && failed === sheets.length) {
    throw ConvertError.malformed('no sheet in the workbook could be read');
  }
  return out;
}

function readSharedStrings(pkg: Package, rels: Relationships, wbPath: string): string[] {
  const path = firstRelPath(pkg, rels, wbPath, REL_SHARED_STRINGS) ?? 'xl/sharedStrings.bin';
  const bytes = pkg.optionalPart(path);
  if (bytes === undefined) return [];
  const iter = new RecordIter(bytes);
  const buf: number[] = [];
  try {
    iter.nextSkipBlocks(0x009f, [], buf);
  } catch {
    return [];
  }
  const body = Uint8Array.from(buf);
  const len = body.length >= 8 ? u32(body, 4) : 0;
  const strings: string[] = [];
  for (let i = 0; i < len; i += 1) {
    try {
      iter.nextSkipBlocks(0x0013, [[0x0023, 0x0024]], buf);
      const item = Uint8Array.from(buf);
      if (item.length > 1) strings.push(wideStr(item.subarray(1)));
    } catch {
      break;
    }
  }
  return strings;
}

function readStyles(pkg: Package, rels: Relationships, wbPath: string): CellFormat[] {
  const path = firstRelPath(pkg, rels, wbPath, REL_STYLES) ?? 'xl/styles.bin';
  const bytes = pkg.optionalPart(path);
  if (bytes === undefined) return [];
  const iter = new RecordIter(bytes);
  const buf: number[] = [];
  const numberFormats = new Map<number, CellFormat>();
  const formats: CellFormat[] = [];
  try {
    for (;;) {
      const typ = iter.readType();
      if (typ === undefined) break;
      iter.fillBuffer(buf);
      if (typ === 0x0267) {
        const body = Uint8Array.from(buf);
        const count = usize(body, 0);
        for (let i = 0; i < count; i += 1) {
          iter.nextSkipBlocks(0x002c, [], buf);
          const fmt = Uint8Array.from(buf);
          if (fmt.length < 2) continue;
          const code = u16(fmt, 0);
          numberFormats.set(code, detectCustomNumberFormat(wideStr(fmt.subarray(2))));
        }
      } else if (typ === 0x0269) {
        const body = Uint8Array.from(buf);
        const count = usize(body, 0);
        for (let i = 0; i < count; i += 1) {
          iter.nextSkipBlocks(0x002f, [], buf);
          const xf = Uint8Array.from(buf);
          const fmtCode = xf.length >= 4 ? u16(xf, 2) : 0;
          const builtin = builtinFormatByCode(fmtCode);
          formats.push(builtin === 'other' ? (numberFormats.get(fmtCode) ?? 'other') : builtin);
        }
        break;
      }
    }
  } catch {
    // optional part
  }
  return formats;
}

function readWorkbook(
  pkg: Package,
  rels: Relationships,
  wbPath: string,
): { sheets: Array<{ name: string; path: string }>; is1904: boolean } {
  const bytes = pkg.requiredPart(wbPath);
  const iter = new RecordIter(bytes);
  const buf: number[] = [];
  let is1904 = false;
  const sheets: Array<{ name: string; path: string }> = [];
  for (;;) {
    const typ = iter.readType();
    if (typ === undefined) break;
    iter.fillBuffer(buf);
    const body = Uint8Array.from(buf);
    if (typ === 0x0099) {
      if (body.length > 0) is1904 = (body[0]! & 0x1) !== 0;
    } else if (typ === 0x009c) {
      if (body.length < 12) continue;
      const relLen = u32(body, 8);
      if (relLen === 0xffff_ffff) continue;
      const relBytes = relLen * 2;
      if (12 + relBytes > body.length) continue;
      const relid = new TextDecoder('utf-16le').decode(body.subarray(12, 12 + relBytes));
      const rel = rels.get(relid);
      if (rel === undefined || rel.mode !== 'internal') continue;
      let path: string;
      try {
        path = rel.target.startsWith('/')
          ? rel.target.replace(/^\/+/, '')
          : resolve(wbPath, rel.target).path;
      } catch {
        continue;
      }
      const name = wideStr(body.subarray(12 + relBytes));
      sheets.push({ name, path });
    } else if (typ === 0x0090) {
      break;
    }
  }
  return { sheets, is1904 };
}

function readWorksheet(
  pkg: Package,
  path: string,
  name: string,
  strings: string[],
  formats: CellFormat[],
  is1904: boolean,
): SheetRange | undefined {
  const bytes = pkg.optionalPart(path);
  if (bytes === undefined) return undefined;
  const iter = new RecordIter(bytes);
  const buf: number[] = [];
  try {
    iter.nextSkipBlocks(
      0x0094,
      [
        [0x0081, undefined],
        [0x0093, undefined],
      ],
      buf,
    );
    iter.nextSkipBlocks(
      0x0091,
      [
        [0x0085, 0x0086],
        [0x0025, 0x0026],
        [0x01e5, undefined],
        [0x0186, 0x0187],
      ],
      buf,
    );
  } catch {
    return undefined;
  }

  const cells: SparseCell[] = [];
  let row = 0;
  for (;;) {
    const typ = iter.readType();
    if (typ === undefined) break;
    iter.fillBuffer(buf);
    const body = Uint8Array.from(buf);
    if (typ === 0x0092) break;
    if (typ === 0x0000) {
      if (body.length >= 4) row = u32(body, 0);
      if (row > 0x0010_0000) break;
      continue;
    }
    const value = cellValue(typ, body, strings, formats, is1904);
    if (value === undefined || value.kind === 'empty') continue;
    const col = body.length >= 4 ? u32(body, 0) : 0;
    cells.push({ row, col, value });
  }
  const dense = fromSparse(cells);
  if (dense === undefined) return undefined;
  return { name, ...dense, merges: [] };
}

function cellValue(
  typ: number,
  buf: Uint8Array,
  strings: string[],
  formats: CellFormat[],
  is1904: boolean,
): CellValue | undefined {
  const format = cellFormat(formats, buf);
  switch (typ) {
    case 0x0002: {
      if (buf.length < 12) return undefined;
      const flags = buf[8]!;
      const d100 = (flags & 1) !== 0;
      const isInt = (flags & 2) !== 0;
      const packed = new Uint8Array(buf.subarray(8, 12));
      packed[0] = packed[0]! & 0xfc;
      if (isInt) {
        const v = i32(packed, 0) >> 2;
        if (d100) return formatExcelF64(v / 100.0, format, is1904);
        return formatExcelI64(v, undefined, is1904);
      }
      const wide = new Uint8Array(8);
      wide.set(packed, 4);
      const v = f64(wide, 0);
      return formatExcelF64(d100 ? v / 100.0 : v, format, is1904);
    }
    case 0x0003: {
      if (buf.length < 9) return undefined;
      return errorFromCode(buf[8]!);
    }
    case 0x0004:
    case 0x000a:
      return { kind: 'bool', value: (buf[8] ?? 0) !== 0 };
    case 0x0005:
    case 0x0009:
      return buf.length >= 16 ? formatExcelF64(f64(buf, 8), format, is1904) : undefined;
    case 0x0006:
    case 0x0008:
      return buf.length > 8 ? { kind: 'string', value: wideStr(buf.subarray(8)) } : undefined;
    case 0x0007: {
      if (buf.length < 12) return undefined;
      const s = strings[u32(buf, 8)];
      return s === undefined ? undefined : { kind: 'string', value: s };
    }
    default:
      return undefined;
  }
}

function cellFormat(formats: CellFormat[], buf: Uint8Array): CellFormat | undefined {
  if (buf.length < 7) return undefined;
  const styleRef = buf[4]! | (buf[5]! << 8) | (buf[6]! << 16);
  return formats[styleRef];
}

function firstRelPath(
  pkg: Package,
  rels: Relationships,
  basePart: string,
  type: string,
): string | undefined {
  const rel = rels.firstOfType(type);
  if (rel === undefined) return undefined;
  try {
    const target = resolve(basePart, rel.target);
    if (pkg.hasPart(target.path)) return target.path;
  } catch {
    return undefined;
  }
  return undefined;
}

class RecordIter {
  private readonly bytes: Uint8Array;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  readType(): number | undefined {
    if (this.pos >= this.bytes.length) return undefined;
    const b = this.bytes[this.pos]!;
    this.pos += 1;
    if ((b & 0x80) === 0x80) {
      if (this.pos >= this.bytes.length) return undefined;
      const b2 = this.bytes[this.pos]!;
      this.pos += 1;
      return (b & 0x7f) + ((b2 & 0x7f) << 7);
    }
    return b;
  }

  fillBuffer(buf: number[]): number {
    if (this.pos >= this.bytes.length) {
      buf.length = 0;
      return 0;
    }
    let b = this.bytes[this.pos]!;
    this.pos += 1;
    let len = b & 0x7f;
    for (let i = 1; i < 4 && (b & 0x80) !== 0; i += 1) {
      if (this.pos >= this.bytes.length) break;
      b = this.bytes[this.pos]!;
      this.pos += 1;
      len += (b & 0x7f) << (7 * i);
    }
    const end = Math.min(this.bytes.length, this.pos + len);
    buf.length = 0;
    for (let i = this.pos; i < end; i += 1) buf.push(this.bytes[i]!);
    this.pos = end;
    return buf.length;
  }

  nextSkipBlocks(
    recordType: number,
    bounds: Array<[number, number | undefined]>,
    buf: number[],
  ): number {
    for (;;) {
      const typ = this.readType();
      if (typ === undefined) {
        throw ConvertError.malformed('unreadable workbook: truncated xlsb records');
      }
      const len = this.fillBuffer(buf);
      if (typ === recordType) return len;
      const bound = bounds.find((b) => b[0] === typ);
      if (bound !== undefined && bound[1] !== undefined) {
        const end = bound[1];
        while (this.readType() !== end) {
          this.fillBuffer(buf);
        }
        this.fillBuffer(buf);
      }
    }
  }
}

function wideStr(buf: Uint8Array): string {
  if (buf.length < 4) return '';
  const len = u32(buf, 0);
  const end = Math.min(buf.length, 4 + len * 2);
  return new TextDecoder('utf-16le').decode(buf.subarray(4, end));
}

function u16(b: Uint8Array, off: number): number {
  return b[off]! | (b[off + 1]! << 8);
}

function u32(b: Uint8Array, off: number): number {
  return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}

function usize(b: Uint8Array, off: number): number {
  return u32(b, off);
}

function i32(b: Uint8Array, off: number): number {
  const v = u32(b, off);
  return v > 0x7fffffff ? v - 0x100000000 : v;
}

function f64(b: Uint8Array, off: number): number {
  if (off + 8 > b.length) return Number.NaN;
  return new DataView(b.buffer, b.byteOffset + off, 8).getFloat64(0, true);
}
