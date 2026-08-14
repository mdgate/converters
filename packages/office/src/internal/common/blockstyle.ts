import { type Block, type Inline, inlinesAreEmpty, inlinesToPlainText } from '../model/index.js';
import { trim } from '../unicode.js';

/** The block container a paragraph style designates. */
export type BlockStyle = 'quote' | 'code';

/** The container a paragraph style name designates. ODF encodes spaces as `_20_`. */
export function fromStyleName(name: string): BlockStyle | undefined {
  const normalized = name.replace(/_20_/g, ' ');
  switch (trim(normalized).toLowerCase()) {
    case 'quote':
    case 'intense quote':
    case 'block text':
    case 'quotations':
      return 'quote';
    case 'html preformatted':
    case 'source code':
    case 'preformatted text':
      return 'code';
    default:
      return undefined;
  }
}

/** Consecutive paragraphs sharing one styled container. */
export class StyledRun {
  private kind: BlockStyle | undefined;
  private quoteBlocks: Block[] = [];
  private codeLines: string[] = [];

  style(): BlockStyle | undefined {
    return this.kind;
  }

  push(style: BlockStyle, inlines: Inline[], out: Block[]): void {
    if (this.kind !== style) {
      this.flush(out);
      this.kind = style;
      this.quoteBlocks = [];
      this.codeLines = [];
    }
    if (this.kind === 'code') {
      this.codeLines.push(inlinesToPlainText(inlines));
    } else if (this.kind === 'quote') {
      if (!inlinesAreEmpty(inlines)) {
        this.quoteBlocks.push({ type: 'paragraph', inlines });
      }
    }
  }

  flush(out: Block[]): void {
    if (this.kind === 'quote') {
      if (this.quoteBlocks.length > 0) {
        out.push({ type: 'blockQuote', blocks: this.quoteBlocks });
      }
    } else if (this.kind === 'code') {
      let first = -1;
      let last = -1;
      for (let i = 0; i < this.codeLines.length; i += 1) {
        if (trim(this.codeLines[i]!).length > 0) {
          if (first < 0) first = i;
          last = i;
        }
      }
      if (first >= 0 && last >= 0) {
        out.push({
          type: 'codeBlock',
          lang: undefined,
          text: this.codeLines.slice(first, last + 1).join('\n'),
        });
      }
    }
    this.kind = undefined;
    this.quoteBlocks = [];
    this.codeLines = [];
  }
}
