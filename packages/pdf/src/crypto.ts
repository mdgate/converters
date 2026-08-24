/** MD5, RC4, and AES-128-CBC for PDF Standard security. */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) MD5_K[i] = Math.floor(2 ** 32 * Math.abs(Math.sin(i + 1)));

export function md5(data: Uint8Array): Uint8Array {
  const n = data.length;
  const bit = n * 8;
  const padded = ((n + 8) >>> 6) + 1;
  const words = new Uint32Array(padded * 16);
  for (let i = 0; i < n; i += 1) words[i >> 2]! |= data[i]! << ((i % 4) * 8);
  words[n >> 2]! |= 0x80 << ((n % 4) * 8);
  words[padded * 16 - 2] = bit;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const w = new Uint32Array(16);
  for (let i = 0; i < words.length; i += 16) {
    for (let j = 0; j < 16; j += 1) w[j] = words[i + j]!;
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let j = 0; j < 64; j += 1) {
      let f: number;
      let g: number;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }
      const sum = (a + f + MD5_K[j]! + w[g]!) >>> 0;
      const rot = MD5_S[j]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << rot) | (sum >>> (32 - rot)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const regs = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i += 1) {
    out[i * 4] = regs[i]! & 0xff;
    out[i * 4 + 1] = (regs[i]! >>> 8) & 0xff;
    out[i * 4 + 2] = (regs[i]! >>> 16) & 0xff;
    out[i * 4 + 3] = (regs[i]! >>> 24) & 0xff;
  }
  return out;
}

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < data.length; i += 1) {
    x = (x + 1) & 255;
    y = (y + s[x]!) & 255;
    const t = s[x]!;
    s[x] = s[y]!;
    s[y] = t;
    out[i] = data[i]! ^ s[(s[x]! + s[y]!) & 255]!;
  }
  return out;
}

const SBOX = new Uint8Array([
  99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118, 202, 130, 201, 125,
  250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192, 183, 253, 147, 38, 54, 63, 247, 204, 52,
  165, 229, 241, 113, 216, 49, 21, 4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178,
  117, 9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132, 83, 209, 0, 237, 32,
  252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207, 208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2,
  127, 80, 60, 159, 168, 81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
  205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115, 96, 129, 79, 220, 34, 42,
  144, 136, 70, 238, 184, 20, 222, 94, 11, 219, 224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98,
  145, 149, 228, 121, 231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
  186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138, 112, 62, 181, 102, 72,
  3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158, 225, 248, 152, 17, 105, 217, 142, 148, 155, 30,
  135, 233, 206, 85, 40, 223, 140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187,
  22,
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) INV_SBOX[SBOX[i]!] = i;

function expandAes128(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(176);
  w.set(key.subarray(0, 16));
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let a = w[i - 4]!;
    let b = w[i - 3]!;
    let c = w[i - 2]!;
    let d = w[i - 1]!;
    if (i % 16 === 0) {
      const t = a;
      a = SBOX[b]! ^ rcon;
      b = SBOX[c]!;
      c = SBOX[d]!;
      d = SBOX[t]!;
      rcon = xtime(rcon);
    }
    w[i] = w[i - 16]! ^ a;
    w[i + 1] = w[i - 15]! ^ b;
    w[i + 2] = w[i - 14]! ^ c;
    w[i + 3] = w[i - 13]! ^ d;
  }
  return w;
}

function xtime(a: number): number {
  return ((a << 1) ^ ((a >> 7) * 0x1b)) & 0xff;
}

function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i += 1) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function addRoundKey(s: Uint8Array, keys: Uint8Array, round: number): void {
  const o = round * 16;
  for (let i = 0; i < 16; i += 1) s[i] ^= keys[o + i]!;
}

function invSubBytes(s: Uint8Array): void {
  for (let i = 0; i < 16; i += 1) s[i] = INV_SBOX[s[i]!]!;
}

function invShiftRows(s: Uint8Array): void {
  let t = s[13]!;
  s[13] = s[9]!;
  s[9] = s[5]!;
  s[5] = s[1]!;
  s[1] = t;
  t = s[2]!;
  s[2] = s[10]!;
  s[10] = t;
  t = s[6]!;
  s[6] = s[14]!;
  s[14] = t;
  t = s[3]!;
  s[3] = s[7]!;
  s[7] = s[11]!;
  s[11] = s[15]!;
  s[15] = t;
}

function invMixColumns(s: Uint8Array): void {
  for (let i = 0; i < 4; i += 1) {
    const o = i * 4;
    const a = s[o]!;
    const b = s[o + 1]!;
    const c = s[o + 2]!;
    const d = s[o + 3]!;
    s[o] = gmul(a, 14) ^ gmul(b, 11) ^ gmul(c, 13) ^ gmul(d, 9);
    s[o + 1] = gmul(a, 9) ^ gmul(b, 14) ^ gmul(c, 11) ^ gmul(d, 13);
    s[o + 2] = gmul(a, 13) ^ gmul(b, 9) ^ gmul(c, 14) ^ gmul(d, 11);
    s[o + 3] = gmul(a, 11) ^ gmul(b, 13) ^ gmul(c, 9) ^ gmul(d, 14);
  }
}

function aesDecryptBlock(keys: Uint8Array, block: Uint8Array, out: Uint8Array): void {
  const s = new Uint8Array(16);
  s.set(block);
  addRoundKey(s, keys, 10);
  for (let r = 9; r >= 1; r -= 1) {
    invShiftRows(s);
    invSubBytes(s);
    addRoundKey(s, keys, r);
    invMixColumns(s);
  }
  invShiftRows(s);
  invSubBytes(s);
  addRoundKey(s, keys, 0);
  out.set(s);
}

export function aes128CbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length < 16 || data.length < 16 || data.length % 16 !== 0) {
    throw new Error('invalid AES payload');
  }
  const keys = expandAes128(key.subarray(0, 16));
  const out = new Uint8Array(data.length);
  const prev = new Uint8Array(16);
  prev.set(iv.subarray(0, 16));
  const block = new Uint8Array(16);
  for (let i = 0; i < data.length; i += 16) {
    const slice = data.subarray(i, i + 16);
    aesDecryptBlock(keys, slice, block);
    for (let j = 0; j < 16; j += 1) out[i + j] = block[j]! ^ prev[j]!;
    prev.set(slice);
  }
  const pad = out[out.length - 1]!;
  if (pad < 1 || pad > 16) return out;
  for (let i = out.length - pad; i < out.length; i += 1) {
    if (out[i] !== pad) return out;
  }
  return out.subarray(0, out.length - pad);
}
