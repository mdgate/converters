import {
  buildIwa,
  encodeBytesField,
  encodeMessageField,
  encodeStringField,
  encodeVarintField,
  TYPE,
} from '../src/index.js';

/** Minimal store-only ZIP (no compression) for synthetic iWork fixtures. */
export function zipStore(files: Record<string, Uint8Array>): Uint8Array {
  const locals: number[] = [];
  const centrals: number[] = [];
  let offset = 0;
  const entries: { name: string; data: Uint8Array; localOffset: number }[] = [];

  for (const [name, data] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const localOffset = offset;
    entries.push({ name, data, localOffset });

    // local file header
    writeU32(locals, 0x04034b50);
    writeU16(locals, 20);
    writeU16(locals, 0);
    writeU16(locals, 0); // store
    writeU16(locals, 0);
    writeU16(locals, 0);
    writeU32(locals, crc32(data));
    writeU32(locals, data.length);
    writeU32(locals, data.length);
    writeU16(locals, nameBytes.length);
    writeU16(locals, 0);
    for (const b of nameBytes) locals.push(b);
    for (const b of data) locals.push(b);
    offset = locals.length;
  }

  const cdOffset = locals.length;
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    writeU32(centrals, 0x02014b50);
    writeU16(centrals, 20);
    writeU16(centrals, 20);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU32(centrals, crc32(e.data));
    writeU32(centrals, e.data.length);
    writeU32(centrals, e.data.length);
    writeU16(centrals, nameBytes.length);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU32(centrals, 0);
    writeU32(centrals, e.localOffset);
    for (const b of nameBytes) centrals.push(b);
  }

  const out = [...locals, ...centrals];
  const cdSize = centrals.length;
  writeU32(out, 0x06054b50);
  writeU16(out, 0);
  writeU16(out, 0);
  writeU16(out, entries.length);
  writeU16(out, entries.length);
  writeU32(out, cdSize);
  writeU32(out, cdOffset);
  writeU16(out, 0);
  return Uint8Array.from(out);
}

function ref(id: number): number[] {
  return encodeVarintField(1, id);
}

function refField(field: number, id: number): number[] {
  return encodeMessageField(field, ref(id));
}

/** Tiny Pages document: one body paragraph. */
export function samplePages(text = 'Hello from Pages'): Uint8Array {
  const storageId = 10;
  const docPayload = Uint8Array.from([
    ...refField(15, 99), // TSA.DocumentArchive super (dummy)
    ...refField(4, storageId), // body_storage
  ]);
  const storagePayload = Uint8Array.from([
    ...encodeVarintField(1, 0), // BODY
    ...encodeStringField(3, `${text}\n`),
    // Empty para style table with one entry at index 0, no style object.
    ...encodeMessageField(5, [...encodeMessageField(1, [...encodeVarintField(1, 0)])]),
  ]);

  const iwa = buildIwa([
    { id: 1, type: TYPE.TP_DOCUMENT, payload: docPayload },
    { id: storageId, type: TYPE.TSWP_STORAGE, payload: storagePayload },
  ]);

  return zipStore({
    'Index/Document.iwa': iwa,
    'Metadata/DocumentIdentifier': new TextEncoder().encode('test-pages'),
  });
}

