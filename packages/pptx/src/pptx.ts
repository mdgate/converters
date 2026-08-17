import { detectZipDoc } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

const EXTS = new Set(['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm']);

export function pptx(): Converter {
  return {
    id: 'pptx',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (detectZipDoc(bytes) === 'pptx') return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
