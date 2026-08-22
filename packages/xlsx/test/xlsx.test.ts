import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { xlsx } from '../src/index.js';

describe('xlsx', () => {
  it('throws encrypted for XOR FILEPASS (wEncryptionType 0)', () => {
    const bytes = oleWorkbook(filepassXor());
    expect(xlsx().sniff(bytes)).toBe(2);
    expect(() => xlsx().convert(bytes)).toThrow(ConvertError);
    try {
      xlsx().convert(bytes);
    } catch (e) {
      expect(e).toMatchObject({ name: 'ConvertError', code: 'encrypted' });
    }
  });

  it('throws encrypted for RC4 FILEPASS (wEncryptionType 1)', () => {
    const bytes = oleWorkbook(filepassRc4());
    expect(() => xlsx().convert(bytes)).toThrow(ConvertError);
    try {
      xlsx().convert(bytes);
    } catch (e) {
      expect(e).toMatchObject({ name: 'ConvertError', code: 'encrypted' });
    }
  });
});

function filepassXor(): Uint8Array {
  return concat(
    rec(0x0809, [0x00, 0x06, 0x05, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    rec(0x002f, [0x00, 0x00, 0x4a, 0x51, 0x1a, 0xcc]),
    rec(0x000a, []),
  );
}

function filepassRc4(): Uint8Array {
  return concat(
    rec(0x0809, [0x00, 0x06, 0x05, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    rec(0x002f, [0x01, 0x00, 0, 0, 0, 0]),
    rec(0x000a, []),
  );
}

function rec(typ: number, data: number[]): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  out[0] = typ & 0xff;
  out[1] = (typ >> 8) & 0xff;
  out[2] = data.length & 0xff;
  out[3] = (data.length >> 8) & 0xff;
  out.set(data, 4);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const SECTOR = 512;
const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

function oleWorkbook(payload: Uint8Array): Uint8Array {
  const dataSectors = Math.max(9, Math.ceil(Math.max(payload.length, 4096) / SECTOR));
  const dataStart = 2;
  const lastData = dataStart + dataSectors - 1;
  const sectorCount = lastData + 1;
  const bytes = new Uint8Array((sectorCount + 1) * SECTOR);
  const dv = new DataView(bytes.buffer);

  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  dv.setUint16(0x18, 0x003e, true);
  dv.setUint16(0x1a, 0x0003, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, 9, true);
  dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, 1, true);
  dv.setUint32(0x30, 1, true);
  dv.setUint32(0x38, 4096, true);
  dv.setUint32(0x3c, ENDOFCHAIN, true);
  dv.setUint32(0x44, ENDOFCHAIN, true);
  dv.setUint32(0x4c, 0, true);
  for (let i = 1; i < 109; i += 1) dv.setUint32(0x4c + i * 4, FREESECT, true);

  const fatOff = SECTOR;
  for (let i = 0; i < 128; i += 1) dv.setUint32(fatOff + i * 4, FREESECT, true);
  dv.setUint32(fatOff, FATSECT, true);
  dv.setUint32(fatOff + 4, ENDOFCHAIN, true);
  for (let s = dataStart; s < lastData; s += 1) dv.setUint32(fatOff + s * 4, s + 1, true);
  dv.setUint32(fatOff + lastData * 4, ENDOFCHAIN, true);

  writeDirEntry(bytes, SECTOR * 2, {
    name: 'Root Entry',
    type: 5,
    child: 1,
    start: ENDOFCHAIN,
    size: 0,
    left: NOSTREAM,
    right: NOSTREAM,
  });
  writeDirEntry(bytes, SECTOR * 2 + 128, {
    name: 'Workbook',
    type: 2,
    child: NOSTREAM,
    start: dataStart,
    size: dataSectors * SECTOR,
    left: NOSTREAM,
    right: NOSTREAM,
  });
  bytes.set(payload, SECTOR * (dataStart + 1));
  return bytes;
}

function writeDirEntry(
  bytes: Uint8Array,
  off: number,
  entry: {
    name: string;
    type: number;
    child: number;
    start: number;
    size: number;
    left: number;
    right: number;
  },
): void {
  const dv = new DataView(bytes.buffer, off, 128);
  for (let i = 0; i < entry.name.length; i += 1) {
    dv.setUint16(i * 2, entry.name.charCodeAt(i), true);
  }
  dv.setUint16(64, entry.name.length * 2 + 2, true);
  bytes[off + 66] = entry.type;
  bytes[off + 67] = 1;
  dv.setUint32(68, entry.left, true);
  dv.setUint32(72, entry.right, true);
  dv.setUint32(76, entry.child, true);
  dv.setUint32(116, entry.start, true);
  dv.setUint32(120, entry.size, true);
}
