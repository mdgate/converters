import type { Converter, ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { mimeFromBytes, mimeFromPath, refuseForeign, resolveMime } from './mime.js';
import type { ConvertAudio } from './types.js';

export function audio(transcribe?: ConvertAudio): Converter {
  return {
    id: 'audio',
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
      if (transcribe === undefined) {
        throw ConvertError.unsupported('audio transcription');
      }
      const markdown = await transcribe({ bytes, mime });
      return { markdown: markdown.endsWith('\n') ? markdown : `${markdown}\n` };
    },
  };
}
