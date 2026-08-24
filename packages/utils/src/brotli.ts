import { BrotliDecode } from './brotli-decode.js';
import { InflateLimitError } from './inflate.js';

const decodeBrotli = BrotliDecode as (input: Int8Array, options?: unknown) => Int8Array;

/** Brotli (RFC 7932). Used by PDF 2.0 `/BrotliDecode`. */
export function inflateBrotli(data: Uint8Array, maxOut: number): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  const input = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = decodeBrotli(input);
  if (out.length > maxOut) throw new InflateLimitError(maxOut);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
