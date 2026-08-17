import { CompoundFile, detectOleDoc, hasOleMagic } from '@mdgate/containers';

/** MS-ONESTORE guidFileType for .one (OneNote 2010+). */
const GUID_ONE_2010 = [
  0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3,
];

/** MS-ONESTORE guidFileType for .one (OneNote 2007). */
const GUID_ONE_2007 = [
  0xfa, 0x37, 0xdd, 0x1f, 0xbe, 0x49, 0xd0, 0x11, 0x8c, 0x55, 0x00, 0xc0, 0x4f, 0xd9, 0x0f, 0x85,
];

/** MS-ONESTORE guidFileType for .onetoc2. */
const GUID_ONETOC2 = [
  0xa1, 0x2f, 0xff, 0x43, 0xd9, 0xef, 0x76, 0x4c, 0x9e, 0xe2, 0x10, 0xea, 0x57, 0x22, 0x76, 0x5f,
];

/** MS-ONESTORE guidFileFormat at offset 48. */
const GUID_FILE_FORMAT = [
  0x3f, 0xdd, 0x9a, 0x10, 0x1b, 0x91, 0xf5, 0x49, 0xa5, 0xd0, 0x17, 0x91, 0xed, 0xc8, 0xae, 0xd8,
];

const FILE_TYPE_GUIDS = [GUID_ONE_2010, GUID_ONE_2007, GUID_ONETOC2];

const ASCII_FILE_TYPE_GUIDS = [
  '{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}',
  '{1FDD37FA-49BE-11D0-8C55-00C04FD90F85}',
  '{43FF2FA1-EFD9-4C76-9EE2-10EA5722765F}',
];

const MAGIC_ONE = [0x4f, 0x4e, 0x45, 0x20];

export function isOleOneNote(bytes: Uint8Array): boolean {
  if ((detectOleDoc(bytes) as string | undefined) === 'one') return true;
  return hasOneNoteOleStreams(bytes);
}

function hasOneNoteOleStreams(bytes: Uint8Array): boolean {
  if (!hasOleMagic(bytes)) return false;
  try {
    const ole = CompoundFile.open(bytes);
    for (const entry of ole.readRootStorage()) {
      if (entry.name.length >= 7 && entry.name.slice(0, 7).toLowerCase() === 'onenote') {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** True for a native .one / .onetoc2 header or an OLE OneNote compound file. */
export function isOneNote(bytes: Uint8Array): boolean {
  return isOleOneNote(bytes) || hasOneNoteHeader(bytes);
}

export function hasOneNoteHeader(bytes: Uint8Array): boolean {
  if (hasFileTypeGuid(bytes) || hasFileFormatGuid(bytes) || hasOneMagic(bytes)) return true;
  return hasAsciiGuidHeader(bytes);
}

/** Bytes to skip so the file-type GUID / 'ONE ' magic is not extracted as text. */
export function headerSkip(bytes: Uint8Array): number {
  if (hasFileTypeGuid(bytes)) return bytes.length >= 1024 ? 1024 : 16;
  if (hasOneMagic(bytes)) return 4;
  if (hasAsciiGuidHeader(bytes)) return 38;
  if (hasFileFormatGuid(bytes)) return bytes.length >= 1024 ? 1024 : 64;
  return 0;
}

function hasFileTypeGuid(bytes: Uint8Array): boolean {
  for (const guid of FILE_TYPE_GUIDS) {
    if (startsWith(bytes, guid, 0)) return true;
  }
  return false;
}

function hasFileFormatGuid(bytes: Uint8Array): boolean {
  return startsWith(bytes, GUID_FILE_FORMAT, 48);
}

function hasOneMagic(bytes: Uint8Array): boolean {
  return startsWith(bytes, MAGIC_ONE, 0);
}

function hasAsciiGuidHeader(bytes: Uint8Array): boolean {
  for (const guid of ASCII_FILE_TYPE_GUIDS) {
    if (startsWithAsciiCi(bytes, guid, 0)) return true;
  }
  return false;
}

export function isPdf(bytes: Uint8Array): boolean {
  const start = skipBomAndWs(bytes);
  return startsWithAscii(bytes, '%PDF-', start);
}

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function hasOle(bytes: Uint8Array): boolean {
  return hasOleMagic(bytes);
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

function startsWith(bytes: Uint8Array, magic: readonly number[], offset: number): boolean {
  if (offset + magic.length > bytes.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[offset + i] !== magic[i]) return false;
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

function startsWithAsciiCi(bytes: Uint8Array, prefix: string, offset: number): boolean {
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
