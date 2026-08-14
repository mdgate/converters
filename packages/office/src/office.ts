import type { Converter, ConvertHint, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { formatFromBytes, formatFromPath } from './internal/detect.js';
import { parse } from './internal/formats/index.js';
import { documentToMarkdown } from './internal/render/index.js';

export type OfficeOptions = Record<string, never>;

export function office(_options: OfficeOptions = {}): Converter {
  return {
    id: 'office',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (formatFromBytes(bytes) !== undefined) return 2;
      if (hint?.path !== undefined && formatFromPath(hint.path) !== undefined) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, hint?: ConvertHint): ConvertResult {
      const format =
        formatFromBytes(bytes) ??
        (hint?.path === undefined ? undefined : formatFromPath(hint.path));
      if (format === undefined) {
        throw ConvertError.unsupported(
          hint?.path === undefined
            ? 'unrecognized file content: name the format explicitly'
            : `unrecognized file content and extension: ${hint.path}`,
        );
      }
      return { markdown: documentToMarkdown(parse(bytes, format)) };
    },
  };
}
