import type { ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { inflateGzip } from '@mdgate/utils';
import type { ImageMime } from './types.js';

const SVG_MAX = 8 << 20;

const EXTS: Record<string, ImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heic',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
};

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function mimeFromBytes(bytes: Uint8Array): ImageMime | undefined {
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
  if (isGif(bytes)) return 'image/gif';
  if (isBmp(bytes)) return 'image/bmp';
  if (isTiff(bytes)) return 'image/tiff';
  if (isHeic(bytes)) return 'image/heic';
  if (isSvg(bytes)) return 'image/svg+xml';
  if (isGzip(bytes)) {
    try {
      if (isSvg(inflateGzip(bytes, SVG_MAX))) return 'image/svg+xml';
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function mimeFromPath(filePath: string): ImageMime | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return EXTS[base.slice(dot + 1).toLowerCase()];
}

export function resolveMime(bytes: Uint8Array, hint?: ConvertHint): ImageMime | undefined {
  return mimeFromBytes(bytes) ?? (hint?.path !== undefined ? mimeFromPath(hint.path) : undefined);
}

export function refuseForeign(bytes: Uint8Array): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (startsWith(bytes, OLE_MAGIC)) throw ConvertError.unsupported('ole');
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    throw ConvertError.unsupported('zip');
  }
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x38) {
    return false;
  }
  return (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
}

function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) {
    return true;
  }
  return bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
}

function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
    return false;
  }
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length, 256);
  if (isHeicBrand(bytes, 8)) return true;
  for (let i = 16; i + 4 <= end; i += 4) {
    if (isHeicBrand(bytes, i)) return true;
  }
  return false;
}

function isHeicBrand(bytes: Uint8Array, i: number): boolean {
  const a = bytes[i];
  const b = bytes[i + 1];
  const c = bytes[i + 2];
  const d = bytes[i + 3];
  if (a === 0x68 && b === 0x65 && c === 0x69 && (d === 0x63 || d === 0x66)) return true;
  return a === 0x6d && b === 0x69 && c === 0x66 && d === 0x31;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isSvg(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  if (startsWithCi(bytes, '<svg', start) && !isNameByte(bytes[start + 4])) return true;
  if (!startsWithCi(bytes, '<?xml', start)) return false;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 8192)),
  );
  return /<svg\b/i.test(head);
}

function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
}

function skipBomAndWs(bytes: Uint8Array): number {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return i;
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function startsWithCi(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    const a = bytes[offset + i]!;
    const b = prefix.charCodeAt(i);
    if (a === b) continue;
    const al = a >= 65 && a <= 90 ? a + 32 : a;
    const bl = b >= 65 && b <= 90 ? b + 32 : b;
    if (al !== bl) return false;
  }
  return true;
}

function isNameByte(b: number | undefined): boolean {
  if (b === undefined) return false;
  return (
    (b >= 48 && b <= 57) ||
    (b >= 65 && b <= 90) ||
    (b >= 97 && b <= 122) ||
    b === 45 ||
    b === 95 ||
    b === 58
  );
}
