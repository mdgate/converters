import { ConvertError } from '@mdgate/core';
import { asciiEq, concatBytes, u16, u32 } from './binary.js';

export const COMPRESS_NONE = 1;
export const COMPRESS_PALMDOC = 2;
export const COMPRESS_HUFF = 17480;

const MAX_RECORD_OUT = 1024 * 1024;

export function decompressRecord(
  data: Uint8Array,
  compression: number,
  huff: HuffReader | undefined,
  remaining: number,
): Uint8Array {
  const limit = Math.min(remaining, MAX_RECORD_OUT);
  if (compression === COMPRESS_NONE) {
    if (data.length > limit) {
      throw ConvertError.resourceLimit('max_entry_bytes', 'text record exceeds the read cap');
    }
    return data;
  }
  if (compression === COMPRESS_PALMDOC) return palmdocDecompress(data, limit);
  if (compression === COMPRESS_HUFF) {
    if (huff === undefined) throw ConvertError.malformed('HUFF/CDIC dictionary is missing');
    return huff.unpack(data, limit);
  }
  throw ConvertError.unsupported(`compression ${compression}`);
}

/** PalmDOC LZ77 (MobileRead / PalmDOC). */
export function palmdocDecompress(data: Uint8Array, limit: number): Uint8Array {
  let out: Uint8Array = new Uint8Array(Math.min(Math.max(data.length * 2, 64), limit));
  let used = 0;
  let p = 0;
  while (p < data.length) {
    const c = data[p]!;
    p += 1;
    if (c >= 1 && c <= 8) {
      const n = Math.min(c, data.length - p);
      out = ensure(out, used, n, limit);
      out.set(data.subarray(p, p + n), used);
      used += n;
      p += n;
      continue;
    }
    if (c < 0x80) {
      out = ensure(out, used, 1, limit);
      out[used] = c;
      used += 1;
      continue;
    }
    if (c >= 0xc0) {
      out = ensure(out, used, 2, limit);
      out[used] = 0x20;
      out[used + 1] = c ^ 0x80;
      used += 2;
      continue;
    }
    if (p >= data.length) break;
    const pair = (c << 8) | data[p]!;
    p += 1;
    const dist = (pair >> 3) & 0x07ff;
    const n = (pair & 7) + 3;
    if (dist === 0 || dist > used) {
      throw ConvertError.malformed('invalid PalmDOC backreference');
    }
    out = ensure(out, used, n, limit);
    for (let i = 0; i < n; i += 1) out[used + i] = out[used - dist + i]!;
    used += n;
  }
  return out.subarray(0, used);
}

interface HuffPhrase {
  data: Uint8Array;
  unpacked: boolean;
}

export class HuffReader {
  private readonly dict1: Array<{ codeLen: number; term: boolean; maxCode: number }>;
  private readonly minCode: number[];
  private readonly maxCode: number[];
  private readonly dictionary: HuffPhrase[];

  constructor(records: readonly Uint8Array[]) {
    if (records.length === 0) throw ConvertError.malformed('HUFF/CDIC dictionary is missing');
    const loaded = loadHuff(records[0]!);
    this.dict1 = loaded.dict1;
    this.minCode = loaded.minCode;
    this.maxCode = loaded.maxCode;
    this.dictionary = [];
    for (let i = 1; i < records.length; i += 1) loadCdic(records[i]!, this.dictionary);
    if (this.dictionary.length === 0) {
      throw ConvertError.malformed('HUFF/CDIC dictionary is empty');
    }
  }

  unpack(data: Uint8Array, limit: number): Uint8Array {
    return unpackHuff(data, this.dict1, this.minCode, this.maxCode, this.dictionary, limit);
  }
}

function loadHuff(huff: Uint8Array): {
  dict1: Array<{ codeLen: number; term: boolean; maxCode: number }>;
  minCode: number[];
  maxCode: number[];
} {
  if (huff.length < 16 || !asciiEq(huff, 0, 'HUFF') || u32(huff, 4) !== 0x18) {
    throw ConvertError.malformed('invalid HUFF header');
  }
  const off1 = u32(huff, 8);
  const off2 = u32(huff, 12);
  if (off1 + 256 * 4 > huff.length || off2 + 64 * 4 > huff.length) {
    throw ConvertError.malformed('truncated HUFF tables');
  }
  const dict1: Array<{ codeLen: number; term: boolean; maxCode: number }> = [];
  for (let i = 0; i < 256; i += 1) {
    const v = u32(huff, off1 + i * 4);
    const codeLen = v & 0x1f;
    if (codeLen === 0) throw ConvertError.malformed('invalid HUFF dictionary');
    dict1.push({
      codeLen,
      term: (v & 0x80) !== 0,
      maxCode: shlMinus1(v >>> 8, 32 - codeLen),
    });
  }
  const minCode = [0];
  const maxCode = [0];
  for (let i = 0; i < 32; i += 1) {
    const min = u32(huff, off2 + i * 8);
    const max = u32(huff, off2 + i * 8 + 4);
    const shift = 32 - (i + 1);
    minCode.push(shl(min, shift));
    maxCode.push(shlMinus1(max, shift));
  }
  return { dict1, minCode, maxCode };
}

