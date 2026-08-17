import { detectZipDoc } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

const EXTS = new Set(['docx', 'docm', 'dotx', 'dotm']);

export function docx(): Converter {
  return {
    id: 'docx',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (detectZipDoc(bytes) === 'docx') return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
