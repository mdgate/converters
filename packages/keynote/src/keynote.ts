import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { detectIWorkKind } from '@mdgate/iwork-common';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

export function keynote(): Converter {
  return {
    id: 'keynote',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (detectIWorkKind(bytes) === 'keynote') return 2;
      // `.key` collides with other formats; only use extension when content did not match.
      if (hint?.path !== undefined && fileExtension(hint.path) === 'key') return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
