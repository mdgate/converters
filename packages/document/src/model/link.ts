import type { AssetId } from './asset.js';

/**
 * Normalized, document-scoped anchor id. Frontends that concatenate multiple
 * source parts (EPUB chapters) scope ids during normalization so they stay
 * unique across the whole document.
 */
export type AnchorId = string;

/** Where a link points. */
export type LinkTarget =
  | { type: 'external'; url: string }
  | { type: 'relative'; url: string }
  | { type: 'anchor'; id: AnchorId };

export function linkTargetIsEmpty(target: LinkTarget): boolean {
  switch (target.type) {
    case 'external':
    case 'relative':
      return target.url.length === 0;
    case 'anchor':
      return target.id.length === 0;
  }
}

/** Where an image's bytes live. */
export type ImageSource =
  | { type: 'external'; url: string }
  | { type: 'asset'; id: AssetId }
  | { type: 'unavailable' };
