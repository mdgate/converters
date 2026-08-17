import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { toMarkdownFromPdf } from './pdf.js';
import { extensionOf, hasPdfMagic } from './sniff.js';

export type PdfOptions = Record<string, never>;

export function pdf(_options: PdfOptions = {}): Converter {
  return {
    id: 'pdf',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (hasPdfMagic(bytes)) return 2;
      if (hint?.path !== undefined && extensionOf(hint.path) === 'pdf') return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult> {
      if (options?.image !== undefined) {
        return toMarkdownFromPdf(bytes, options.image).then((markdown) => ({ markdown }));
      }
      return { markdown: toMarkdownFromPdf(bytes) };
    },
  };
}
