import { ConvertError } from '@mdgate/core';

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFATSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;
const MAXREGSECT = 0xfffffffa;
const TYPE_UNKNOWN = 0;
const TYPE_STORAGE = 1;
const TYPE_STREAM = 2;
const TYPE_ROOT = 5;

interface DirEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

/** OLE2 compound file (MS-CFB). */
export class CompoundFile {
  private readonly bytes: Uint8Array;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: number[];
  private readonly miniFat: number[];
  private readonly entries: DirEntry[];
  private miniStream: Uint8Array | undefined;

  private constructor(
    bytes: Uint8Array,
    sectorSize: number,
    miniSectorSize: number,
    miniCutoff: number,
    fat: number[],
    miniFat: number[],
    entries: DirEntry[],
  ) {
    this.bytes = bytes;
    this.sectorSize = sectorSize;
    this.miniSectorSize = miniSectorSize;
    this.miniCutoff = miniCutoff;
    this.fat = fat;
    this.miniFat = miniFat;
    this.entries = entries;
  }

  static open(bytes: Uint8Array): CompoundFile {
    if (bytes.length < 512 || !startsWith(bytes, OLE_MAGIC)) {
      throw ConvertError.malformed('not an OLE2 compound file');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const byteOrder = dv.getUint16(0x1c, true);
    if (byteOrder !== 0xfffe) {
      throw ConvertError.malformed('not an OLE2 compound file: bad byte order');
    }
    const sectorShift = dv.getUint16(0x1e, true);
    if (sectorShift !== 9 && sectorShift !== 12) {
      throw ConvertError.malformed('not an OLE2 compound file: bad sector shift');
    }
    const sectorSize = 1 << sectorShift;
    const miniSectorShift = dv.getUint16(0x20, true);
    const miniSectorSize = miniSectorShift === 0 ? 64 : 1 << miniSectorShift;
    const majorVersion = dv.getUint16(0x1a, true);
    const fatSectorCount = dv.getUint32(0x2c, true);
    const firstDirSector = dv.getUint32(0x30, true);
    const miniCutoff = dv.getUint32(0x38, true) || 4096;
    const firstMiniFat = dv.getUint32(0x3c, true);
    const miniFatCount = dv.getUint32(0x40, true);
    const firstDifat = dv.getUint32(0x44, true);
    const difatCount = dv.getUint32(0x48, true);

    const difat: number[] = [];
    for (let i = 0; i < 109; i += 1) {
      const s = dv.getUint32(0x4c + i * 4, true);
      if (s <= MAXREGSECT) difat.push(s);
    }
    let difatSector = firstDifat;
    const seenDifat = new Set<number>();
    for (let n = 0; n < difatCount && difatSector <= MAXREGSECT; n += 1) {
      if (seenDifat.has(difatSector)) break;
      seenDifat.add(difatSector);
      const off = sectorOffset(difatSector, sectorSize);
      const entriesPer = sectorSize / 4;
      if (off + sectorSize > bytes.length) break;
      const ddv = new DataView(bytes.buffer, bytes.byteOffset + off, sectorSize);
      for (let i = 0; i < entriesPer - 1; i += 1) {
        const s = ddv.getUint32(i * 4, true);
        if (s <= MAXREGSECT) difat.push(s);
      }
      difatSector = ddv.getUint32((entriesPer - 1) * 4, true);
    }
    if (difat.length < fatSectorCount) {
      // Use what we have; a short DIFAT still opens many real files.
    }

    const fat: number[] = [];
    const fatLimit = Math.min(difat.length, fatSectorCount || difat.length, 1_000_000);
    for (let i = 0; i < fatLimit; i += 1) {
      const sec = difat[i]!;
      const off = sectorOffset(sec, sectorSize);
      if (off + sectorSize > bytes.length) break;
      const fdv = new DataView(bytes.buffer, bytes.byteOffset + off, sectorSize);
      const n = sectorSize / 4;
      for (let j = 0; j < n; j += 1) fat.push(fdv.getUint32(j * 4, true));
    }
    // rust-cfb 0.14 Allocator::validate (default Permissive): a FAT that
    // still outruns the file after stripping padding is a hard open error.
    const numSectors = Math.max(0, Math.floor((bytes.length + sectorSize - 1) / sectorSize) - 1);
    while (fat.length > numSectors) {
      const last = fat[fat.length - 1];
      if (last === 0 || last === DIFATSECT || last === FATSECT || last === FREESECT) {
        fat.pop();
      } else {
        break;
      }
    }
    while (fat.length > numSectors && fat[fat.length - 1] === FREESECT) fat.pop();
    if (fat.length > numSectors) {
      throw ConvertError.malformed(
        `not an OLE2 compound file: Malformed FAT (FAT has ${fat.length} entries, but file has only ${numSectors} sectors)`,
      );
    }
    while (fat.length < numSectors) fat.push(FREESECT);

    const miniFat: number[] = [];
    if (miniFatCount > 0 && firstMiniFat <= MAXREGSECT) {
      const miniFatBytes = readFatChain(
        bytes,
        fat,
        sectorSize,
        firstMiniFat,
        miniFatCount * sectorSize,
      );
      const mdv = new DataView(
        miniFatBytes.buffer,
        miniFatBytes.byteOffset,
        miniFatBytes.byteLength,
      );
      for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) {
        miniFat.push(mdv.getUint32(i, true));
      }
    }

    const dirBytes = readFatChain(bytes, fat, sectorSize, firstDirSector, bytes.length);
    const entries: DirEntry[] = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      entries.push(parseDirEntry(dirBytes, off, majorVersion));
    }
    if (entries.length === 0 || entries[0]!.type !== TYPE_ROOT) {
      throw ConvertError.malformed('not an OLE2 compound file: missing root storage');
    }