/** Tiny Numbers workbook: one sheet, one 2x2 string table. */
export function sampleNumbers(): Uint8Array {
  const sheetId = 2;
  const tableInfoId = 3;
  const tableModelId = 4;
  const tileId = 5;
  const stringTableId = 6;

  const docPayload = Uint8Array.from([
    ...refField(1, sheetId),
    ...refField(8, 99),
    ...refField(4, 98),
    ...refField(5, 97),
    ...refField(6, 96),
  ]);
  const sheetPayload = Uint8Array.from([
    ...encodeStringField(1, 'Sheet 1'),
    ...refField(2, tableInfoId),
  ]);
  const tableInfoPayload = Uint8Array.from([
    ...refField(1, 95), // drawable super
    ...refField(2, tableModelId),
  ]);

  // Build a simple V4-ish cell storage: two string cells.
  // For fixture simplicity, put plaintext strings via string table keys 1 and 2.
  const stringTablePayload = Uint8Array.from([
    ...encodeVarintField(1, 1), // STRING
    ...encodeVarintField(2, 3),
    ...encodeMessageField(3, [
      ...encodeVarintField(1, 1),
      ...encodeVarintField(2, 1),
      ...encodeStringField(3, 'Name'),
    ]),
    ...encodeMessageField(3, [
      ...encodeVarintField(1, 2),
      ...encodeVarintField(2, 1),
      ...encodeStringField(3, 'Ada'),
    ]),
  ]);

  // Minimal cell buffer: type 3 string at offsets — use empty grid fallback via
  // table model dimensions + manually no tiles → empty. Instead embed one tile
  // with pre-BNC buffers encoding two string cells in row 0.
  const cellStorage = buildLegacyStringRow([1, 2]);
  const cellOffsets = new Uint8Array(4);
  new DataView(cellOffsets.buffer).setUint16(0, 0, true);
  new DataView(cellOffsets.buffer).setUint16(2, cellStorage.stride, true);

  const tilePayload = Uint8Array.from([
    ...encodeVarintField(1, 2),
    ...encodeVarintField(2, 1),
    ...encodeVarintField(3, 2),
    ...encodeVarintField(4, 1),
    ...encodeMessageField(5, [
      ...encodeVarintField(1, 0),
      ...encodeVarintField(2, 2),
      ...encodeBytesField(3, cellStorage.buffer),
      ...encodeBytesField(4, cellOffsets),
    ]),
  ]);

  const dataStore = [
    ...encodeMessageField(3, [
      ...encodeMessageField(1, [...encodeVarintField(1, 0), ...refField(2, tileId)]),
    ]),
    ...refField(4, stringTableId),
    ...encodeMessageField(9, []), // rowTileTree
    ...encodeMessageField(10, []),
    ...encodeVarintField(7, 1),
    ...encodeVarintField(8, 1),
  ];

  const tableModelPayload = Uint8Array.from([
    ...encodeStringField(1, 'table-1'),
    ...encodeMessageField(4, dataStore),
    ...encodeVarintField(6, 1),
    ...encodeVarintField(7, 2),
    ...encodeStringField(8, 'Table'),
    ...refField(3, 94),
    ...refField(24, 93),
    ...refField(25, 92),
    ...refField(26, 91),
    ...refField(27, 90),
    ...refField(18, 89),
    ...refField(19, 88),
    ...refField(20, 87),
    ...refField(21, 86),
    ...encodeVarintField(28, 0),
    ...encodeVarintField(16, 20), // default heights as varint — proto says double; ok for fixture skip
  ]);

  // Doubles for default_row_height / default_column_width — encode as fixed64-ish skip;
  // our reader doesn't need them.

  const iwa = buildIwa([
    { id: 1, type: TYPE.TN_DOCUMENT, payload: docPayload },
    { id: sheetId, type: TYPE.TN_SHEET, payload: sheetPayload },
    { id: tableInfoId, type: TYPE.TST_TABLE_INFO, payload: tableInfoPayload },
    { id: tableModelId, type: TYPE.TST_TABLE_MODEL, payload: tableModelPayload },
    { id: tileId, type: TYPE.TST_TILE, payload: tilePayload },
    { id: stringTableId, type: TYPE.TST_TABLE_DATA_LIST, payload: stringTablePayload },
  ]);

  return zipStore({
    'Index/Document.iwa': iwa,
    'Index/CalculationEngine.iwa': buildIwa([]),
    'Metadata/DocumentIdentifier': new TextEncoder().encode('test-numbers'),
  });
}

function buildLegacyStringRow(keys: number[]): { buffer: Uint8Array; stride: number } {
  // Each cell: version=4, type=3, flags with string bit 0x10, then fields…
  // Simplified layout matching Go converter expectations:
  // [0]=4, [1]=type, [4..5]=flags, then popcount*4 padding, then key u32
  const cells: Uint8Array[] = [];
  for (const key of keys) {
    const buf = new Uint8Array(16);
    buf[0] = 4;
    buf[1] = 3; // string
    buf[4] = 0x10; // string id flag
    buf[5] = 0;
    // popcount(0x10)=1 → one uint32 field before key at offset 8
    // Actually Go does: o = popcount(flags)*4 + 8 + offset; key at o
    // So key at byte 12 if one flag bit.
    buf[12] = key & 0xff;
    buf[13] = (key >> 8) & 0xff;
    buf[14] = (key >> 16) & 0xff;
    buf[15] = (key >> 24) & 0xff;
    cells.push(buf);
  }
  const stride = 16;
  const buffer = new Uint8Array(stride * cells.length);
  for (let i = 0; i < cells.length; i += 1) buffer.set(cells[i]!, i * stride);
  return { buffer, stride };
}

