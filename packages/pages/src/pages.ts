import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { detectIWorkKind } from '@mdgate/iwork-common';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

export function pages(): Converter {
  return {
    id: 'pages',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (detectIWorkKind(bytes) === 'pages') return 2;
      if (hint?.path !== undefined && fileExtension(hint.path) === 'pages') return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
