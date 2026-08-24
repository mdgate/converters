import { aes128CbcDecrypt, md5, rc4 } from './crypto.js';

const PAD = Uint8Array.of(
  0x28,
  0xbf,
  0x4e,
  0x5e,
  0x4e,
  0x75,
  0x8a,
  0x41,
  0x64,
  0x00,
  0x4e,
  0x56,
  0xff,
  0xfa,
  0x01,
  0x08,
  0x2e,
  0x2e,
  0x00,
  0xb6,
  0xd0,
  0x68,
  0x3e,
  0x80,
  0x2f,
  0x0c,
  0xa9,
  0xfe,
  0x64,
  0x53,
  0x69,
  0x7a,
);

export type CryptMethod = 'none' | 'rc4' | 'aesv2';

export interface FileCrypt {
  key: Uint8Array;
  stm: CryptMethod;
  str: CryptMethod;
}

export interface EncryptParams {
  v: number;
  r: number;
  keyLength: number;
  o: Uint8Array;
  u: Uint8Array;
  p: number;
  id: Uint8Array;
  stmF: string;
  strF: string;
  cfm: string;
  encryptMetadata: boolean;
}

function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(PAD);
  if (password.length > 0) out.set(password.subarray(0, 32), 0);
  if (password.length < 32) out.set(PAD.subarray(0, 32 - password.length), password.length);
  return out;
}

function pBytes(p: number): Uint8Array {
  const u = p >>> 0;
  return Uint8Array.of(u & 255, (u >>> 8) & 255, (u >>> 16) & 255, (u >>> 24) & 255);
}

function fileKey(params: EncryptParams, password: Uint8Array): Uint8Array {
  const n = Math.max(5, Math.min(16, Math.floor(params.keyLength / 8) || 16));
  const extra = params.r >= 4 && !params.encryptMetadata ? 4 : 0;
  const buf = new Uint8Array(32 + 32 + 4 + params.id.length + extra);
  buf.set(padPassword(password), 0);
  buf.set(params.o.subarray(0, 32), 32);
  buf.set(pBytes(params.p), 64);
  buf.set(params.id, 68);
  if (extra) buf.fill(0xff, 68 + params.id.length);
  let hash = md5(buf);
  if (params.r >= 3) {
    const slice = new Uint8Array(n);
    for (let i = 0; i < 50; i += 1) {
      slice.set(hash.subarray(0, n));
      hash = md5(slice);
    }
  }
  return hash.subarray(0, n);
}

function equal16(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length < 16 || b.length < 16) return false;
  let d = 0;
  for (let i = 0; i < 16; i += 1) d |= a[i]! ^ b[i]!;
  return d === 0;
}

function computeU(params: EncryptParams, key: Uint8Array): Uint8Array {
  if (params.r <= 2) return rc4(key, PAD);
  const hash = md5(concat(PAD, params.id));
  let out = rc4(key, hash);
  const xorKey = new Uint8Array(key.length);
  for (let i = 1; i <= 19; i += 1) {
    for (let j = 0; j < key.length; j += 1) xorKey[j] = key[j]! ^ i;
    out = rc4(xorKey, out);
  }
  const u = new Uint8Array(32);
  u.set(out.subarray(0, 16));
  u.set(PAD.subarray(0, 16), 16);
  return u;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function methodOf(name: string): CryptMethod {
  const n = name.replace(/^\//, '').toLowerCase();
  if (n === '' || n === 'identity') return 'none';
  if (n === 'aesv2' || n === 'aesv3') return n === 'aesv3' ? 'aesv2' : 'aesv2';
  if (n === 'v2' || n === 'rc4') return 'rc4';
  return 'rc4';
}

function cryptForFilter(filterName: string, cfm: string): CryptMethod {
  const n = filterName.replace(/^\//, '').toLowerCase();
  if (n === 'identity') return 'none';
  return methodOf(cfm || filterName);
}

export function openEncrypt(params: EncryptParams): FileCrypt | undefined {
  const stm = cryptForFilter(params.stmF, params.cfm);
  const str = cryptForFilter(params.strF, params.cfm);
  if (stm === 'none' && str === 'none') {
    return { key: new Uint8Array(), stm, str };
  }
  if (params.r >= 5) return undefined;
  const key = fileKey(params, new Uint8Array());
  const u = computeU(params, key);
  if (!equal16(u, params.u)) return undefined;
  return { key, stm, str };
}

function objectKey(crypt: FileCrypt, num: number, gen: number, aes: boolean): Uint8Array {
  const extra = aes ? 9 : 5;
  const buf = new Uint8Array(crypt.key.length + extra);
  buf.set(crypt.key);
  const o = crypt.key.length;
  buf[o] = num & 255;
  buf[o + 1] = (num >>> 8) & 255;
  buf[o + 2] = (num >>> 16) & 255;
  buf[o + 3] = gen & 255;
  buf[o + 4] = (gen >>> 8) & 255;
  if (aes) {
    buf[o + 5] = 0x73;
    buf[o + 6] = 0x41;
    buf[o + 7] = 0x6c;
    buf[o + 8] = 0x54;
  }
  const hash = md5(buf);
  const n = Math.min(crypt.key.length + 5, 16);
  return hash.subarray(0, n);
}

export function decryptBytes(
  crypt: FileCrypt,
  num: number,
  gen: number,
  data: Uint8Array,
  kind: 'stm' | 'str',
): Uint8Array {
  const method = kind === 'stm' ? crypt.stm : crypt.str;
  if (method === 'none' || data.length === 0) return data;
  if (method === 'rc4') return rc4(objectKey(crypt, num, gen, false), data);
  if (data.length < 16) return data;
  try {
    return aes128CbcDecrypt(
      objectKey(crypt, num, gen, true),
      data.subarray(0, 16),
      data.subarray(16),
    );
  } catch {
    return data;
  }
}
