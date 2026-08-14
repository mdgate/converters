import type { Asset } from './asset.js';
import type { Block } from './block.js';

export type { Asset, AssetId } from './asset.js';
export type { Block } from './block.js';
export { heading } from './block.js';
export {
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  plain,
} from './inline.js';
export {
  type AnchorId,
  type ImageSource,
  type LinkTarget,
  linkTargetIsEmpty,
} from './link.js';
export {
  emptyListItem,
  type List,
  type ListItem,
  listIsOrdered,
  type MarkerKind,
  markerIsOrdered,
  markerLabel,
  markerOrdinal,
} from './list.js';
export { PLAIN, type Style, stylesEqual } from './style.js';
export {
  type Cell,
  type CellSlot,
  cellFromInlines,
  cellIsEmpty,
  cellSpanning,
  emptyCell,
  GridBuilder,
  newCell,
  type Table,
  type TableKind,
  tableFromRows,
  tableIsSingleCell,
} from './table.js';

/** A parsed document: its body, its notes, and the bytes of everything it embedded. */
export interface Document {
  blocks: Block[];
  notes: Note[];
  assets: Asset[];
}

export function emptyDocument(): Document {
  return { blocks: [], notes: [], assets: [] };
}

/** Footnote or endnote body, referenced from text by a noteRef inline. */
export interface Note {
  id: string;
  kind: NoteKind;
  blocks: Block[];
}

/** Where the source document places a note. */
export type NoteKind = 'footnote' | 'endnote';
