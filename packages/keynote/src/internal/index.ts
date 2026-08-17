import {
  type Block,
  type Document,
  emptyDocument,
  heading,
  inlinesAreEmpty,
  inlinesToPlainText,
  plain,
} from '@mdgate/document';
import { keynoteSlides, openIWork, slideToBlocks } from '@mdgate/iwork-common';

export function parse(bytes: Uint8Array): Document {
  const archive = openIWork(bytes, 'keynote');
  const doc = emptyDocument();
  const slides = keynoteSlides(archive);
  for (let i = 0; i < slides.length; i += 1) {
    const slideId = slides[i]!;
    const blocks = slideToBlocks(archive, slideId);
    const title = takeTitle(blocks);
    if (title !== undefined) {
      doc.blocks.push(title);
    } else if (slides.length > 1) {
      doc.blocks.push(heading(2, [plain(`Slide ${i + 1}`)]));
    }
    doc.blocks.push(...blocks);
  }
  return doc;
}

/** Promote the first non-empty paragraph to an h2 slide title when sensible. */
function takeTitle(blocks: Block[]): Block | undefined {
  if (blocks.length === 0) return undefined;
  const first = blocks[0]!;
  if (first.type === 'heading') {
    blocks.shift();
    return first;
  }
  if (first.type === 'paragraph' && !inlinesAreEmpty(first.inlines)) {
    blocks.shift();
    return {
      type: 'heading',
      level: 2,
      anchor: inlinesToPlainText(first.inlines),
      content: first.inlines,
    };
  }
  return undefined;
}
