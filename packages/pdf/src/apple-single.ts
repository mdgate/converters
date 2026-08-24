const MAGIC = 0x00051600;
const VERSION = 0x00020000;
const DATA_FORK = 1;

function u32(data: Uint8Array, i: number): number {
  return ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0;
}

function u16(data: Uint8Array, i: number): number {
  return (data[i]! << 8) | data[i + 1]!;
}

/** AppleSingle (RFC 1740) data fork, if the bytes are a well-formed wrapper. */
export function unwrapAppleSingle(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length < 26) return undefined;
  if (u32(bytes, 0) !== MAGIC || u32(bytes, 4) !== VERSION) return undefined;
  const n = u16(bytes, 24);
  if (n <= 0 || n > 32) return undefined;
  let fork: Uint8Array | undefined;
  for (let i = 0; i < n; i += 1) {
    const at = 26 + i * 12;
    if (at + 12 > bytes.length) return undefined;
    const id = u32(bytes, at);
    const offset = u32(bytes, at + 4);
    const length = u32(bytes, at + 8);
    if (offset > bytes.length || length > bytes.length - offset) return undefined;
    if (id === DATA_FORK) fork = bytes.subarray(offset, offset + length);
  }
  return fork !== undefined && fork.length > 0 ? fork : undefined;
}
