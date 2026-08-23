import { ConvertError } from '@mdgate/core';
import { decode, inflateRaw, warn } from '@mdgate/utils';
import { CompoundFile, hasOleMagic } from './cfb.js';
import { type Element, parseXml } from './xml.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const _SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const METHOD_AES = 99;
const METHOD_APPLE_ENC = 0x636b;
const METHOD_APPLE_ENC2 = 0x636c;

function isEncryptedMethod(method: number): boolean {
  return method === METHOD_AES || method === METHOD_APPLE_ENC || method === METHOD_APPLE_ENC2;
}

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  headerOffset: number;
}

class ZipArchive {
  readonly length: number;
  private readonly bytes: Uint8Array;
  private readonly byName = new Map<string, ZipEntry>();

  private constructor(bytes: Uint8Array, entries: ZipEntry[]) {
    this.bytes = bytes;
    this.length = entries.length;
    for (const e of entries) {
      if (!this.byName.has(e.name)) this.byName.set(e.name, e);
    }
  }

  static open(bytes: Uint8Array): ZipArchive {
    const eocd = findEocd(bytes);
    if (eocd < 0) {
      // zip 8.6.0 `ZipError::InvalidArchive("Could not find EOCD")` Display.
      throw ConvertError.malformed(
        'not a readable zip archive: invalid Zip archive: Could not find EOCD',
      );
    }
    const dv = view(bytes);
    let entryCount = u16(dv, eocd + 10);
    let cdSize = u32(dv, eocd + 12);
    let cdOffset = u32(dv, eocd + 16);
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const z64 = readZip64(bytes, eocd);
      if (z64 !== undefined) {
        entryCount = z64.entryCount;
        cdSize = z64.cdSize;
        cdOffset = z64.cdOffset;
      }
    }
    if (cdOffset + cdSize > bytes.length) {
      throw ConvertError.malformed('not a readable zip archive: truncated central directory');
    }
    const entries: ZipEntry[] = [];
    let off = cdOffset;
    const cdEnd = Math.min(bytes.length, cdOffset + cdSize);
    while (off + 46 <= cdEnd && entries.length < entryCount) {
      if (u32(dv, off) !== SIG_CENTRAL) {
        throw ConvertError.malformed('not a readable zip archive: bad central directory');
      }
      const flags = u16(dv, off + 8);
      const method = u16(dv, off + 10);
      const crc = u32(dv, off + 16);
      let compressedSize = u32(dv, off + 20);
      let uncompressedSize = u32(dv, off + 24);
      const nameLen = u16(dv, off + 28);
      const extraLen = u16(dv, off + 30);
      const commentLen = u16(dv, off + 32);
      let headerOffset = u32(dv, off + 42);
      const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen);
      if (off + 46 + nameLen + extraLen + commentLen > bytes.length) {
        throw ConvertError.malformed('not a readable zip archive: truncated entry');
      }
      const extra = bytes.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen);
      const z64extra = parseZip64Extra(extra, {
        uncompressedSize,
        compressedSize,
        headerOffset,
      });
      uncompressedSize = z64extra.uncompressedSize;
      compressedSize = z64extra.compressedSize;
      headerOffset = z64extra.headerOffset;
      const utf8 = (flags & (1 << 11)) !== 0;
      const name = decodeZipName(nameBytes, utf8);
      entries.push({
        name,
        method,
        flags,
        crc,
        compressedSize,
        uncompressedSize,
        headerOffset,
      });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipArchive(bytes, entries);
  }

  indexForName(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  /** Part names in central-directory order of first occurrence. */
  partNames(): string[] {
    return [...this.byName.keys()];
  }

  hasEncryptedEntries(): boolean {
    for (const e of this.byName.values()) {
      if ((e.flags & 1) !== 0) return true;
      if (isEncryptedMethod(e.method)) return true;
    }
    return false;
  }

  readCompressed(entry: ZipEntry): Uint8Array {
    const dv = view(this.bytes);
    const off = entry.headerOffset;
    if (off + 30 > this.bytes.length || u32(dv, off) !== SIG_LOCAL) {
      throw new Error('bad local file header');
    }
    const nameLen = u16(dv, off + 26);
    const extraLen = u16(dv, off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart > this.bytes.length) {
      throw new Error('truncated local file header');
    }
    if (entry.compressedSize > 0 && dataEnd > this.bytes.length) {
      throw new Error('truncated compressed data');
    }
    return this.bytes.subarray(dataStart, Math.min(dataEnd, this.bytes.length));
  }
}

/** A ZIP-based document package (OOXML, ODF, EPUB). */
export class Package {
  private readonly zip: ZipArchive;
  private readonly cache = new Map<string, Uint8Array>();

  private constructor(zip: ZipArchive) {
    this.zip = zip;
  }

