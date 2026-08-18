import { type CompoundFile, readOleStream } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { decode, encodingExists, warn } from '@mdgate/utils';
import { builtinFormatByCode, type CellFormat, detectCustomNumberFormat } from './numfmt.js';
import { type CellValue, EMPTY, errorFromCode, formatExcelF64, formatExcelI64 } from './values.js';
import { fromSparse, type MergeRegion, type SheetRange, type SparseCell } from './workbook.js';

type Biff = 2 | 3 | 4 | 5 | 8;

interface SheetMeta {
  pos: number;
  name: string;
}

const LATIN1 = new TextDecoder('latin1');
const UTF8 = new TextDecoder('utf-8');
const UTF16LE = new TextDecoder('utf-16le');
const UTF16BE = new TextDecoder('utf-16be');
const F64_SCRATCH = new DataView(new ArrayBuffer(8));

export function parseXlsCfb(ole: CompoundFile): SheetRange[] {
  const stream = readWorkbookStream(ole);

  let biff: Biff = 8;
  let encoding = encodingFromCodepage(1200);
  let is1904 = false;
  const sheetMetas: SheetMeta[] = [];
  const strings: string[] = [];
  const formats = new Map<number, CellFormat>();
  const xfs: number[] = [];

  // Parse workbook globals through the first EOF.
  walkRecords(stream, (typ, data, rec) => {
    switch (typ) {
      case 0x002f:
        if (u16(data, 0) !== 0) throw ConvertError.encrypted();
        break;
      case 0x0042:
        encoding = encodingFromCodepage(u16(data, 0));
        break;
      case 0x0022:
        if (u16(data, 0) === 1) is1904 = true;
        break;
      case 0x041e: {
        const parsed = parseFormat(data, encoding, biff);
        if (parsed !== undefined) formats.set(parsed.ifmt, parsed.format);
        break;
      }
      case 0x00e0:
        if (data.length >= 4) xfs.push(u16(data, 2));
        break;
      case 0x0085: {
        const meta = parseBoundSheet(rec ?? new BiffRecord(typ, data, []), encoding, biff);
        if (meta !== undefined) sheetMetas.push(meta);
        break;
      }
      case 0x0809: {
        const parsed = parseBof(data);
        if (parsed !== undefined) biff = parsed;
        break;
      }
      case 0x00fc:
        strings.push(...parseSst(rec ?? new BiffRecord(typ, data, []), encoding));
        break;
      default:
        break;
    }
    if (typ === 0x000a && sheetMetas.length > 0) return false;
    return;
  });

  const cellFormats: CellFormat[] = xfs.map((fmt) => formats.get(fmt) ?? builtinFormatByCode(fmt));

  const out: SheetRange[] = [];
  let failed = 0;
  for (const meta of sheetMetas) {
    if (meta.pos >= stream.length) {
      warn(
        `skipping unreadable sheet ${JSON.stringify(meta.name)}: bound offset past end of stream`,
      );
      failed += 1;
      continue;
    }
    try {
      const range = parseSheet(
        stream.subarray(meta.pos),
        meta.name,
        encoding,
        biff,
        strings,
        cellFormats,
        is1904,
      );
      if (range !== undefined) out.push(range);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      if (e instanceof ConvertError && e.code === 'encrypted') throw e;
      warn(
        `skipping unreadable sheet ${JSON.stringify(meta.name)}: ${e instanceof Error ? e.message : String(e)}`,
      );
      failed += 1;
    }
  }
  if (sheetMetas.length > 0 && failed === sheetMetas.length) {
    throw ConvertError.malformed('no sheet in the workbook could be read');
  }
  return out;
}

function readWorkbookStream(ole: CompoundFile): Uint8Array {
  for (const name of ['Workbook', 'Book', 'WORKBOOK', 'BOOK']) {
    if (ole.exists(name)) return readOleStream(ole, name);
  }
  throw ConvertError.malformed('unreadable workbook: Cannot find Workbook stream');
}

