/** Thrown when decompressed output would exceed `maxOut`. */
export class InflateLimitError extends Error {
  readonly maxOut: number;

  constructor(maxOut: number) {
    super(`decompressed output exceeds ${maxOut} bytes`);
    this.name = 'InflateLimitError';
    this.maxOut = maxOut;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raw DEFLATE (RFC 1951). */
export function inflateRaw(data: Uint8Array, maxOut: number): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  return inflateStream(new BitStream(data), maxOut);
}

/** zlib-wrapped DEFLATE (RFC 1950). */
export function inflateZlib(data: Uint8Array, maxOut: number): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  if (data.length < 2) throw new Error('invalid zlib header');
  const cmf = data[0]!;
  const flg = data[1]!;
  if (((cmf << 8) + flg) % 31 !== 0) throw new Error('invalid zlib header');
  if ((cmf & 0x0f) !== 8) throw new Error('unsupported zlib method');
  if (cmf >> 4 > 7) throw new Error('invalid zlib window size');
  if ((flg & 0x20) !== 0) throw new Error('zlib preset dictionary not supported');

  const bits = new BitStream(data, 2);
  const out = inflateStream(bits, maxOut);
  const adlerOff = bits.byteOffset;
  if (adlerOff + 4 > data.length) throw new Error('truncated zlib checksum');
  const expect =
    ((data[adlerOff]! << 24) |
      (data[adlerOff + 1]! << 16) |
      (data[adlerOff + 2]! << 8) |
      data[adlerOff + 3]!) >>>
    0;
  if (adler32(out) !== expect) throw new Error('zlib checksum mismatch');
  return out;
}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const FIXED_LITLEN = makeFixedLitLen();
const FIXED_DIST = makeFixedDist();
const MAX_TYPED_ARRAY = 0x7fff_ff00;

type Huffman = {
  counts: Uint16Array;
  symbols: Uint16Array;
  maxBits: number;
};

function makeFixedLitLen(): Huffman {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return buildHuffman(lengths);
}

function makeFixedDist(): Huffman {
  return buildHuffman(new Uint8Array(32).fill(5));
}

function inflateStream(bits: BitStream, maxOut: number): Uint8Array {
  const out = new OutBuffer(maxOut);
  for (;;) {
    const last = bits.bits(1);
    const type = bits.bits(2);
    if (type === 0) stored(bits, out);
    else if (type === 1) coded(bits, out, FIXED_LITLEN, FIXED_DIST);
    else if (type === 2) dynamic(bits, out);
    else throw new Error('invalid deflate block type');
    if (last) return out.result();
  }
}

function stored(bits: BitStream, out: OutBuffer): void {
  bits.align();
  const len = bits.readByte() | (bits.readByte() << 8);
  const nlen = bits.readByte() | (bits.readByte() << 8);
  if ((len ^ 0xffff) !== nlen) throw new Error('invalid stored block lengths');
  out.writeBytes(bits.readBytes(len));
}

function dynamic(bits: BitStream, out: OutBuffer): void {
  const hlit = bits.bits(5) + 257;
  const hdist = bits.bits(5) + 1;
  const hclen = bits.bits(4) + 4;
  const clens = new Uint8Array(19);
  for (let i = 0; i < hclen; i += 1) clens[CL_ORDER[i]!] = bits.bits(3);
  const clTree = buildHuffman(clens);

  const lengths = new Uint8Array(hlit + hdist);
  for (let i = 0; i < lengths.length; ) {
    const sym = decodeSymbol(bits, clTree);
    if (sym < 16) {
      lengths[i] = sym;
      i += 1;
      continue;
    }
    let rep = 0;
    let value = 0;
    if (sym === 16) {
      if (i === 0) throw new Error('invalid repeat of previous code length');
      value = lengths[i - 1]!;
      rep = bits.bits(2) + 3;
    } else if (sym === 17) {
      rep = bits.bits(3) + 3;
    } else if (sym === 18) {
      rep = bits.bits(7) + 11;
    } else {
      throw new Error('invalid code length symbol');
    }
    if (i + rep > lengths.length) throw new Error('code length repeat overflows table');
    lengths.fill(value, i, i + rep);
    i += rep;
  }

  coded(bits, out, buildHuffman(lengths.subarray(0, hlit)), buildHuffman(lengths.subarray(hlit)));
}

function coded(bits: BitStream, out: OutBuffer, litlen: Huffman, dist: Huffman): void {
  for (;;) {
    const sym = decodeSymbol(bits, litlen);
    if (sym < 256) {
      out.write(sym);
      continue;
    }
    if (sym === 256) return;
    if (sym > 285) throw new Error('invalid literal/length symbol');
    const lenIdx = sym - 257;
    const length = LEN_BASE[lenIdx]! + bits.bits(LEN_EXTRA[lenIdx]!);
    const dsym = decodeSymbol(bits, dist);
    if (dsym > 29) throw new Error('invalid distance symbol');
    const distance = DIST_BASE[dsym]! + bits.bits(DIST_EXTRA[dsym]!);
    out.copy(distance, length);
  }
}

