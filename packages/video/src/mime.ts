import type { ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import type { VideoMime } from './types.js';

const EXTS: Record<string, VideoMime> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mk3d: 'video/x-matroska',
  avi: 'video/x-msvideo',
};

const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'mp71',
  'avc1',
  'av01',
  'dash',
  'mmp4',
  'ndas',
  'M4V ',
  'M4VH',
  'M4VP',
]);

const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function mimeFromBytes(bytes: Uint8Array): VideoMime | undefined {
  if (isAvi(bytes)) return 'video/x-msvideo';
  const iso = isoVideoMime(bytes);
  if (iso !== undefined) return iso;
  return ebmlMime(bytes);
}

export function mimeFromPath(filePath: string): VideoMime | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return EXTS[base.slice(dot + 1).toLowerCase()];
}

export function resolveMime(bytes: Uint8Array, hint?: ConvertHint): VideoMime | undefined {
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

function isoVideoMime(bytes: Uint8Array): VideoMime | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
    return undefined;
  }
  const brands = readBrands(bytes);
  if (brands.some((b) => AUDIO_BRANDS.has(b))) return undefined;
  if (brands.some((b) => b === 'qt  ')) return 'video/quicktime';
  if (brands.some((b) => VIDEO_BRANDS.has(b))) return 'video/mp4';
  return undefined;
}

function readBrands(bytes: Uint8Array): string[] {
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length, 256);
  const brands: string[] = [];
  if (bytes.length >= 12) brands.push(brandAt(bytes, 8));
  for (let i = 16; i + 4 <= end; i += 4) brands.push(brandAt(bytes, i));
  return brands;
}

function brandAt(bytes: Uint8Array, i: number): string {
  return String.fromCharCode(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!);
}

function ebmlMime(bytes: Uint8Array): VideoMime | undefined {
  if (bytes.length < 4) return undefined;
  if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
    return undefined;
  }
  const window = bytes.subarray(0, Math.min(bytes.length, 256));
  if (containsAscii(window, 'matroska')) return 'video/x-matroska';
  return 'video/webm';
}

function isAvi(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x41 &&
    bytes[9] === 0x56 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x20
  );
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

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const n = text.length;
  if (n === 0 || bytes.length < n) return false;
  outer: for (let i = 0; i + n <= bytes.length; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}