function parseSheet(
  stream: Uint8Array,
  name: string,
  encoding: XlsEncoding,
  biff: Biff,
  strings: string[],
  formats: CellFormat[],
  is1904: boolean,
): SheetRange | undefined {
  const cells: SparseCell[] = [];
  const merges: MergeRegion[] = [];
  let fmlaPos: [number, number] | undefined;

  walkRecords(stream, (typ, data) => {
    switch (typ) {
      case 0x0203: {
        const cell = parseNumber(data, formats, is1904);
        if (cell !== undefined) cells.push(cell);
        break;
      }
      case 0x0204:
      case 0x00d6: {
        const cell = parseLabel(data, encoding, biff);
        if (cell !== undefined) cells.push(cell);
        break;
      }
      case 0x0205: {
        const cell = parseBoolErr(data);
        if (cell !== undefined) cells.push(cell);
        break;
      }
      case 0x0207: {
        if (fmlaPos !== undefined) {
          const s = parseXlString(data, encoding, biff);
          if (s !== undefined)
            cells.push({ row: fmlaPos[0], col: fmlaPos[1], value: { kind: 'string', value: s } });
        }
        break;
      }
      case 0x027e: {
        const cell = parseRk(data, formats, is1904);
        if (cell !== undefined) cells.push(cell);
        break;
      }
      case 0x00fd: {
        const cell = parseLabelSst(data, strings);
        if (cell !== undefined) cells.push(cell);
        break;
      }
      case 0x00bd:
        parseMulRk(data, cells, formats, is1904);
        break;
      case 0x00e5:
        parseMergeCells(data, merges);
        break;
      case 0x0006: {
        if (data.length < 20) break;
        const row = u16(data, 0);
        const col = u16(data, 2);
        const format = formats[u16(data, 4)];
        fmlaPos = [row, col];
        const val = parseFormulaValue(data.subarray(6, 14), format, is1904);
        if (val !== undefined && val.kind !== 'empty') {
          cells.push({ row, col, value: val });
        }
        break;
      }
      case 0x000a:
        return false;
      default:
        break;
    }
    return;
  });

  const dense = fromSparse(cells);
  if (dense === undefined) return undefined;
  return { name, ...dense, merges };
}

function parseNumber(
  data: Uint8Array,
  formats: CellFormat[],
  is1904: boolean,
): SparseCell | undefined {
  if (data.length < 14) return undefined;
  const row = u16(data, 0);
  const col = u16(data, 2);
  const format = formats[u16(data, 4)];
  const v = f64(data, 6);
  return { row, col, value: formatExcelF64(v, format, is1904) };
}

function parseBoolErr(data: Uint8Array): SparseCell | undefined {
  if (data.length < 8) return undefined;
  const row = u16(data, 0);
  const col = u16(data, 2);
  if (data[7] === 0x00) return { row, col, value: { kind: 'bool', value: data[6] !== 0 } };
  if (data[7] === 0x01) {
    const err = errorFromCode(data[6]!);
    return err === undefined ? undefined : { row, col, value: err };
  }
  return undefined;
}

function parseRk(data: Uint8Array, formats: CellFormat[], is1904: boolean): SparseCell | undefined {
  if (data.length < 10) return undefined;
  return {
    row: u16(data, 0),
    col: u16(data, 2),
    value: rkNum(data.subarray(4, 10), formats, is1904),
  };
}

function parseMulRk(
  data: Uint8Array,
  cells: SparseCell[],
  formats: CellFormat[],
  is1904: boolean,
): void {
  if (data.length < 6) return;
  const row = u16(data, 0);
  const colFirst = u16(data, 2);
  const colLast = u16(data, data.length - 2);
  if (data.length !== 6 + 6 * (colLast - colFirst + 1)) return;
  let col = colFirst;
  for (let off = 4; off + 6 <= data.length - 2; off += 6) {
    cells.push({ row, col, value: rkNum(data.subarray(off, off + 6), formats, is1904) });
    col += 1;
  }
}

function rkNum(rk: Uint8Array, formats: CellFormat[], is1904: boolean): CellValue {
  const d100 = (rk[2]! & 1) !== 0;
  const isInt = (rk[2]! & 2) !== 0;
  const format = formats[u16(rk, 0)];
  if (isInt) {
    const v = i32(rk, 2) >> 2;
    if (d100 && v % 100 !== 0) return formatExcelF64(v / 100.0, format, is1904);
    return formatExcelI64(d100 ? Math.trunc(v / 100) : v, format, is1904);
  }
  F64_SCRATCH.setUint32(0, 0, true);
  F64_SCRATCH.setUint32(4, u32(rk, 2) & 0xfffffffc, true);
  const v = F64_SCRATCH.getFloat64(0, true);
  return formatExcelF64(d100 ? v / 100.0 : v, format, is1904);
}

function parseMergeCells(data: Uint8Array, merges: MergeRegion[]): void {
  if (data.length < 2) return;
  const count = u16(data, 0);
  for (let i = 0; i < count; i += 1) {
    const off = 2 + i * 8;
    if (off + 8 > data.length) break;
    merges.push({
      start: [u16(data, off), u16(data, off + 4)],
      end: [u16(data, off + 2), u16(data, off + 6)],
    });
  }
}