function loadCdic(cdic: Uint8Array, dictionary: HuffPhrase[]): void {
  if (cdic.length < 16 || !asciiEq(cdic, 0, 'CDIC') || u32(cdic, 4) !== 0x10) {
    throw ConvertError.malformed('invalid CDIC header');
  }
  const phrases = u32(cdic, 8);
  const bits = u32(cdic, 12);
  if (bits > 16) throw ConvertError.malformed('invalid CDIC bit width');
  const n = Math.min(1 << bits, Math.max(0, phrases - dictionary.length));
  if (16 + n * 2 > cdic.length) throw ConvertError.malformed('truncated CDIC index');
  for (let i = 0; i < n; i += 1) {
    const off = u16(cdic, 16 + i * 2);
    const pos = 16 + off;
    if (pos + 2 > cdic.length) throw ConvertError.malformed('truncated CDIC phrase');
    const blen = u16(cdic, pos);
    const len = blen & 0x7fff;
    const start = pos + 2;
    if (start + len > cdic.length) throw ConvertError.malformed('truncated CDIC phrase');
    dictionary.push({
      data: cdic.subarray(start, start + len),
      unpacked: (blen & 0x8000) !== 0,
    });
  }
}

function unpackHuff(
  data: Uint8Array,
  dict1: Array<{ codeLen: number; term: boolean; maxCode: number }>,
  minCode: number[],
  maxCode: number[],
  dictionary: HuffPhrase[],
  limit: number,
): Uint8Array {
  let bitsLeft = data.length * 8;
  let pos = 0;
  let x = readU64(data, 0);
  let n = 32;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (n <= 0) {
      pos += 4;
      x = readU64(data, pos);
      n += 32;
    }
    const code = Number((x >> BigInt(n)) & 0xffffffffn) >>> 0;
    let { codeLen, term, maxCode: leafMax } = dict1[code >>> 24]!;
    if (!term) {
      while (codeLen < minCode.length && code < minCode[codeLen]!) codeLen += 1;
      if (codeLen >= maxCode.length) throw ConvertError.malformed('invalid HUFF code');
      leafMax = maxCode[codeLen]!;
    }
    n -= codeLen;
    bitsLeft -= codeLen;
    if (bitsLeft < 0) break;
    const shift = 32 - codeLen;
    const r = shift >= 32 ? 0 : (leafMax - code) >>> shift;
    const phrase = dictionary[r];
    if (phrase === undefined) throw ConvertError.malformed('invalid HUFF phrase');
    if (!phrase.unpacked) {
      phrase.data = unpackHuff(phrase.data, dict1, minCode, maxCode, dictionary, limit);
      phrase.unpacked = true;
    }
    parts.push(phrase.data);
    total += phrase.data.length;
    if (total > limit) {
      throw ConvertError.resourceLimit('max_entry_bytes', 'decompressed text exceeds the read cap');
    }
  }
  return concatBytes(parts, total);
}

function readU64(data: Uint8Array, pos: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i += 1) v = (v << 8n) | BigInt(data[pos + i] ?? 0);
  return v;
}

function shl(value: number, shift: number): number {
  if (shift <= 0) return value >>> 0;
  if (shift >= 32) return 0;
  return Number((BigInt(value) << BigInt(shift)) & 0xffffffffn) >>> 0;
}

function shlMinus1(value: number, shift: number): number {
  if (shift <= 0) return value >>> 0;
  if (shift >= 32) return 0xffffffff;
  return Number((((BigInt(value) + 1n) << BigInt(shift)) - 1n) & 0xffffffffn) >>> 0;
}

function ensure(buf: Uint8Array, used: number, need: number, limit: number): Uint8Array {
  if (used + need > limit) {
    throw ConvertError.resourceLimit('max_entry_bytes', 'decompressed text exceeds the read cap');
  }
  if (used + need <= buf.length) return buf;
  let cap = buf.length === 0 ? 64 : buf.length;
  while (cap < used + need) cap *= 2;
  const next = new Uint8Array(Math.min(cap, limit));
  next.set(buf.subarray(0, used));
  return next;
}

/**
 * Drop MOBI trailing entries indicated by extra-record-data flags.
 * Bit 0 is the multibyte-overlap trailer; bits 1–15 are sized backwards.
 */
export function trimTrailing(data: Uint8Array, extraFlags: number): Uint8Array {
  let cur = data;
  let flags = extraFlags >>> 1;
  while (flags !== 0) {
    if ((flags & 1) !== 0) {
      const size = trailingEntrySize(cur);
      if (size <= 0 || size > cur.length) break;
      cur = cur.subarray(0, cur.length - size);
    }
    flags >>>= 1;
  }
  if ((extraFlags & 1) !== 0 && cur.length > 0) {
    const size = (cur[cur.length - 1]! & 3) + 1;
    if (size <= cur.length) cur = cur.subarray(0, cur.length - size);
  }
  return cur;
}

function trailingEntrySize(data: Uint8Array): number {
  let num = 0;
  const n = Math.min(data.length, 4);
  for (let i = 0; i < n; i += 1) {
    const b = data[data.length - 1 - i]!;
    if ((b & 0x80) !== 0) num = 0;
    num = (num << 7) | (b & 0x7f);
  }
  return num;
}
