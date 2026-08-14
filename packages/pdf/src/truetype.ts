/** Embedded TrueType / OpenType `cmap` fallback when ToUnicode is missing or sparse. */

export interface TrueTypeCmaps {
  /** GID → Unicode (reversed Unicode cmap). Used for Identity-H CID fonts. */
  gidToUnicode: Map<number, string>;
  /** Single-byte character code → Unicode (Mac Roman / Symbol / BMP). */
  codeToUnicode: Map<number, string>;
}

export function parseTrueTypeCmaps(font: Uint8Array): TrueTypeCmaps | undefined {
  const face = locateFace(font);
  if (!face) return undefined;
  const cmap = tableOf(face, 'cmap');
  if (!cmap) return undefined;

  const subtables = listCmapSubtables(cmap);
  if (subtables.length === 0) return undefined;

  const gidToUnicode = new Map<number, string>();
  for (const sub of subtables) {
    if (!isUnicodeSubtable(sub)) continue;
    for (const [cp, gid] of iterateCmap(cmap, sub)) {
      if (gid === 0) continue;
      const ch = stripPua(codepointToChar(cp));
      if (ch !== undefined && !gidToUnicode.has(gid)) gidToUnicode.set(gid, ch);
    }
  }

  const codeToUnicode = new Map<number, string>();
  const mac = subtables.find((s) => s.platformId === 1 && s.encodingId === 0);
  const winSymbol = subtables.find((s) => s.platformId === 3 && s.encodingId === 0);
  const winBmp = subtables.find((s) => s.platformId === 3 && s.encodingId === 1);

  if (mac) {
    for (const [code, gid] of iterateCmap(cmap, mac)) {
      if (code < 0x20 || code > 0xff || gid === 0) continue;
      const ch = gidToUnicode.get(gid);
      if (ch !== undefined && !codeToUnicode.has(code)) codeToUnicode.set(code, ch);
    }
  }
  if (codeToUnicode.size === 0 && winSymbol) {
    for (const [cp, gid] of iterateCmap(cmap, winSymbol)) {
      const code = cp >= 0xf000 && cp <= 0xf0ff ? cp - 0xf000 : cp;
      if (code < 0x20 || code > 0xff || gid === 0) continue;
      const ch = gidToUnicode.get(gid) ?? stripPua(codepointToChar(cp));
      if (ch !== undefined && !codeToUnicode.has(code)) codeToUnicode.set(code, ch);
    }
  }
  if (codeToUnicode.size === 0 && winBmp) {
    for (const [cp, gid] of iterateCmap(cmap, winBmp)) {
      if (cp < 0x20 || cp > 0xff || gid === 0) continue;
      const ch = gidToUnicode.get(gid) ?? codepointToChar(cp);
      if (ch !== undefined && !codeToUnicode.has(cp)) codeToUnicode.set(cp, ch);
    }
  }
  if (codeToUnicode.size === 0) {
    for (const [gid, ch] of gidToUnicode) {
      if (gid <= 0xff && !codeToUnicode.has(gid)) codeToUnicode.set(gid, ch);
    }
  }

  if (gidToUnicode.size === 0 && codeToUnicode.size === 0) return undefined;
  return { gidToUnicode, codeToUnicode };
}

export function cmapFromTrueType(
  font: Uint8Array,
  kind: 'cid' | 'simple',
): Map<number, string> | undefined {
  const parsed = parseTrueTypeCmaps(font);
  if (!parsed) return undefined;
  if (kind === 'cid') {
    return parsed.gidToUnicode.size > 0 ? parsed.gidToUnicode : undefined;
  }
  return parsed.codeToUnicode.size > 0 ? parsed.codeToUnicode : undefined;
}

interface Face {
  data: Uint8Array;
  tables: Map<string, { offset: number; length: number }>;
}

interface CmapSubtable {
  platformId: number;
  encodingId: number;
  offset: number;
  format: number;
}

function locateFace(font: Uint8Array): Face | undefined {
  if (font.length < 12) return undefined;
  if (asciiAt(font, 0, 4) === 'ttcf') {
    if (font.length < 16) return undefined;
    const offset = readU32(font, 12);
    return parseSfnt(font, offset);
  }
  return parseSfnt(font, 0);
}

function parseSfnt(data: Uint8Array, origin: number): Face | undefined {
  if (origin + 12 > data.length) return undefined;
  const tag = asciiAt(data, origin, 4);
  if (tag !== 'true' && tag !== 'OTTO' && tag !== '\0\x01\0\0' && tag !== 'typ1') {
    const version = readU32(data, origin);
    if (version !== 0x00010000) return undefined;
  }
  const numTables = readU16(data, origin + 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i += 1) {
    const rec = origin + 12 + i * 16;
    if (rec + 16 > data.length) break;
    const name = asciiAt(data, rec, 4);
    const offset = readU32(data, rec + 8);
    const length = readU32(data, rec + 12);
    if (offset + length <= data.length) tables.set(name, { offset, length });
  }
  return { data, tables };
}

