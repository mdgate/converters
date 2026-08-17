export {
  deref,
  derefAll,
  detectIWorkKind,
  getObject,
  type IWorkArchive,
  openIWork,
} from './archive.js';
export {
  bodyStorageFromPages,
  collectDrawableBlocks,
  collectDrawableObject,
  findDocumentObject,
  keynoteSlides,
  numbersSheets,
  slideToBlocks,
} from './drawables.js';
export { buildIwa, type IwaObject, parseIwa } from './iwa.js';
export {
  decodeMessage,
  encodeBytesField,
  encodeMessageField,
  encodeStringField,
  encodeVarintField,
  fieldAllBytes,
  fieldBytes,
  fieldMessages,
  fieldString,
  fieldVarint,
  type ProtoField,
  readReference,
  readReferences,
} from './protobuf.js';
export { snappyDecode, snappyEncodeLiterals } from './snappy.js';
export { shapeStorageBlocks, storageObjectToBlocks, storageToBlocks } from './storage.js';
export {
  type SheetData,
  sheetsToDocument,
  tableBlocksFromInfo,
  tableInfoToRows,
} from './table.js';
export { type IWorkKind, TYPE } from './types.js';