function parseLabel(data: Uint8Array, encoding: XlsEncoding, biff: Biff): SparseCell | undefined {
  if (data.length < 6) return undefined;
  const s = parseXlString(data.subarray(6), encoding, biff);
  if (s === undefined) return undefined;
  return { row: u16(data, 0), col: u16(data, 2), value: { kind: 'string', value: s } };
}

function parseLabelSst(data: Uint8Array, strings: string[]): SparseCell | undefined {
  if (data.length < 10) return undefined;
  const i = u32(data, 6);
  const s = strings[i];
  if (s === undefined) return undefined;
  return { row: u16(data, 0), col: u16(data, 2), value: { kind: 'string', value: s } };
}

function parseFormulaValue(
  data: Uint8Array,
  format: CellFormat | undefined,
  is1904: boolean,
): CellValue | undefined {
  if (data.length < 8) return undefined;
  if (data[6] === 0xff && data[7] === 0xff) {
    switch (data[0]) {
      case 0x00:
        return undefined;
      case 0x01:
        return { kind: 'bool', value: data[2] !== 0 };
      case 0x02: {
        const err = errorFromCode(data[2]!);
        return err ?? EMPTY;
      }
      case 0x03:
        return { kind: 'string', value: '' };
      default:
        return EMPTY;
    }
  }
  return formatExcelF64(f64(data, 0), format, is1904);
}

function parseBof(data: Uint8Array): Biff | undefined {
  if (data.length < 2) return undefined;
  const ver = u16(data, 0);
  const dt = data.length >= 4 ? u16(data, 2) : 0;
  switch (ver) {
    case 0x0200:
    case 0x0002:
    case 0x0007:
      return 2;
    case 0x0300:
      return 3;
    case 0x0400:
      return 4;
    case 0x0500:
      return 5;
    case 0x0600:
      return 8;
    case 0:
      return dt === 0x1000 ? 5 : 8;
    default:
      return 8;
  }
}

function parseBoundSheet(
  rec: BiffRecord,
  encoding: XlsEncoding,
  biff: Biff,
): SheetMeta | undefined {
  if (rec.data.length < 6) return undefined;
  const pos = u32(rec.data, 0);
  rec.consume(6);
  const name = parseShortString(rec, encoding, biff);
  if (name === undefined) return undefined;
  return { pos, name: name.replace(/\0/g, '') };
}

function parseFormat(
  data: Uint8Array,
  encoding: XlsEncoding,
  biff: Biff,
): { ifmt: number; format: CellFormat } | undefined {
  if (data.length < 2) return undefined;
  const ifmt = u16(data, 0);
  const allowed =
    (ifmt >= 5 && ifmt <= 8) ||
    (ifmt >= 23 && ifmt <= 26) ||
    (ifmt >= 41 && ifmt <= 44) ||
    (ifmt >= 63 && ifmt <= 66) ||
    (ifmt >= 164 && ifmt <= 382);
  if (!allowed) {
    warn(`skipping invalid number format id ${ifmt}`);
    return undefined;
  }
  const s = parseXlString(data.subarray(2), encoding, biff);
  if (s === undefined) return undefined;
  return { ifmt, format: detectCustomNumberFormat(s) };
}

function parseSst(rec: BiffRecord, encoding: XlsEncoding): string[] {
  if (rec.data.length < 8) return [];
  rec.consume(8);
  const sst: string[] = [];
  while (!rec.exhausted()) {
    sst.push(readRichExtendedString(rec, encoding));
  }
  return sst;
}

function readRichExtendedString(rec: BiffRecord, encoding: XlsEncoding): string {
  if (rec.exhausted()) return '';
  if (rec.remaining() < 3 && !rec.continueRecord()) return '';
  if (rec.remaining() < 3) return '';
  const cch = rec.u16();
  const flags = rec.u8();
  const highByte = (flags & 0x1) !== 0;
  let cRun = 0;
  let cbExtRst = 0;
  if ((flags & 0x8) !== 0) {
    if (rec.remaining() < 2 && !rec.continueRecord()) return '';
    cRun = rec.u16();
  }
  if ((flags & 0x4) !== 0) {
    if (rec.remaining() < 4 && !rec.continueRecord()) return '';
    cbExtRst = rec.i32();
  }
  const s = readDbcs(encoding, cch, rec, highByte);
  rec.skip(cRun * 4);
  rec.skip(Math.max(0, cbExtRst));
  return s;
}

