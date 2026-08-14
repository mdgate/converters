export { Package, probeOle } from './archive.js';
export { CompoundFile, hasOleMagic, OLE_MAGIC_BYTES } from './cfb.js';
export {
  MAX_ASSET_TOTAL_BYTES,
  MAX_ENTRY_BYTES,
  MAX_ENTRY_COUNT,
  MAX_EXPANSION,
  MAX_EXPANSION_TEXT_BYTES,
  MAX_RECORD_DEPTH,
  MAX_RECORDS,
  MAX_TOTAL_BYTES,
  MAX_XML_DEPTH,
  MAX_XML_NODES,
} from './limits.js';
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
