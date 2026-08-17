import { inflateRaw } from '@mdgate/utils';

/** (verAndInstance, recType, body) of the OfficeArt record at `off`. */
export function recordAt(data: Uint8Array, off: number): [number, number, Uint8Array] | undefined {
  if (off < 0 || off + 8 > data.length) return undefined;
  const verInst = data[off]! | (data[off + 1]! << 8);
  const recType = data[off + 2]! | (data[off + 3]! << 8);
  const len =
    (data[off + 4]! | (data[off + 5]! << 8) | (data[off + 6]! << 16) | (data[off + 7]! << 24)) >>>
    0;
  if (off + 8 + len > data.length) return undefined;
  return [verInst, recType, data.subarray(off + 8, off + 8 + len)];
}

export interface Blip {
  mediaType: string;
  extension: string;
  bytes: Uint8Array;
}

/** Decode one blip record (`recType` 0xF01A–0xF01F). */
export function decodeBlip(
  verInst: number,
  recType: number,
  body: Uint8Array,
  maxBytes: number,
): Blip | undefined {
  const instance = verInst >>> 4;
  if (recType === 0xf01d || recType === 0xf01e) {
    const doubled = instance === 0x46b || instance === 0x6e3 || instance === 0x6e1;
    const start = (doubled ? 32 : 16) + 1;
    if (start > body.length) return undefined;
    const bytes = body.subarray(start);
    return recType === 0xf01d
      ? { mediaType: 'image/jpeg', extension: 'jpg', bytes }
      : { mediaType: 'image/png', extension: 'png', bytes };
  }
  if (recType === 0xf01a || recType === 0xf01b) {
    const doubled = instance === 0x3d5 || instance === 0x217;
    const header = doubled ? 32 : 16;
    if (header + 34 > body.length) return undefined;
    const headerAndData = body.subarray(header);
    const cbSize =
      (headerAndData[0]! |
        (headerAndData[1]! << 8) |
        (headerAndData[2]! << 16) |
        (headerAndData[3]! << 24)) >>>
      0;
    const compression = headerAndData[32]!;
    const data = headerAndData.subarray(34);
    const media =
      recType === 0xf01a
        ? { mediaType: 'image/emf', extension: 'emf' }
        : { mediaType: 'image/wmf', extension: 'wmf' };
    if (compression === 0x00) {
      const limit = Math.min(cbSize, maxBytes);
      const inflated = inflateRawCapped(data, limit);
      if (inflated === undefined) return undefined;
      return { ...media, bytes: inflated };
    }
    return { ...media, bytes: data };
  }
  return undefined;
}

/**
 * Find and decode the first blip in a run of OfficeArt records, descending
 * into containers.
 */
export function firstBlip(data: Uint8Array, maxBytes: number): Blip | undefined {
  const stack: Array<[number, number]> = [[0, data.length]];
  let visited = 0;
  for (;;) {
    const top = stack[stack.length - 1];
    if (top === undefined) return undefined;
    const [cursor, end] = top;
    if (cursor >= end) {
      stack.pop();
      continue;
    }
    const rec = recordAt(data.subarray(0, end), cursor);
    if (rec === undefined) {
      stack.pop();
      continue;
    }
    const [verInst, recType, body] = rec;
    const bodyStart = cursor + 8;
    const bodyEnd = bodyStart + body.length;
    top[0] = bodyEnd;
    visited += 1;
    if (visited > 10_000 || stack.length > 16) return undefined;
    const blip = decodeBlip(verInst, recType, body, maxBytes);
    if (blip !== undefined) return blip;
    if (recType === 0xf007) {
      const innerStart = bodyStart + (fbseBlipOffset(body) ?? body.length);
      if (innerStart < bodyEnd) stack.push([innerStart, bodyEnd]);
      continue;
    }
    if ((verInst & 0xf) === 0xf) stack.push([bodyStart, bodyEnd]);
  }
}

function fbseBlipOffset(body: Uint8Array): number | undefined {
  if (body.length <= 33) return undefined;
  const cbName = body[33]!;
  return 36 + cbName;
}

/** Decode the blip embedded in an FBSE (0xF007) record body, if present. */
export function fbseBlip(body: Uint8Array, maxBytes: number): Blip | undefined {
  const offset = fbseBlipOffset(body);
  if (offset === undefined) return undefined;
  const rec = recordAt(body, offset);
  if (rec === undefined) return undefined;
  return decodeBlip(rec[0], rec[1], rec[2], maxBytes);
}

function inflateRawCapped(data: Uint8Array, maxOut: number): Uint8Array | undefined {
  try {
    return inflateRaw(data, maxOut);
  } catch {
    return undefined;
  }
}
