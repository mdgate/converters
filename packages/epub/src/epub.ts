import { detectZipDoc } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

const EXTS = new Set(['epub', 'ibooks']);

export function epub(): Converter {
  return {
    id: 'epub',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (detectZipDoc(bytes) === 'epub') return 3;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
