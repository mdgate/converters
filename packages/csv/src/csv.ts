import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/parse.js';

const EXTS = new Set(['csv', 'tsv', 'tab']);

export function csv(): Converter {
  return {
    id: 'csv',
    // CSV carries no signature, so only the path hint can claim it.
    sniff(_bytes: Uint8Array, hint?: ConvertHint): number {
      return hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '') ? 1 : 0;
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
