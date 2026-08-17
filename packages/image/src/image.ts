import type { Converter, ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { mimeFromBytes, mimeFromPath, refuseForeign, resolveMime } from './mime.js';
import { svgToMarkdown } from './svg.js';
import type { ConvertImage } from './types.js';

export function image(convertImage: ConvertImage): Converter {
  return {
    id: 'image',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (mimeFromBytes(bytes) !== undefined) return 2;
      if (hint?.path !== undefined && mimeFromPath(hint.path) !== undefined) return 1;
      return 0;
    },
    async convert(bytes: Uint8Array, hint?: ConvertHint) {
      refuseForeign(bytes);
      const mime = resolveMime(bytes, hint);
      if (mime === undefined) {
        throw ConvertError.unsupported(
          hint?.path === undefined
            ? 'unrecognized file content: name the format explicitly'
            : `unrecognized file content and extension: ${hint.path}`,
        );
      }
      if (mime === 'image/svg+xml') {
        return { markdown: svgToMarkdown(bytes) };
      }
      const markdown = await convertImage({ bytes, mime, page: hint?.page });
      return { markdown: markdown.endsWith('\n') ? markdown : `${markdown}\n` };
    },
  };
}
