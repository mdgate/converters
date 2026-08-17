import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/parse.js';

export function csv(): Converter {
  return {
    id: 'csv',
    // CSV carries no signature, so only the path hint can claim it.
    sniff(_bytes: Uint8Array, hint?: ConvertHint): number {
      return hint?.path !== undefined && fileExtension(hint.path) === 'csv' ? 1 : 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