function tableOf(face: Face, tag: string): Uint8Array | undefined {
  const rec = face.tables.get(tag);
  if (!rec) return undefined;
  return face.data.subarray(rec.offset, rec.offset + rec.length);
}

function listCmapSubtables(cmap: Uint8Array): CmapSubtable[] {
  if (cmap.length < 4) return [];
  const n = readU16(cmap, 2);
  const out: CmapSubtable[] = [];
  for (let i = 0; i < n; i += 1) {
    const off = 4 + i * 8;
    if (off + 8 > cmap.length) break;
    const platformId = readU16(cmap, off);
    const encodingId = readU16(cmap, off + 2);
    const offset = readU32(cmap, off + 4);
    if (offset + 2 > cmap.length) continue;
    out.push({ platformId, encodingId, offset, format: readU16(cmap, offset) });
  }
  return out;
}

function isUnicodeSubtable(sub: CmapSubtable): boolean {
  if (sub.platformId === 0) return true;
  if (sub.platformId === 3 && (sub.encodingId === 1 || sub.encodingId === 10)) return true;
  return sub.platformId === 3 && sub.encodingId === 0;
}

function iterateCmap(cmap: Uint8Array, sub: CmapSubtable): Iterable<[number, number]> {
  const format = sub.format;
  if (format === 0) return parseFormat0(cmap, sub.offset);
  if (format === 4) return parseFormat4(cmap, sub.offset);
  if (format === 6) return parseFormat6(cmap, sub.offset);
  if (format === 12) return parseFormat12(cmap, sub.offset);
  return [];
}

function parseFormat0(cmap: Uint8Array, offset: number): [number, number][] {
  if (offset + 262 > cmap.length) return [];
  const out: [number, number][] = [];
  for (let code = 0; code < 256; code += 1) {
    out.push([code, cmap[offset + 6 + code]!]);
  }
  return out;
}

function parseFormat4(cmap: Uint8Array, offset: number): [number, number][] {
  if (offset + 16 > cmap.length) return [];
  const length = readU16(cmap, offset + 2);
  const end = Math.min(offset + length, cmap.length);
  const segCount = readU16(cmap, offset + 6) >> 1;
  const endCodes = offset + 14;
  const startCodes = endCodes + 2 * segCount + 2;
  const idDeltas = startCodes + 2 * segCount;
  const idRangeOffsets = idDeltas + 2 * segCount;
  if (idRangeOffsets + 2 * segCount > end) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < segCount; i += 1) {
    const start = readU16(cmap, startCodes + 2 * i);
    const last = readU16(cmap, endCodes + 2 * i);
    const delta = readI16(cmap, idDeltas + 2 * i);
    const rangeOffset = readU16(cmap, idRangeOffsets + 2 * i);
    for (let c = start; c <= last; c += 1) {
      let gid: number;
      if (rangeOffset === 0) {
        gid = (c + delta) & 0xffff;
      } else {
        const glyphOffset = idRangeOffsets + 2 * i + rangeOffset + (c - start) * 2;
        if (glyphOffset + 2 > end) continue;
        const raw = readU16(cmap, glyphOffset);
        gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (gid !== 0) out.push([c, gid]);
    }
  }
  return out;
}

function parseFormat6(cmap: Uint8Array, offset: number): [number, number][] {
  if (offset + 10 > cmap.length) return [];
  const first = readU16(cmap, offset + 6);
  const count = readU16(cmap, offset + 8);
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const pos = offset + 10 + i * 2;
    if (pos + 2 > cmap.length) break;
    out.push([first + i, readU16(cmap, pos)]);
  }
  return out;
}

function parseFormat12(cmap: Uint8Array, offset: number): [number, number][] {
  if (offset + 16 > cmap.length) return [];
  const nGroups = readU32(cmap, offset + 12);
  const out: [number, number][] = [];
  for (let i = 0; i < nGroups; i += 1) {
    const pos = offset + 16 + i * 12;
    if (pos + 12 > cmap.length) break;
    const start = readU32(cmap, pos);
    const last = readU32(cmap, pos + 4);
    const startGid = readU32(cmap, pos + 8);
    for (let c = start; c <= last; c += 1) {
      out.push([c, startGid + (c - start)]);
    }
  }
  return out;
}

function codepointToChar(cp: number): string | undefined {
  if (cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return undefined;
  }
}

function stripPua(ch: string | undefined): string | undefined {
  if (ch === undefined || ch.length === 0) return ch;
  const cp = ch.codePointAt(0);
  if (cp !== undefined && cp >= 0xf000 && cp <= 0xf0ff) return codepointToChar(cp - 0xf000);
  return ch;
}

function asciiAt(data: Uint8Array, i: number, n: number): string {
  let s = '';
  for (let k = 0; k < n; k += 1) s += String.fromCharCode(data[i + k]!);
  return s;
}

function readU16(data: Uint8Array, i: number): number {
  return ((data[i]! << 8) | data[i + 1]!) >>> 0;
}

function readI16(data: Uint8Array, i: number): number {
  const v = readU16(data, i);
  return v >= 0x8000 ? v - 0x10000 : v;
}

function readU32(data: Uint8Array, i: number): number {
  return ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0;
}