function readDbcs(encoding: XlsEncoding, len: number, rec: BiffRecord, highByte0: boolean): string {
  let remaining = len;
  let highByte = highByte0;
  let out = '';
  while (remaining > 0) {
    const { chars, decoded, bytes } = encoding.decodeTo(rec.rest(), remaining, highByte);
    rec.consume(bytes);
    out += chars;
    remaining -= decoded;
    if (remaining > 0) {
      if (!rec.continueRecord()) break;
      if (rec.remaining() < 1) break;
      highByte = (rec.u8() & 0x1) !== 0;
    }
  }
  return out;
}

function parseShortString(rec: BiffRecord, encoding: XlsEncoding, biff: Biff): string | undefined {
  const biff8 = biff === 8;
  if (rec.remaining() < (biff8 ? 2 : 1)) return undefined;
  const cch = rec.u8();
  let highByte: boolean | undefined;
  if (biff8) {
    highByte = (rec.u8() & 0x1) !== 0;
  }
  const decoded = encoding.decodeTo(rec.rest(), cch, highByte);
  rec.consume(decoded.bytes);
  return decoded.chars;
}

function parseXlString(data: Uint8Array, encoding: XlsEncoding, biff: Biff): string | undefined {
  const expected = biff === 8 ? 3 : 2;
  if (data.length < expected) {
    if (data.length === 2 && u16(data, 0) === 0) return '';
    return undefined;
  }
  const cch = u16(data, 0);
  const highByte = biff === 8 ? (data[2]! & 0x1) !== 0 : undefined;
  return encoding.decodeTo(data.subarray(expected), cch, highByte).chars;
}

interface XlsEncoding {
  name: string;
  decodeTo(
    stream: Uint8Array,
    len: number,
    highByte: boolean | undefined,
  ): { chars: string; decoded: number; bytes: number };
}

function encodingFromCodepage(cp: number): XlsEncoding {
  const name = codepageName(cp);
  const singleByte = name !== 'utf16-le' && name !== 'utf16-be' && name !== 'utf8';
  return {
    name,
    decodeTo(stream, len, highByte) {
      const hb = highByte ?? (name === 'utf8' || singleByte ? undefined : false);
      if (hb === undefined) {
        const l = Math.min(stream.length, len);
        return { chars: decodeBytes(stream.subarray(0, l), name), decoded: l, bytes: l };
      }
      if (hb === false) {
        const l = Math.min(stream.length, len);
        // Compressed Unicode (high-byte=0) is UCS-2 with zero high bytes:
        // equivalent to Latin-1, cheaper than padding to UTF-16LE.
        return { chars: LATIN1.decode(stream.subarray(0, l)), decoded: l, bytes: l };
      }
      const l = Math.min(Math.floor(stream.length / 2), len);
      return {
        chars: decodeBytes(stream.subarray(0, 2 * l), 'utf16-le'),
        decoded: l,
        bytes: 2 * l,
      };
    },
  };
}

function decodeBytes(bytes: Uint8Array, enc: string): string {
  if (enc === 'utf8') return UTF8.decode(bytes);
  if (enc === 'utf16-le') return UTF16LE.decode(bytes);
  if (enc === 'utf16-be') return UTF16BE.decode(bytes);
  if (encodingExists(enc)) return decode(bytes, enc);
  return LATIN1.decode(bytes);
}

function codepageName(cp: number): string {
  const map: Record<number, string> = {
    437: 'cp437',
    850: 'cp850',
    852: 'cp852',
    855: 'cp855',
    857: 'cp857',
    860: 'cp860',
    861: 'cp861',
    862: 'cp862',
    863: 'cp863',
    864: 'cp864',
    865: 'cp865',
    866: 'cp866',
    869: 'cp869',
    874: 'windows-874',
    932: 'shiftjis',
    936: 'gbk',
    949: 'euc-kr',
    950: 'big5',
    1200: 'utf16-le',
    1201: 'utf16-be',
    1250: 'windows-1250',
    1251: 'windows-1251',
    1252: 'windows-1252',
    1253: 'windows-1253',
    1254: 'windows-1254',
    1255: 'windows-1255',
    1256: 'windows-1256',
    1257: 'windows-1257',
    1258: 'windows-1258',
    10000: 'macintosh',
    10001: 'shiftjis',
    10007: 'koi8-r',
    20127: 'ascii',
    20866: 'koi8-r',
    21866: 'koi8-u',
    28591: 'iso-8859-1',
    28592: 'iso-8859-2',
    28595: 'iso-8859-5',
    28597: 'iso-8859-7',
    28599: 'iso-8859-9',
    28605: 'iso-8859-15',
    50220: 'iso-2022-jp',
    50221: 'iso-2022-jp',
    50222: 'iso-2022-jp',
    51932: 'euc-jp',
    51949: 'euc-kr',
    52936: 'gb2312',
    54936: 'gb18030',
    65000: 'utf8',
    65001: 'utf8',
  };
  return map[cp] ?? 'windows-1252';
}

