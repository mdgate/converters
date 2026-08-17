import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { asciiStartsWith, fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

export function rtf(): Converter {
  return {
    id: 'rtf',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (asciiStartsWith(bytes, '{\\rtf')) return 2;
      if (hint?.path !== undefined && fileExtension(hint.path) === 'rtf') return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
