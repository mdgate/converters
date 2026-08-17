import { trim } from '@mdgate/utils';
import { type AnchorId, type ImageSource, type LinkTarget, linkTargetIsEmpty } from './link.js';
import { PLAIN, type Style } from './style.js';

/** One span of inline content. */
export type Inline =
  | { type: 'text'; text: string; style: Style }
  | { type: 'link'; content: Inline[]; target: LinkTarget }
  | { type: 'image'; alt: string; source: ImageSource }
  | { type: 'anchor'; id: AnchorId }
  | { type: 'noteRef'; id: string }
  | { type: 'lineBreak' };

/** Unstyled text. */
export function plain(text: string): Inline {
  return { type: 'text', text, style: PLAIN };
}

/**
 * Flatten inlines to their text, dropping styling and links but keeping link
 * text and image alt text. Line breaks become newlines; anchors and note
 * references contribute nothing.
 */
export function inlinesToPlainText(inlines: readonly Inline[]): string {
  const out: string[] = [];
  collectPlainText(inlines, out);
  return out.join('');
}

function collectPlainText(inlines: readonly Inline[], out: string[]): void {
  for (const inline of inlines) {
    switch (inline.type) {
      case 'text':
        out.push(inline.text);
        break;
      case 'link':
        collectPlainText(inline.content, out);
        break;
      case 'image':
        out.push(inline.alt);
        break;
      case 'anchor':
      case 'noteRef':
        break;
      case 'lineBreak':
        out.push('\n');
        break;
    }
  }
}

/**
 * True when nothing here would render as visible content: only whitespace,
 * empty-target links, anchors, and line breaks. An image or a note reference
 * always counts as content.
 */
export function inlinesAreEmpty(inlines: readonly Inline[]): boolean {
  return inlines.every((i) => {
    switch (i.type) {
      case 'text':
        return trim(i.text).length === 0;
      case 'link':
        return linkTargetIsEmpty(i.target) && inlinesAreEmpty(i.content);
      case 'image':
      case 'noteRef':
        return false;
      case 'anchor':
      case 'lineBreak':
        return true;
    }
    return true;
  });
}
