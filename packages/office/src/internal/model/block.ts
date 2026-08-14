import type { Inline } from './inline.js';
import type { AnchorId } from './link.js';
import type { List } from './list.js';
import type { Table } from './table.js';

/** One block-level piece of a document body. */
export type Block =
  | {
      type: 'heading';
      /** Outline depth as the source assigns it, 1-based. Renderers clamp. */
      level: number;
      /** Stable anchor id when the source document targets this heading. */
      anchor: AnchorId | undefined;
      content: Inline[];
    }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; list: List }
  | { type: 'table'; table: Table }
  | { type: 'blockQuote'; blocks: Block[] }
  | { type: 'codeBlock'; lang: string | undefined; text: string }
  | { type: 'rule' };

/** A heading with no anchor. */
export function heading(level: number, content: Inline[]): Block {
  return { type: 'heading', level, anchor: undefined, content };
}
