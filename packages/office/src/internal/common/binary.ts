import { ConvertError } from '../error.js';
import type { CompoundFile } from '../package/cfb.js';
import { MAX_ENTRY_BYTES } from '../package/limits.js';

/** Little-endian `u16` at `off`; `undefined` when out of bounds. */
export function getU16(b: Uint8Array, off: number): number | undefined {
  if (!Number.isSafeInteger(off) || off < 0 || off + 2 > b.length) return undefined;
  return b[off]! | (b[off + 1]! << 8);
}

/** Little-endian `u32` at `off`; `undefined` when out of bounds. */
export function getU32(b: Uint8Array, off: number): number | undefined {
  if (!Number.isSafeInteger(off) || off < 0 || off + 4 > b.length) return undefined;
  return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}

/**
 * Read a named stream from an OLE2 compound file. A missing stream is
 * `missingPart`; the read is hard-capped at `MAX_ENTRY_BYTES`.
 */
export function readOleStream(ole: CompoundFile, name: string): Uint8Array {
  try {
    return ole.readStream(name);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw ConvertError.malformedPart(name, `unreadable stream: ${msg}`);
  }
}

export { MAX_ENTRY_BYTES };
