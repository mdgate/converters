import type { ConvertHint } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import type { AudioMime } from './types.js';

const EXTS: Record<string, AudioMime> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/x-wav',
  m4a: 'audio/m4a',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function mimeFromBytes(bytes: Uint8Array): AudioMime | undefined {
  if (isMp3(bytes)) return 'audio/mpeg';
  if (isWav(bytes)) return 'audio/wav';
  const mp4 = mp4AudioMime(bytes);
  if (mp4 !== undefined) return mp4;
  if (isOgg(bytes)) return 'audio/ogg';
  if (isFlac(bytes)) return 'audio/flac';
  return undefined;
}

export function mimeFromPath(filePath: string): AudioMime | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return EXTS[base.slice(dot + 1).toLowerCase()];
}

export function resolveMime(bytes: Uint8Array, hint?: ConvertHint): AudioMime | undefined {
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

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true;
  }
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf0) === 0xf0;
}

function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

function mp4AudioMime(bytes: Uint8Array): AudioMime | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
    return undefined;
  }
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length, 256);
  if (isM4aBrand(bytes, 8)) return 'audio/m4a';
  for (let i = 16; i + 4 <= end; i += 4) {
    if (isM4aBrand(bytes, i)) return 'audio/m4a';
  }
  return undefined;
}

function isM4aBrand(bytes: Uint8Array, i: number): boolean {
  return (
    bytes[i] === 0x4d &&
    bytes[i + 1] === 0x34 &&
    (bytes[i + 2] === 0x41 || bytes[i + 2] === 0x42 || bytes[i + 2] === 0x50) &&
    bytes[i + 3] === 0x20
  );
}

function isOgg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  );
}

function isFlac(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
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
