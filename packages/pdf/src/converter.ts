import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { toMarkdownFromPdf } from './pdf.js';
import { extensionOf, hasPdfMagic } from './sniff.js';
import { looksLikeXfdf } from './xfdf.js';

export function pdf(): Converter {
  return {
    id: 'pdf',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (hasPdfMagic(bytes)) return 2;
      if (looksLikeXfdf(bytes)) return 2;
      const ext = hint?.path !== undefined ? extensionOf(hint.path) : undefined;
      if (ext === 'pdf' || ext === 'xfdf') return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult> {
      if (options?.convert !== undefined) {
        return toMarkdownFromPdf(bytes, options.convert).then((markdown) => ({ markdown }));
      }
      return { markdown: toMarkdownFromPdf(bytes) };
    },
  };
}
