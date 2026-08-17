import { detectZipDoc } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

const KINDS = new Set(['odt', 'ods', 'odp']);

export function odf(): Converter {
  return {
    id: 'odf',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (KINDS.has(detectZipDoc(bytes) ?? '')) return 2;
      if (hint?.path !== undefined && KINDS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