  static open(bytes: Uint8Array): Package {
    let zip: ZipArchive;
    try {
      zip = ZipArchive.open(bytes);
    } catch (e) {
      if (e instanceof ConvertError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw ConvertError.malformed(`not a readable zip archive: ${msg}`);
    }
    return new Package(zip);
  }

  /**
   * Read a part's bytes. `undefined` means the part is absent; throws when
   * it exists but cannot be read.
   */
  part(name: string): Uint8Array | undefined {
    name = trimLeadingSlash(name);
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const entry = this.zip.indexForName(name);
    if (entry === undefined) return undefined;
    let bytes: Uint8Array;
    try {
      bytes = this.decompress(entry, Number.MAX_SAFE_INTEGER);
    } catch (e) {
      if (e instanceof ConvertError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw ConvertError.malformedPart(name, `corrupt archive entry: ${msg}`);
    }
    this.cache.set(name, bytes);
    return bytes;
  }

  /** True when a part exists, without reading it. */
  hasPart(name: string): boolean {
    return this.zip.indexForName(trimLeadingSlash(name)) !== undefined;
  }

  /** Part names present in the archive (no leading slash). */
  partNames(): string[] {
    return this.zip.partNames();
  }

  /** True when any entry is password-protected or uses an Apple/AES zip method. */
  hasEncryptedEntries(): boolean {
    return this.zip.hasEncryptedEntries();
  }

  requiredPart(name: string): Uint8Array {
    const bytes = this.part(name);
    if (bytes === undefined) throw ConvertError.missingPart(name);
    return bytes;
  }

  /**
   * Absent is valid (`undefined`, silent); an unreadable part is skipped
   * with a log.
   */
  optionalPart(name: string): Uint8Array | undefined {
    try {
      return this.part(name);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(`skipping unreadable part ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  optionalXmlPart(name: string): Element | undefined {
    const bytes = this.optionalPart(name);
    if (bytes === undefined) return undefined;
    try {
      return parseXml(bytes);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(`skipping corrupt part ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  requiredXmlPart(name: string): Element {
    return parseXml(this.requiredPart(name));
  }

  private decompress(entry: ZipEntry, maxOut: number): Uint8Array {
    if ((entry.flags & 1) !== 0 || isEncryptedMethod(entry.method)) {
      throw ConvertError.encrypted();
    }
    let compressed: Uint8Array;
    try {
      compressed = this.zip.readCompressed(entry);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw ConvertError.malformedPart(entry.name, `unreadable archive entry: ${msg}`);
    }
    let out: Uint8Array;
    if (entry.method === METHOD_STORE) {
      const expected = entry.uncompressedSize > 0 ? entry.uncompressedSize : compressed.length;
      out = compressed.subarray(0, Math.min(expected, compressed.length));
    } else if (entry.method === METHOD_DEFLATE) {
      out = inflateCapped(compressed, maxOut);
    } else {
      throw new Error(`unsupported compression method ${entry.method}`);
    }
    if (out.length <= maxOut - 1 && entry.crc !== 0 && crc32(out) !== entry.crc) {
      throw new Error('crc mismatch');
    }
    return out;
  }
}

/**
 * A zip-open failure on OOXML input may actually be an OLE compound file:
 * an encrypted package, or a legacy binary document with the wrong extension.
 */
export function probeOle(bytes: Uint8Array): ConvertError | undefined {
  if (!hasOleMagic(bytes)) return undefined;
  try {
    const file = CompoundFile.open(bytes);
    if (file.exists('EncryptionInfo') || file.exists('EncryptedPackage')) {
      return ConvertError.encrypted();
    }
  } catch {
    // Still OLE magic: treat as a legacy binary where OOXML was expected.
  }
  return ConvertError.malformed(
    'OLE compound document where an OOXML package was expected (legacy binary format?)',
  );
}

function inflateCapped(data: Uint8Array, maxOut: number): Uint8Array {
  return inflateRaw(data, maxOut);
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - (65535 + 22));
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      const commentLen = bytes[i + 20]! | (bytes[i + 21]! << 8);
      if (i + 22 + commentLen === bytes.length) return i;
    }
  }
  return -1;
}

function readZip64(
  bytes: Uint8Array,
  eocd: number,
): { entryCount: number; cdSize: number; cdOffset: number } | undefined {
  if (eocd < 20) return undefined;
  const dv = view(bytes);
  const loc = eocd - 20;
  if (u32(dv, loc) !== SIG_ZIP64_LOCATOR) return undefined;
  const z64off = u64(dv, loc + 8);
  if (z64off + 56 > bytes.length || u32(dv, z64off) !== SIG_ZIP64_EOCD) return undefined;
  return {
    entryCount: u64(dv, z64off + 32),
    cdSize: u64(dv, z64off + 40),
    cdOffset: u64(dv, z64off + 48),
  };
}

function parseZip64Extra(
  extra: Uint8Array,
  sizes: { uncompressedSize: number; compressedSize: number; headerOffset: number },
): { uncompressedSize: number; compressedSize: number; headerOffset: number } {
  let i = 0;
  const dv = view(extra);
  while (i + 4 <= extra.length) {
    const id = u16(dv, i);
    const size = u16(dv, i + 2);
    const start = i + 4;
    if (start + size > extra.length) break;
    if (id === 0x0001) {
      let o = start;
      let { uncompressedSize, compressedSize, headerOffset } = sizes;
      if (uncompressedSize === 0xffffffff && o + 8 <= start + size) {
        uncompressedSize = u64(dv, o);
        o += 8;
      }
      if (compressedSize === 0xffffffff && o + 8 <= start + size) {
        compressedSize = u64(dv, o);
        o += 8;
      }
      if (headerOffset === 0xffffffff && o + 8 <= start + size) {
        headerOffset = u64(dv, o);
      }
      return { uncompressedSize, compressedSize, headerOffset };
    }
    i = start + size;
  }
  return sizes;
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return decode(bytes, 'cp437');
}

function trimLeadingSlash(name: string): string {
  let i = 0;
  while (i < name.length && name.charCodeAt(i) === 47) i += 1;
  return name.slice(i);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(dv: DataView, off: number): number {
  return dv.getUint16(off, true);
}

function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, true);
}

function u64(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  if (hi > 0x1fffff) return Number.POSITIVE_INFINITY;
  return hi * 0x1_0000_0000 + lo;
}

const CRC_TABLE = makeCrcTable();

function makeCrcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
}

function jsCrc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function crc32(data: Uint8Array): number {
  return jsCrc32(data);
}
