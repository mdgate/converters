import { ConvertError } from '@mdgate/core';

/**
 * Decompress a raw Snappy block (not the framing format). iWork IWA chunks
 * store one such block after a 4-byte header.
 */
export function snappyDecode(input: Uint8Array, maxOut = Number.MAX_SAFE_INTEGER): Uint8Array {
  let i = 0;
  const [uncompressedLen, afterLen] = readVarint(input, 0);
  i = afterLen;
  if (uncompressedLen > maxOut) {
    throw ConvertError.malformed(`snappy block declares ${uncompressedLen} decompressed bytes`);
  }
  const out = new Uint8Array(uncompressedLen);
  let o = 0;
  while (i < input.length && o < uncompressedLen) {
    const tag = input[i]!;
    i += 1;
    const kind = tag & 3;
    if (kind === 0) {
      let litLen = tag >> 2;
      if (litLen < 60) {
        litLen += 1;
      } else {
        const extra = litLen - 59;
        litLen = 0;
        for (let e = 0; e < extra; e += 1) {
          if (i >= input.length) throw malformed('truncated snappy literal length');
          litLen |= input[i]! << (8 * e);
          i += 1;
        }
        litLen += 1;
      }
      if (i + litLen > input.length || o + litLen > out.length) {
        throw malformed('truncated snappy literal');
      }
      out.set(input.subarray(i, i + litLen), o);
      i += litLen;
      o += litLen;
      continue;
    }

    let copyLen: number;
    let offset: number;
    if (kind === 1) {
      if (i >= input.length) throw malformed('truncated snappy copy');
      copyLen = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | input[i]!;
      i += 1;
    } else if (kind === 2) {
      if (i + 2 > input.length) throw malformed('truncated snappy copy');
      copyLen = (tag >> 2) + 1;
      offset = input[i]! | (input[i + 1]! << 8);
      i += 2;
    } else {
      if (i + 4 > input.length) throw malformed('truncated snappy copy');
      copyLen = (tag >> 2) + 1;
      offset = input[i]! | (input[i + 1]! << 8) | (input[i + 2]! << 16) | (input[i + 3]! << 24);
      i += 4;
    }
    if (offset === 0 || offset > o || o + copyLen > out.length) {
      throw malformed('invalid snappy copy');
    }
    for (let c = 0; c < copyLen; c += 1) {
      out[o] = out[o - offset]!;
      o += 1;
    }
  }
  if (o !== uncompressedLen) throw malformed('snappy length mismatch');
  return out;
}

/**
 * Compress with literals only. Used by tests / fixture builders; production
 * converters only decompress.
 */
export function snappyEncodeLiterals(input: Uint8Array): Uint8Array {
  const chunks: number[] = [];
  writeVarint(chunks, input.length);
  let offset = 0;
  while (offset < input.length) {
    const remaining = input.length - offset;
    const take = Math.min(remaining, 65536);
    emitLiteral(chunks, input.subarray(offset, offset + take));
    offset += take;
  }
  return Uint8Array.from(chunks);
}

function emitLiteral(out: number[], bytes: Uint8Array): void {
  const len = bytes.length;
  if (len <= 60) {
    out.push(((len - 1) << 2) | 0);
  } else if (len <= 256) {
    out.push((60 << 2) | 0, len - 1);
  } else if (len <= 65536) {
    out.push((61 << 2) | 0, (len - 1) & 0xff, ((len - 1) >> 8) & 0xff);
  } else {
    throw new Error('literal too large');
  }
  for (let i = 0; i < bytes.length; i += 1) out.push(bytes[i]!);
}

/**
 * Protobuf / Snappy unsigned varint. Up to 10 bytes (64-bit). Values above
 * 2^53 are returned as an imprecise number; callers that only need the
 * consumed width still advance correctly.
 */
export function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < bytes.length && shift <= 63) {
    const b = bytes[i]!;
    i += 1;
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return [result, i];
    shift += 7;
  }
  throw malformed('truncated varint');
}

export function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function malformed(detail: string): ConvertError {
  return ConvertError.malformed(detail);
}
