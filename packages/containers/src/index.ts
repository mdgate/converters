export { Package, probeOle } from './archive.js';
export { getU16, getU32, readOleStream } from './binary.js';
export { CompoundFile, hasOleMagic, OLE_MAGIC_BYTES } from './cfb.js';
export {
  detectOleDoc,
  detectZipDoc,
  type OleDocKind,
  type ZipDocKind,
} from './detect.js';
export {
  MAX_ENTRY_BYTES,
  MAX_ENTRY_COUNT,
  MAX_RECORD_DEPTH,
  MAX_RECORDS,
  MAX_TOTAL_BYTES,
  MAX_XML_DEPTH,
  MAX_XML_NODES,
} from './limits.js';
export {
  type MimeHeader,
  type MimePart,
  mimeAttachments,
  mimeHeader,
  mimeTextHtml,
  mimeTextPlain,
  parseMime,
  walkMimeParts,
} from './mime.js';
export { decodeFragment, resolve, type Target } from './path.js';
export {
  type Relationship,
  Relationships,
  type RelTarget,
  readRels,
  relsPartFor,
  relTargetBytes,
  relType,
  type TargetMode,
} from './relationships.js';
export {
  type Attr,
  Element,
  normalizeOoxmlUri,
  ns,
  parseXml,
  type XmlNode,
} from './xml.js';
