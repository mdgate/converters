import type { Converter, ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import type { ConvertImage, ImageMime } from './types.js';

const EXTS: Record<string, ImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function image(convertImage: ConvertImage): Converter {
  return {
    id: 'image',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (mimeFromBytes(bytes) !== undefined) return 2;
      if (hint?.path !== undefined && mimeFromPath(hint.path) !== undefined) return 1;
      return 0;
    },
    async convert(bytes: Uint8Array, hint?: ConvertHint) {
      const mime =
        mimeFromBytes(bytes) ?? (hint?.path !== undefined ? mimeFromPath(hint.path) : undefined);
      if (mime === undefined) {
        throw ConvertError.unsupported(
          hint?.path === undefined
            ? 'unrecognized file content: name the format explicitly'
            : `unrecognized file content and extension: ${hint.path}`,
        );
      }
      const markdown = await convertImage({ bytes, mime, page: hint?.page });
      return { markdown: markdown.endsWith('\n') ? markdown : `${markdown}\n` };
    },
  };
}

function mimeFromBytes(bytes: Uint8Array): ImageMime | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

function mimeFromPath(filePath: string): ImageMime | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return EXTS[base.slice(dot + 1).toLowerCase()];
}
