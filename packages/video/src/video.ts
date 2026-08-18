import type { Converter, ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { mimeFromBytes, mimeFromPath, refuseForeign, resolveMime } from './mime.js';
import type { ConvertVideo } from './types.js';

export function video(convertVideo?: ConvertVideo): Converter {
  return {
    id: 'video',
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
      if (convertVideo === undefined) {
        throw ConvertError.unsupported('video conversion');
      }
      const markdown = await convertVideo({ bytes, mime });
      return { markdown: markdown.endsWith('\n') ? markdown : `${markdown}\n` };
    },
  };
}
