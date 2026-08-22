import { detectOleDoc } from '@mdgate/containers';
import { ConvertError, type Converter, type ConvertHint, type ConvertResult } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { asciiStartsWith, fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';

export function doc(): Converter {
  return {
    id: 'doc',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      // RTF files wearing a .doc extension are common in the wild; leave
      // them to the rtf converter, whose content sniff outranks our hint.
      if (asciiStartsWith(bytes, '{\\rtf')) return 0;
      if (detectOleDoc(bytes) === 'doc') return 2;
      if (hint?.path !== undefined && fileExtension(hint.path) === 'doc') return 1;
      return 0;
    },
    convert(bytes: Uint8Array): ConvertResult {
      if (asciiStartsWith(bytes, '{\\rtf')) {
        throw ConvertError.unsupported('RTF content in a .doc file: use the rtf converter');
      }
      return { markdown: documentToMarkdown(parse(bytes)) };
    },
  };
}
