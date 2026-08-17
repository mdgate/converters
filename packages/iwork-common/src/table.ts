import {
  type Block,
  type Cell,
  cellFromInlines,
  type Document,
  emptyDocument,
  heading,
  plain,
  tableFromRows,
} from '@mdgate/document';
import type { IWorkArchive } from './archive.js';
import { deref, getObject } from './archive.js';
import {
  decodeMessage,
  fieldBytes,
  fieldMessages,
  fieldString,
  fieldVarint,
  type ProtoField,
  readReference,
} from './protobuf.js';
import { storageToBlocks } from './storage.js';
import { TYPE } from './types.js';

export interface SheetData {
  name: string;
  rows: string[][];
}

/** Read TST.TableInfoArchive / WPTableInfoArchive into a string grid. */
export function tableInfoToRows(archive: IWorkArchive, tableInfo: ProtoField[]): string[][] {
  // WPTableInfoArchive wraps TableInfoArchive at field 1.
  let infoFields = tableInfo;
  const inner = deref(archive, tableInfo, 1);
  // If field 1 is DrawableArchive-shaped without tableModel, try tableModel on self.
  let model = deref(archive, infoFields, 2);
  if (model === undefined && inner !== undefined) {
    infoFields = inner.fields;
    model = deref(archive, infoFields, 2);
  }
  if (model === undefined) return [];
  return tableModelToRows(archive, model.fields);
}

export function tableModelToRows(archive: IWorkArchive, model: ProtoField[]): string[][] {
  const nRows = fieldVarint(model, 6) ?? 0;
  const nCols = fieldVarint(model, 7) ?? 0;
  if (nRows === 0 || nCols === 0) return [];

  const dataStoreBytes = fieldBytes(model, 4);
  if (dataStoreBytes === undefined) return [];
  const dataStore = decodeMessage(dataStoreBytes);

  const stringTable = loadDataListStrings(archive, readReference(fieldBytes(dataStore, 4)));
  const richTable = loadDataListRich(archive, readReference(fieldBytes(dataStore, 17)));

  const grid: string[][] = Array.from({ length: nRows }, () =>
    Array.from({ length: nCols }, () => ''),
  );

  const tilesMsg = fieldBytes(dataStore, 3);
  if (tilesMsg === undefined) return grid;
  const tileStorage = decodeMessage(tilesMsg);
  for (const tileEntry of fieldMessages(tileStorage, 1)) {
    const tileObj = getObject(archive, readReference(fieldBytes(tileEntry, 2)));
    if (tileObj === undefined) continue;
    const rowInfos = fieldMessages(tileObj.fields, 5);
    for (const rowInfo of rowInfos) {
      const tileRowIndex = fieldVarint(rowInfo, 1) ?? 0;
      // Prefer BNC buffers (fields 6/7); fall back to pre-BNC (3/4).
      const storage = fieldBytes(rowInfo, 6) ?? fieldBytes(rowInfo, 3) ?? new Uint8Array();
      const offsetsBytes = fieldBytes(rowInfo, 7) ?? fieldBytes(rowInfo, 4) ?? new Uint8Array();
      if (offsetsBytes.length < 2) continue;
      const aligned = new Uint8Array(offsetsBytes.byteLength);
      aligned.set(offsetsBytes);
      const offsets = new Uint16Array(aligned.buffer, 0, Math.floor(aligned.length / 2));
      for (let c = 0; c < offsets.length && c < nCols; c += 1) {
        const offset = offsets[c]!;
        if (offset === 0xffff) continue;
        const row = tileRowIndex; // simplistic; large tables use rowTileTree
        if (row < 0 || row >= nRows) continue;
        grid[row]![c] = readCellText(storage, offset, stringTable, richTable, archive);
      }
    }
  }

  // Trim trailing empty rows/cols for markdown cleanliness.
  return trimGrid(grid);
}

export function sheetsToDocument(sheets: SheetData[]): Document {
  const doc = emptyDocument();
  const multi = sheets.length > 1;
  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;
    if (multi) doc.blocks.push(heading(2, [plain(sheet.name)]));
    const cells: Cell[][] = sheet.rows.map((row) =>
      row.map((text) => cellFromInlines([plain(text)])),
    );
    const headerRows = sheet.rows.length > 1 ? 1 : 0;
    doc.blocks.push({ type: 'table', table: tableFromRows(cells, headerRows, 'data') });
  }
  return doc;
}