/** Tiny Keynote deck: one slide with title shape text. */
export function sampleKeynote(title = 'Hello Keynote'): Uint8Array {
  const showId = 2;
  const rootNodeId = 3;
  const slideId = 4;
  const shapeId = 5;
  const storageId = 6;

  const docPayload = Uint8Array.from([...refField(3, 99), ...refField(2, showId)]);
  // ShowArchive: slideTree embedded { root = 1 → rootNodeId }
  const slideTree = encodeMessageField(1, ref(rootNodeId));
  const showPayload = Uint8Array.from([
    ...refField(2, 98),
    ...encodeBytesField(3, Uint8Array.from(slideTree)),
    ...encodeMessageField(4, [...encodeVarintField(1, 0), ...encodeVarintField(2, 0)]), // size stub
    ...refField(5, 97),
  ]);
  // Actually size is TSP.Size with floats — skip strictness; reader doesn't need it.

  const nodePayload = Uint8Array.from([
    ...refField(2, slideId),
    ...encodeVarintField(4, 0), // isHidden
    ...encodeVarintField(5, 0),
    ...encodeVarintField(6, 0),
    ...encodeVarintField(7, 0),
  ]);

  const storagePayload = Uint8Array.from([
    ...encodeVarintField(1, 3), // TEXTBOX
    ...encodeStringField(3, `${title}\n`),
    ...encodeMessageField(5, [...encodeMessageField(1, [...encodeVarintField(1, 0)])]),
  ]);

  const shapePayload = Uint8Array.from([
    ...refField(1, 96), // TSD.ShapeArchive super
    ...refField(2, storageId),
  ]);

  const slidePayload = Uint8Array.from([
    ...refField(1, 95),
    ...encodeMessageField(4, []), // transition stub
    ...refField(5, shapeId), // titlePlaceholder
    ...encodeVarintField(19, 1), // inDocument
  ]);

  const iwa = buildIwa([
    { id: 1, type: TYPE.KN_DOCUMENT, payload: docPayload },
    { id: showId, type: TYPE.KN_SHOW, payload: showPayload },
    { id: rootNodeId, type: TYPE.KN_SLIDE_NODE, payload: nodePayload },
    { id: slideId, type: TYPE.KN_SLIDE, payload: slidePayload },
    { id: shapeId, type: TYPE.TSWP_SHAPE_INFO, payload: shapePayload },
    { id: storageId, type: TYPE.TSWP_STORAGE, payload: storagePayload },
  ]);

  // Also add a Slide-*.iwa path hint for structural detection
  return zipStore({
    'Index/Document.iwa': iwa,
    'Index/Slide-00001.iwa': buildIwa([]),
    'Metadata/DocumentIdentifier': new TextEncoder().encode('test-keynote'),
  });
}

/** Keynote 2013-style slideTree: slide nodes are repeated refs on field 2. */
export function sampleKeynoteField2(title = 'Hello Field Two'): Uint8Array {
  const showId = 2;
  const rootNodeId = 3;
  const slideId = 4;
  const shapeId = 5;
  const storageId = 6;

  const docPayload = Uint8Array.from([...refField(3, 99), ...refField(2, showId)]);
  const slideTree = encodeMessageField(2, ref(rootNodeId));
  const showPayload = Uint8Array.from([
    ...refField(2, 98),
    ...encodeBytesField(3, Uint8Array.from(slideTree)),
  ]);
  const nodePayload = Uint8Array.from([...refField(2, slideId), ...encodeVarintField(4, 0)]);
  const storagePayload = Uint8Array.from([
    ...encodeVarintField(1, 3),
    ...encodeStringField(3, `${title}\n`),
    ...encodeMessageField(5, [...encodeMessageField(1, [...encodeVarintField(1, 0)])]),
  ]);
  const shapePayload = Uint8Array.from([...refField(1, 96), ...refField(2, storageId)]);
  const slidePayload = Uint8Array.from([
    ...refField(1, 95),
    ...refField(5, shapeId),
    ...encodeVarintField(19, 1),
  ]);
  const iwa = buildIwa([
    { id: 1, type: TYPE.KN_DOCUMENT, payload: docPayload },
    { id: showId, type: TYPE.KN_SHOW, payload: showPayload },
    { id: rootNodeId, type: TYPE.KN_SLIDE_NODE, payload: nodePayload },
    { id: slideId, type: TYPE.KN_SLIDE, payload: slidePayload },
    { id: shapeId, type: TYPE.TSWP_SHAPE_INFO, payload: shapePayload },
    { id: storageId, type: TYPE.TSWP_STORAGE, payload: storagePayload },
  ]);
  return zipStore({
    'Index/Document.iwa': iwa,
    'Index/Slide-00001.iwa': buildIwa([]),
  });
}

function writeU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

function writeU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