function buildHuffman(lengths: Uint8Array): Huffman {
  const n = lengths.length;
  let maxBits = 0;
  for (let i = 0; i < n; i += 1) {
    if (lengths[i]! > maxBits) maxBits = lengths[i]!;
  }
  if (maxBits > 15) throw new Error('invalid huffman code length');

  const counts = new Uint16Array(maxBits + 1);
  for (let i = 0; i < n; i += 1) counts[lengths[i]!] += 1;

  if (maxBits === 0 || counts[0] === n) {
    return { counts, symbols: new Uint16Array(0), maxBits: 0 };
  }

  counts[0] = 0;
  let left = 1;
  for (let len = 1; len <= maxBits; len += 1) {
    left = (left << 1) - counts[len]!;
    if (left < 0) throw new Error('over-subscribed huffman tree');
  }

  const offs = new Uint16Array(maxBits + 1);
  for (let len = 1; len <= maxBits; len += 1) {
    offs[len] = offs[len - 1]! + counts[len - 1]!;
  }
  const symbols = new Uint16Array(n);
  for (let sym = 0; sym < n; sym += 1) {
    const len = lengths[sym]!;
    if (len !== 0) {
      symbols[offs[len]!] = sym;
      offs[len] += 1;
    }
  }
  return { counts, symbols, maxBits };
}

function decodeSymbol(bits: BitStream, tree: Huffman): number {
  if (tree.maxBits === 0) throw new Error('empty huffman tree');
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= tree.maxBits; len += 1) {
    code = (code << 1) | bits.bit();
    const count = tree.counts[len]!;
    if (code - count < first) {
      return tree.symbols[index + (code - first)]!;
    }
    index += count;
    first = (first + count) << 1;
  }
  throw new Error('invalid huffman code');
}

class BitStream {
  private i: number;
  private buf = 0;
  private n = 0;

  constructor(
    private readonly data: Uint8Array,
    start = 0,
  ) {
    this.i = start;
  }

  get byteOffset(): number {
    return this.i;
  }

  bit(): number {
    if (this.n === 0) {
      if (this.i >= this.data.length) throw new Error('unexpected end of deflate stream');
      this.buf = this.data[this.i++]!;
      this.n = 8;
    }
    const b = this.buf & 1;
    this.buf >>= 1;
    this.n -= 1;
    return b;
  }

  bits(need: number): number {
    if (need === 0) return 0;
    let v = 0;
    let shift = 0;
    let left = need;
    while (left > 0) {
      if (this.n === 0) {
        if (this.i >= this.data.length) throw new Error('unexpected end of deflate stream');
        this.buf = this.data[this.i++]!;
        this.n = 8;
      }
      const take = left < this.n ? left : this.n;
      v |= (this.buf & ((1 << take) - 1)) << shift;
      this.buf >>= take;
      this.n -= take;
      shift += take;
      left -= take;
    }
    return v >>> 0;
  }

  align(): void {
    this.buf = 0;
    this.n = 0;
  }

  readByte(): number {
    if (this.n !== 0) this.align();
    if (this.i >= this.data.length) throw new Error('unexpected end of deflate stream');
    return this.data[this.i++]!;
  }

  readBytes(len: number): Uint8Array {
    if (this.n !== 0) this.align();
    if (this.i + len > this.data.length) throw new Error('unexpected end of deflate stream');
    const slice = this.data.subarray(this.i, this.i + len);
    this.i += len;
    return slice;
  }
}

class OutBuffer {
  private buf: Uint8Array;
  private len = 0;

  constructor(private readonly maxOut: number) {
    this.buf = new Uint8Array(this.maxOut < 8192 ? Math.max(0, this.maxOut) : 8192);
  }

  write(byte: number): void {
    if (this.len >= this.maxOut) throw new InflateLimitError(this.maxOut);
    if (this.len >= this.buf.length) this.grow(this.len + 1);
    this.buf[this.len++] = byte;
  }

  writeBytes(bytes: Uint8Array): void {
    const next = this.len + bytes.length;
    if (next > this.maxOut) throw new InflateLimitError(this.maxOut);
    if (next > this.buf.length) this.grow(next);
    this.buf.set(bytes, this.len);
    this.len = next;
  }

  copy(distance: number, length: number): void {
    if (distance === 0 || distance > this.len) throw new Error('invalid deflate distance');
    const next = this.len + length;
    if (next > this.maxOut) throw new InflateLimitError(this.maxOut);
    if (next > this.buf.length) this.grow(next);
    const start = this.len - distance;
    if (distance >= length) {
      this.buf.copyWithin(this.len, start, start + length);
    } else {
      for (let i = 0; i < length; i += 1) {
        this.buf[this.len + i] = this.buf[start + i]!;
      }
    }
    this.len = next;
  }

  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  private grow(needed: number): void {
    const limit = this.maxOut < MAX_TYPED_ARRAY ? this.maxOut : MAX_TYPED_ARRAY;
    let cap = this.buf.length === 0 ? 256 : this.buf.length;
    while (cap < needed) {
      const doubled = cap * 2;
      if (doubled <= cap || doubled > limit) {
        cap = limit;
        break;
      }
      cap = doubled;
    }
    if (cap > limit) cap = limit;
    if (cap < needed) throw new InflateLimitError(this.maxOut);
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a += data[i]!;
    if (a >= 65521) a -= 65521;
    b += a;
    if (b >= 65521) b -= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