export function tableBlocksFromInfo(archive: IWorkArchive, fields: ProtoField[]): Block[] {
  const rows = tableInfoToRows(archive, fields);
  if (rows.length === 0) return [];
  const name = '';
  const doc = sheetsToDocument([{ name, rows }]);
  return doc.blocks;
}

function loadDataListStrings(archive: IWorkArchive, id: number | undefined): Map<number, string> {
  const map = new Map<number, string>();
  const obj = getObject(archive, id);
  if (obj === undefined) return map;
  for (const entry of fieldMessages(obj.fields, 3)) {
    const key = fieldVarint(entry, 1);
    const str = fieldString(entry, 3);
    if (key !== undefined && str !== undefined) map.set(key, str);
  }
  return map;
}

function loadDataListRich(archive: IWorkArchive, id: number | undefined): Map<number, number> {
  // key → rich text payload object id
  const map = new Map<number, number>();
  const obj = getObject(archive, id);
  if (obj === undefined) return map;
  for (const entry of fieldMessages(obj.fields, 3)) {
    const key = fieldVarint(entry, 1);
    const payloadId = readReference(fieldBytes(entry, 9));
    if (key !== undefined && payloadId !== undefined) map.set(key, payloadId);
  }
  return map;
}

function readCellText(
  storage: Uint8Array,
  offset: number,
  strings: Map<number, string>,
  rich: Map<number, number>,
  archive: IWorkArchive,
): string {
  if (offset + 8 > storage.length) return '';
  const versionByte = storage[offset]!;
  // V5 (BNC): type at +1, flags at +8 (u32). Older: varies.
  let cellType: number;
  let flags: number;
  let flagsSize: number;
  let dataStart: number;

  if (versionByte === 5 || storage[offset]! >= 5) {
    cellType = storage[offset + 1]!;
    flags =
      storage[offset + 8]! |
      (storage[offset + 9]! << 8) |
      (storage[offset + 10]! << 16) |
      (storage[offset + 11]! << 24);
    flagsSize = 4;
    dataStart = offset + 12;
    return decodeCellV5(storage, cellType, flags, dataStart, strings, rich, archive);
  }

  // Legacy / V4 path used by older samples and Go converter.
  if (storage[offset] === 4) {
    cellType = storage[offset + 1]!;
    flags = storage[offset + 4]! | (storage[offset + 5]! << 8);
    flagsSize = 2;
    dataStart = offset + 8;
  } else {
    cellType = storage[offset + 2]!;
    flags = storage[offset + 4]! | (storage[offset + 5]! << 8);
    flagsSize = 2;
    dataStart = offset + 8;
  }
  void flagsSize;

  const pop = popcount16(flags & 0xffff);
  // Value pointer sits after flag-selected uint32 fields (simplified).
  let o = dataStart + pop * 4;
  // Simpler heuristic matching dunhamsteve: skip to value using popcount of low flags.
  o = dataStart + popcount16(flags) * 4;

  if (cellType === 0) return '';
  if (cellType === 2 || cellType === 5 || cellType === 6 || cellType === 7) {
    if (o + 8 > storage.length) return '';
    const value = readFloat64(storage, o);
    if (cellType === 6) return value !== 0 ? 'TRUE' : 'FALSE';
    if (cellType === 5) return formatAppleDate(value);
    return formatNumber(value);
  }
  if (cellType === 3 || cellType === 9) {
    if (o + 4 > storage.length) return '';
    const key =
      storage[o]! | (storage[o + 1]! << 8) | (storage[o + 2]! << 16) | (storage[o + 3]! << 24);
    if (cellType === 3) return strings.get(key >>> 0) ?? '';
    const payloadId = rich.get(key >>> 0);
    return richPayloadText(archive, payloadId);
  }
  return '';
}