    return new CompoundFile(bytes, sectorSize, miniSectorSize, miniCutoff, fat, miniFat, entries);
  }

  /** Children of the root storage, in-order. */
  readRootStorage(): { name: string; type: number }[] {
    const root = this.entries[0];
    if (root === undefined) return [];
    const out: { name: string; type: number }[] = [];
    this.walkSiblings(root.child, out);
    return out;
  }

  exists(path: string): boolean {
    return this.lookup(path) !== undefined;
  }

  readStream(name: string): Uint8Array {
    const entry = this.lookup(name);
    if (entry === undefined || entry.type !== TYPE_STREAM) {
      throw ConvertError.missingPart(name);
    }
    return this.readEntryBytes(entry, Number.MAX_SAFE_INTEGER);
  }

  private lookup(path: string): DirEntry | undefined {
    const parts = path.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) return this.entries[0];
    let sid = this.entries[0]?.child ?? NOSTREAM;
    let found: DirEntry | undefined;
    for (const part of parts) {
      found = this.findChild(sid, part);
      if (found === undefined) return undefined;
      sid = found.child;
    }
    return found;
  }

  private findChild(sid: number, name: string): DirEntry | undefined {
    const seen = new Set<number>();
    const stack = [sid];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur > MAXREGSECT || seen.has(cur)) continue;
      seen.add(cur);
      const e = this.entries[cur];
      if (e === undefined || e.type === TYPE_UNKNOWN) continue;
      if (eqIgnoreAsciiCase(e.name, name)) return e;
      stack.push(e.left, e.right);
    }
    return undefined;
  }

  private walkSiblings(sid: number, out: { name: string; type: number }[]): void {
    const seen = new Set<number>();
    const visit = (id: number): void => {
      if (id > MAXREGSECT || seen.has(id)) return;
      seen.add(id);
      const e = this.entries[id];
      if (e === undefined || e.type === TYPE_UNKNOWN) return;
      visit(e.left);
      out.push({ name: e.name, type: e.type });
      visit(e.right);
    };
    visit(sid);
  }

  private readEntryBytes(entry: DirEntry, maxBytes: number): Uint8Array {
    const want = Math.min(entry.size, maxBytes);
    if (entry.size < this.miniCutoff && entry.type === TYPE_STREAM) {
      return this.readMiniChain(entry.start, want);
    }
    return readFatChain(this.bytes, this.fat, this.sectorSize, entry.start, want);
  }

  private readMiniChain(start: number, size: number): Uint8Array {
    if (this.miniStream === undefined) {
      const root = this.entries[0]!;
      this.miniStream = readFatChain(this.bytes, this.fat, this.sectorSize, root.start, root.size);
    }
    const out = new Uint8Array(size);
    let written = 0;
    let sector = start;
    const seen = new Set<number>();
    while (written < size && sector <= MAXREGSECT) {
      if (seen.has(sector)) break;
      seen.add(sector);
      const off = sector * this.miniSectorSize;
      const take = Math.min(this.miniSectorSize, size - written);
      if (off + take > this.miniStream.length) break;
      out.set(this.miniStream.subarray(off, off + take), written);
      written += take;
      sector = this.miniFat[sector] ?? ENDOFCHAIN;
    }
    return written === size ? out : out.subarray(0, written);
  }
}

export const OLE_MAGIC_BYTES = OLE_MAGIC;

export function hasOleMagic(bytes: Uint8Array): boolean {
  return startsWith(bytes, OLE_MAGIC);
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

function sectorOffset(sector: number, sectorSize: number): number {
  return (sector + 1) * sectorSize;
}

function readFatChain(
  bytes: Uint8Array,
  fat: number[],
  sectorSize: number,
  start: number,
  maxBytes: number,
): Uint8Array {
  if (start > MAXREGSECT || maxBytes <= 0) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let sector = start;
  const seen = new Set<number>();
  while (total < maxBytes && sector <= MAXREGSECT) {
    if (seen.has(sector) || seen.size > 1_000_000) break;
    seen.add(sector);
    const off = sectorOffset(sector, sectorSize);
    if (off >= bytes.length) break;
    const take = Math.min(sectorSize, maxBytes - total, bytes.length - off);
    if (take <= 0) break;
    chunks.push(bytes.subarray(off, off + take));
    total += take;
    sector = fat[sector] ?? ENDOFCHAIN;
    if (sector === FREESECT) break;
  }
  return concat(chunks, total);
}

function parseDirEntry(bytes: Uint8Array, off: number, majorVersion: number): DirEntry {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + off, 128);
  const nameLen = dv.getUint16(64, true);
  const nameBytes = Math.max(0, Math.min(64, nameLen > 0 ? nameLen - 2 : 0));
  const name = new TextDecoder('utf-16le').decode(bytes.subarray(off, off + nameBytes));
  const type = bytes[off + 66] ?? 0;
  const left = dv.getUint32(68, true);
  const right = dv.getUint32(72, true);
  const child = dv.getUint32(76, true);
  const start = dv.getUint32(116, true);
  let size = Number(dv.getBigUint64(120, true));
  if (majorVersion === 3) size = dv.getUint32(120, true);
  if (!Number.isFinite(size) || size < 0) size = 0;
  return { name, type, left, right, child, start, size };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]!.length === total) return chunks[0]!;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export { NOSTREAM, TYPE_STORAGE, TYPE_STREAM };
