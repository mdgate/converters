import type { ImageMime } from '@mdgate/core';

export type RawPdfImage = {
  width: number;
  height: number;
  colorSpace: string | undefined;
  bitsPerComponent: number;
  filters: readonly string[];
  /** Stream after ASCII/Flate filters; DCT bytes stay JPEG. */
  data: Uint8Array;
  indexedPalette?: Uint8Array;
};

/** Turn a PDF image XObject into JPEG/PNG bytes. Returns undefined when we cannot. */
export function xObjectToImage(
  raw: RawPdfImage,
): { bytes: Uint8Array; mime: ImageMime } | undefined {
  if (raw.width < 1 || raw.height < 1 || raw.data.length === 0) return undefined;
  if (raw.filters.some((f) => f === '/DCTDecode' || f === '/DCT')) {
    return { bytes: raw.data, mime: 'image/jpeg' };
  }
  if (
    raw.filters.some((f) => f === '/JPXDecode' || f === '/CCITTFaxDecode' || f === '/JBIG2Decode')
  ) {
    return undefined;
  }
  if (raw.bitsPerComponent !== 8) return undefined;

  const pixels = pixelsFromRaw(raw);
  if (!pixels) return undefined;
  return {
    bytes: encodePng(raw.width, raw.height, pixels.colorType, pixels.bytes),
    mime: 'image/png',
  };
}

function pixelsFromRaw(raw: RawPdfImage): { colorType: 0 | 2; bytes: Uint8Array } | undefined {
  const n = raw.width * raw.height;
  const cs = raw.colorSpace;
  if (cs === '/DeviceGray' || cs === '/G') {
    if (raw.data.length < n) return undefined;
    return { colorType: 0, bytes: raw.data.subarray(0, n) };
  }
  if (cs === '/DeviceRGB' || cs === '/RGB') {
    if (raw.data.length < n * 3) return undefined;
    return { colorType: 2, bytes: raw.data.subarray(0, n * 3) };
  }
  if (cs === '/DeviceCMYK' || cs === '/CMYK') {
    if (raw.data.length < n * 4) return undefined;
    const rgb = new Uint8Array(n * 3);
    for (let i = 0, o = 0; i < n; i += 1, o += 3) {
      const c = raw.data[i * 4]! / 255;
      const m = raw.data[i * 4 + 1]! / 255;
      const y = raw.data[i * 4 + 2]! / 255;
      const k = raw.data[i * 4 + 3]! / 255;
      rgb[o] = Math.round(255 * (1 - c) * (1 - k));
      rgb[o + 1] = Math.round(255 * (1 - m) * (1 - k));
      rgb[o + 2] = Math.round(255 * (1 - y) * (1 - k));
    }
    return { colorType: 2, bytes: rgb };
  }
  if (cs === '/Indexed' && raw.indexedPalette && raw.indexedPalette.length >= 3) {
    if (raw.data.length < n) return undefined;
    const pal = raw.indexedPalette;
    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const idx = Math.min(raw.data[i]!, Math.floor(pal.length / 3) - 1);
      rgb[i * 3] = pal[idx * 3] ?? 0;
      rgb[i * 3 + 1] = pal[idx * 3 + 1] ?? 0;
      rgb[i * 3 + 2] = pal[idx * 3 + 2] ?? 0;
    }
    return { colorType: 2, bytes: rgb };
  }
  return undefined;
}

function encodePng(
  width: number,
  height: number,
  colorType: 0 | 2,
  pixels: Uint8Array,
): Uint8Array {
  const bpp = colorType === 0 ? 1 : 3;
  const stride = width * bpp;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + stride)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const chunks: Uint8Array[] = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array()),
  ];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  writeU32(out, 8 + data.length, crc);
  return out;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  let i = 0;
  while (i < data.length) {
    const n = Math.min(0xffff, data.length - i);
    const last = i + n >= data.length ? 1 : 0;
    const hdr = new Uint8Array(5);
    hdr[0] = last;
    hdr[1] = n & 0xff;
    hdr[2] = (n >> 8) & 0xff;
    hdr[3] = ~n & 0xff;
    hdr[4] = (~n >> 8) & 0xff;
    blocks.push(hdr, data.subarray(i, i + n));
    i += n;
  }
  const adler = new Uint8Array(4);
  writeU32(adler, 0, adler32(data));
  blocks.push(adler);
  let total = 0;
  for (const b of blocks) total += b.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

function writeU32(out: Uint8Array, i: number, v: number): void {
  out[i] = (v >>> 24) & 0xff;
  out[i + 1] = (v >>> 16) & 0xff;
  out[i + 2] = (v >>> 8) & 0xff;
  out[i + 3] = v & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of data) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
