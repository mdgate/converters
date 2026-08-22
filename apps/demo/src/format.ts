function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i + 5 <= n; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

function extensionOf(path: string): string | undefined {
  const base = path.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1).toLowerCase();
}

/** Display label only. The converter sniffs bytes itself. */
export function formatLabel(path: string, bytes: Uint8Array): string {
  if (startsWithAscii(bytes, '{\\rtf')) return 'rtf';
  if (hasPdfMagic(bytes)) return 'pdf';
  return extensionOf(path) ?? 'file';
}

export type MediaKind = 'image' | 'audio' | 'video';

const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'tif',
  'tiff',
  'heic',
  'heif',
  'bmp',
]);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'weba']);
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi']);

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function isIsoBmff(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

function ftypBrandOffsets(bytes: Uint8Array): number[] {
  if (bytes.length < 12) return [];
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length, 256);
  const offsets = [8];
  for (let i = 16; i + 4 <= end; i += 4) offsets.push(i);
  return offsets;
}

function hasHeicBrand(bytes: Uint8Array): boolean {
  for (const i of ftypBrandOffsets(bytes)) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const d = bytes[i + 3];
    if (a === 0x68 && b === 0x65 && c === 0x69 && (d === 0x63 || d === 0x66)) return true;
    if (a === 0x6d && b === 0x69 && c === 0x66 && d === 0x31) return true;
  }
  return false;
}

function hasM4aBrand(bytes: Uint8Array): boolean {
  for (const i of ftypBrandOffsets(bytes)) {
    if (
      bytes[i] === 0x4d &&
      bytes[i + 1] === 0x34 &&
      (bytes[i + 2] === 0x41 || bytes[i + 2] === 0x42 || bytes[i + 2] === 0x50) &&
      bytes[i + 3] === 0x20
    ) {
      return true;
    }
  }
  return false;
}

export function mediaKind(path: string, bytes: Uint8Array): MediaKind | undefined {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'image';
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image';
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image';
  if (hasPrefix(bytes, [0x42, 0x4d])) return 'image';
  if (
    bytes.length >= 12 &&
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image';
  }
  if (
    bytes.length >= 12 &&
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return 'audio';
  }
  if (hasPrefix(bytes, [0x49, 0x44, 0x33])) return 'audio';
  if (isIsoBmff(bytes)) {
    if (hasHeicBrand(bytes)) return 'image';
    if (hasM4aBrand(bytes)) return 'audio';
    const ext = extensionOf(path);
    if (ext !== undefined && IMAGE_EXTS.has(ext)) return 'image';
    if (ext !== undefined && AUDIO_EXTS.has(ext)) return 'audio';
    return 'video';
  }
  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video';
  const ext = extensionOf(path);
  if (ext === undefined) return undefined;
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return undefined;
}

export function stemOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? 'document';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base || 'document';
  return base.slice(0, dot) || 'document';
}