class BiffRecord {
  typ: number;
  private parts: Uint8Array[];
  private i = 0;
  private o = 0;

  constructor(typ: number, data: Uint8Array, cont: Uint8Array[]) {
    this.typ = typ;
    this.parts = [data, ...cont];
  }

  remaining(): number {
    const part = this.parts[this.i];
    return part === undefined ? 0 : part.length - this.o;
  }

  rest(): Uint8Array {
    const part = this.parts[this.i];
    return part === undefined ? new Uint8Array(0) : part.subarray(this.o);
  }

  exhausted(): boolean {
    while (this.i < this.parts.length) {
      if (this.remaining() > 0) return false;
      if (!this.continueRecord()) return true;
    }
    return true;
  }

  continueRecord(): boolean {
    if (this.i + 1 >= this.parts.length) return false;
    this.i += 1;
    this.o = 0;
    return true;
  }

  consume(n: number): void {
    this.o += n;
    while (this.i < this.parts.length && this.o >= (this.parts[this.i]?.length ?? 0)) {
      this.o -= this.parts[this.i]!.length;
      this.i += 1;
      if (this.i >= this.parts.length) {
        this.o = 0;
        break;
      }
    }
  }

  skip(n: number): void {
    let left = n;
    while (left > 0) {
      if (this.remaining() === 0 && !this.continueRecord()) return;
      const take = Math.min(left, this.remaining());
      this.consume(take);
      left -= take;
    }
  }

  u8(): number {
    if (this.remaining() < 1 && !this.continueRecord()) return 0;
    const v = this.rest()[0] ?? 0;
    this.consume(1);
    return v;
  }

  u16(): number {
    if (this.remaining() >= 2) {
      const v = u16(this.rest(), 0);
      this.consume(2);
      return v;
    }
    return this.u8() | (this.u8() << 8);
  }

  i32(): number {
    const b0 = this.u8();
    const b1 = this.u8();
    const b2 = this.u8();
    const b3 = this.u8();
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) << 0;
  }

  get data(): Uint8Array {
    if (this.parts.length === 1) return this.parts[0]!.subarray(this.o);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (let i = this.i; i < this.parts.length; i += 1) {
      const part = i === this.i ? this.parts[i]!.subarray(this.o) : this.parts[i]!;
      chunks.push(part);
      total += part.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

/** `false` stops the walk. */
function walkRecords(
  stream: Uint8Array,
  handler: (typ: number, data: Uint8Array, rec: BiffRecord | undefined) => boolean | undefined,
): void {
  let i = 0;
  while (i + 4 <= stream.length) {
    const typ = u16(stream, i);
    const len = u16(stream, i + 2);
    if (i + 4 + len > stream.length) break;
    const data = stream.subarray(i + 4, i + 4 + len);
    i += 4 + len;
    let rec: BiffRecord | undefined;
    if (i + 4 <= stream.length && u16(stream, i) === 0x003c) {
      const cont: Uint8Array[] = [];
      while (i + 4 <= stream.length && u16(stream, i) === 0x003c) {
        const clen = u16(stream, i + 2);
        if (i + 4 + clen > stream.length) break;
        cont.push(stream.subarray(i + 4, i + 4 + clen));
        i += 4 + clen;
      }
      rec = new BiffRecord(typ, data, cont);
    }
    const ctrl = handler(typ, rec !== undefined ? rec.data : data, rec);
    if (ctrl === false) return;
  }
}

function u16(b: Uint8Array, off: number): number {
  return off + 1 < b.length ? b[off]! | (b[off + 1]! << 8) : 0;
}

function u32(b: Uint8Array, off: number): number {
  if (off + 3 >= b.length) return 0;
  return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}

function i32(b: Uint8Array, off: number): number {
  return u32(b, off) << 0;
}

function f64(b: Uint8Array, off: number): number {
  if (off + 8 > b.length) return Number.NaN;
  F64_SCRATCH.setUint32(0, u32(b, off), true);
  F64_SCRATCH.setUint32(4, u32(b, off + 4), true);
  return F64_SCRATCH.getFloat64(0, true);
}
