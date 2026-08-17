import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { looksLikeNotebook, parse } from './internal/parse.js';

export function ipynb(): Converter {
  return {
    id: 'ipynb',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (looksLikeNotebook(bytes)) return 2;
      if (hint?.path !== undefined && fileExtension(hint.path) === 'ipynb') return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      refuseForeign(bytes);
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}

function refuseForeign(bytes: Uint8Array): void {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw ConvertError.unsupported('pdf');
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw ConvertError.unsupported('ole');
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw ConvertError.unsupported('zip');
  }
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}