function decodeCellV5(
  storage: Uint8Array,
  cellType: number,
  flags: number,
  dataStart: number,
  strings: Map<number, string>,
  rich: Map<number, number>,
  archive: IWorkArchive,
): string {
  // Walk fields in flag bit order (SheetJS V5 table).
  let o = dataStart;
  const take = (bit: number, size: number): Uint8Array | undefined => {
    if ((flags & bit) === 0) return undefined;
    if (o + size > storage.length) return undefined;
    const slice = storage.subarray(o, o + size);
    o += size;
    return slice;
  };

  take(0x000001, 16); // decimal128
  const doubleBytes = take(0x000002, 8);
  const dateBytes = take(0x000004, 8);
  const stringIdBytes = take(0x000008, 4);
  const richIdBytes = take(0x000010, 4);
  // skip style ids etc.
  take(0x000020, 4);
  take(0x000040, 4);
  take(0x000080, 4);
  take(0x000100, 4);
  take(0x000200, 4);
  take(0x000400, 4);
  take(0x000800, 4);

  if (cellType === 0) return '';
  if (cellType === 2 && doubleBytes !== undefined) {
    return formatNumber(readFloat64(doubleBytes, 0));
  }
  if (cellType === 5 && dateBytes !== undefined) {
    return formatAppleDate(readFloat64(dateBytes, 0));
  }
  if (cellType === 6 && doubleBytes !== undefined) {
    return readFloat64(doubleBytes, 0) !== 0 ? 'TRUE' : 'FALSE';
  }
  if (cellType === 3 && stringIdBytes !== undefined) {
    const key =
      stringIdBytes[0]! |
      (stringIdBytes[1]! << 8) |
      (stringIdBytes[2]! << 16) |
      (stringIdBytes[3]! << 24);
    return strings.get(key >>> 0) ?? '';
  }
  if (cellType === 9 && richIdBytes !== undefined) {
    const key =
      richIdBytes[0]! | (richIdBytes[1]! << 8) | (richIdBytes[2]! << 16) | (richIdBytes[3]! << 24);
    return richPayloadText(archive, rich.get(key >>> 0));
  }
  // Fallback: try string id even if type unexpected.
  if (stringIdBytes !== undefined) {
    const key =
      stringIdBytes[0]! |
      (stringIdBytes[1]! << 8) |
      (stringIdBytes[2]! << 16) |
      (stringIdBytes[3]! << 24);
    const s = strings.get(key >>> 0);
    if (s !== undefined) return s;
  }
  return '';
}

function richPayloadText(archive: IWorkArchive, payloadId: number | undefined): string {
  const payload = getObject(archive, payloadId);
  if (payload === undefined) return '';
  const storageId = readReference(fieldBytes(payload.fields, 1));
  const storage = getObject(archive, storageId);
  if (storage === undefined) return '';
  const blocks = storageToBlocks(archive, storage.fields);
  return blocks
    .map((b) => {
      if (b.type === 'paragraph') {
        return b.inlines.map((i) => (i.type === 'text' ? i.text : '')).join('');
      }
      if (b.type === 'heading') {
        return b.content.map((i) => (i.type === 'text' ? i.text : '')).join('');
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function readFloat64(bytes: Uint8Array, offset: number): number {
  const tmp = new Uint8Array(8);
  tmp.set(bytes.subarray(offset, offset + 8));
  return new DataView(tmp.buffer).getFloat64(0, true);
}

function trimGrid(grid: string[][]): string[][] {
  let maxRow = -1;
  let maxCol = -1;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r]!.length; c += 1) {
      if (grid[r]![c] !== '') {
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
      }
    }
  }
  if (maxRow < 0) return [];
  return grid.slice(0, maxRow + 1).map((row) => row.slice(0, maxCol + 1));
}

function popcount16(v: number): number {
  let x = v & 0xffff;
  let c = 0;
  while (x) {
    x &= x - 1;
    c += 1;
  }
  return c;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

function formatAppleDate(seconds: number): string {
  // Apple absolute reference date: 2001-01-01 UTC
  const ms = (seconds + 978307200) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Try to interpret any drawable as a table. */
export function drawableAsTable(
  archive: IWorkArchive,
  obj: { type: number; fields: ProtoField[] },
): Block[] {
  if (obj.type === TYPE.TST_TABLE_INFO || obj.type === TYPE.TST_WP_TABLE_INFO) {
    return tableBlocksFromInfo(archive, obj.fields);
  }
  return [];
}
