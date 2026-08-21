/** Official PDF mapping tables. Zlib bytes, Z85-encoded so the JS source stays dense. */

import { inflateZlib } from '@mdgate/utils';
import { PDF_MAPS_PAD, PDF_MAPS_Z85 } from './generated/maps-data.js';

export type UniKind = 'utf8' | 'utf16' | 'utf32';

export interface EncPacked {
  s?: number[];
  r?: number[];
  b?: string;
}

export interface AdobeBlob {
  flat: Uint8Array;
  extra: number[];
}

export interface PdfMaps {
  cjkFrom: Uint32Array;
  cjkTo: Uint32Array;
  adobe: Record<string, AdobeBlob>;
  glyphListText: string;
  enc: Record<string, EncPacked>;
  uni: Record<string, UniKind>;
}

let parsed: PdfMaps | undefined;

const Z85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';

const Z85_DEC = new Int16Array(128).fill(-1);
for (let i = 0; i < 85; i += 1) Z85_DEC[Z85.charCodeAt(i)] = i;

export function decodeZ85(src: string, pad: number): Uint8Array {
  if (src.length % 5 !== 0) throw new Error('invalid PDF maps encoding');
  const out = new Uint8Array((src.length / 5) * 4);
  const view = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < src.length; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j += 1) {
      const code = src.charCodeAt(i + j);
      const v = code < 128 ? Z85_DEC[code]! : -1;
      if (v < 0) throw new Error('invalid PDF maps encoding');
      n = n * 85 + v;
    }
    view.setUint32(o, n);
    o += 4;
  }
  return pad > 0 ? out.subarray(0, out.length - pad) : out;
}

export function pdfMaps(): PdfMaps {
  if (parsed) return parsed;
  parsed = parseMaps(inflateZlib(decodeZ85(PDF_MAPS_Z85, PDF_MAPS_PAD), 2 << 20));
  return parsed;
}

function parseMaps(data: Uint8Array): PdfMaps {
  if (data.length < 4 || ascii(data, 0, 4) !== 'MDG1') {
    throw new Error('invalid PDF maps');
  }
  const sections = new Map<string, Uint8Array>();
  let i = 4;
  while (i + 8 <= data.length) {
    const tag = ascii(data, i, 4);
    const len = u32(data, i + 4);
    i += 8;
    sections.set(tag, data.subarray(i, i + len));
    i += len;
  }
  const cjk = sections.get('CJK1');
  const cid = sections.get('CID1');
  const agl = sections.get('AGL1');
  const enc = sections.get('ENC1');
  if (!cjk || !cid || !agl || !enc) throw new Error('incomplete PDF maps');
  return {
    ...parseCjk(cjk),
    adobe: parseAdobe(cid),
    glyphListText: latin1(agl),
    ...parseEnc(enc),
  };
}

function parseCjk(buf: Uint8Array): { cjkFrom: Uint32Array; cjkTo: Uint32Array } {
  const n = u32(buf, 0);
  const from = new Uint32Array(n);
  const to = new Uint32Array(n);
  let o = 4;
  for (let i = 0; i < n; i += 1) {
    from[i] = u32(buf, o);
    to[i] = u32(buf, o + 4);
    o += 8;
  }
  return { cjkFrom: from, cjkTo: to };
}

function parseAdobe(buf: Uint8Array): Record<string, AdobeBlob> {
  const n = buf[0]!;
  let o = 1;
  const out: Record<string, AdobeBlob> = {};
  for (let i = 0; i < n; i += 1) {
    const nl = buf[o]!;
    o += 1;
    const name = ascii(buf, o, nl);
    o += nl;
    const fl = u32(buf, o);
    o += 4;
    const flat = buf.subarray(o, o + fl);
    o += fl;
    const ne = u16(buf, o);
    o += 2;
    const extra: number[] = [];
    for (let j = 0; j < ne; j += 1) {
      extra.push(u16(buf, o), u32(buf, o + 2));
      o += 6;
    }
    out[name] = { flat, extra };
  }
  return out;
}

function parseEnc(buf: Uint8Array): {
  enc: Record<string, EncPacked>;
  uni: Record<string, UniKind>;
} {
  let o = 0;
  const nNames = u16(buf, o);
  const nameBlobLen = u16(buf, o + 2);
  o += 4;
  const names = latin1(buf.subarray(o, o + nameBlobLen)).split('\0');
  o += nameBlobLen;
  if (names.length !== nNames) {
    // trailing empty from join
  }
  const nUni = u16(buf, o);
  const uniLen = u16(buf, o + 2);
  o += 4;
  const uni: Record<string, UniKind> = {};
  const uniBlob = latin1(buf.subarray(o, o + uniLen));
  o += uniLen;
  if (uniBlob.length > 0) {
    for (const item of uniBlob.split('\0')) {
      const eq = item.indexOf('=');
      if (eq > 0) uni[item.slice(0, eq)] = item.slice(eq + 1) as UniKind;
    }
  }
  void nUni;
  const enc: Record<string, EncPacked> = {};
  for (const name of names) {
    if (!name) continue;
    const flags = buf[o]!;
    o += 1;
    const packed: EncPacked = {};
    if (flags & 1) {
      packed.b = names[u16(buf, o)];
      o += 2;
    }
    const ns = u16(buf, o);
    o += 2;
    if (ns > 0) {
      const s: number[] = [];
      for (let i = 0; i < ns; i += 1) {
        s.push(u32(buf, o), u32(buf, o + 4), buf[o + 8]!);
        o += 9;
      }
      packed.s = s;
    }
    const nr = u32(buf, o);
    o += 4;
    if (nr > 0) {
      const r: number[] = [];
      for (let i = 0; i < nr; i += 1) {
        r.push(u32(buf, o), u32(buf, o + 4), u16(buf, o + 8));
        o += 10;
      }
      packed.r = r;
    }
    enc[name] = packed;
  }
  return { enc, uni };
}

function u16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}

function u32(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

function ascii(b: Uint8Array, i: number, n: number): string {
  let s = '';
  for (let k = 0; k < n; k += 1) s += String.fromCharCode(b[i + k]!);
  return s;
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}
