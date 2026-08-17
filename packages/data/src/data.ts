import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import {
  decodeText,
  fileStem,
  isForeign,
  isOle,
  isPdf,
  isRtf,
  isZip,
  looksLikeXml,
  startsWithJsonOpen,
} from './internal/bytes.js';
import { jsonDocument, jsonlDocument, tryJsonThenJsonl } from './internal/json.js';
import { xmlDocument, yamlDocument } from './internal/markup.js';

const JSON_EXTS = new Set(['json', 'jsonl']);
const HINT_EXTS = new Set(['xml', 'yaml', 'yml']);

export function data(): Converter {
  return {
    id: 'data',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (isForeign(bytes)) return 0;
      const ext = hint?.path !== undefined ? fileExtension(hint.path) : undefined;
      if (ext !== undefined && JSON_EXTS.has(ext)) return 2;
      // Never score 2 for XML: flat ODF and many office parts start with <?xml.
      if (!looksLikeXml(bytes) && startsWithJsonOpen(bytes)) return 2;
      if (ext !== undefined && HINT_EXTS.has(ext)) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult {
      refuseForeign(bytes);
      const ext = options?.path !== undefined ? fileExtension(options.path) : undefined;
      const title = options?.path !== undefined ? fileStem(options.path) : undefined;
      const text = decodeText(bytes);
      if (ext === 'jsonl') return { markdown: documentToMarkdown(jsonlDocument(text, title)) };
      if (ext === 'json') return { markdown: documentToMarkdown(jsonDocument(text, title)) };
      if (ext === 'xml') return { markdown: documentToMarkdown(xmlDocument(text)) };
      if (ext === 'yaml' || ext === 'yml') {
        return { markdown: documentToMarkdown(yamlDocument(text)) };
      }
      if (startsWithJsonOpen(bytes)) {
        return { markdown: documentToMarkdown(tryJsonThenJsonl(text, title)) };
      }
      if (looksLikeXml(bytes)) return { markdown: documentToMarkdown(xmlDocument(text)) };
      throw ConvertError.unsupported('data');
    },
  };
}

function refuseForeign(bytes: Uint8Array): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (isOle(bytes)) throw ConvertError.unsupported('ole');
  if (isZip(bytes)) throw ConvertError.unsupported('zip');
  if (isRtf(bytes)) throw ConvertError.unsupported('rtf');
}
