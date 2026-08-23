import { describe, expect, it } from 'vitest';
import { doc, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

describe('doc', () => {
  it('does not claim Graphviz .dot by path', () => {
    const converter = doc();
    expect(converter.id).toBe('doc');
    expect(converter.sniff(enc.encode('digraph { a -> b; }'), { path: 'g.dot' })).toBe(0);
    expect(converter.sniff(enc.encode('// c\ngraph { a -- b; }'), { path: 'g.dot' })).toBe(0);
    expect(
      converter.sniff(enc.encode('/* c */\ndigraph tika {\n  a -> b;\n}\n'), {
        path: 'testGRAPHVIZdc.dot',
      }),
    ).toBe(0);
    expect(converter.sniff(enc.encode('x'), { path: 'letter.doc' })).toBe(1);
    expect(converter.sniff(enc.encode('{\\rtf1'), { path: 'letter.doc' })).toBe(0);
    expect(converter.sniff(enc.encode('x'), { path: 'letter.dot' })).toBe(0);
  });

  it('converts a Word 6 FIB into paragraphs', async () => {
    const bytes = word6Ole('Hello Word 6\rSecond line\r');
    expect(doc().sniff(bytes)).toBe(2);
    const md = await toMarkdown(bytes, { path: 'old.doc' });
    expect(md).toContain('Hello Word 6');
    expect(md).toContain('Second line');
  });
});

const SECTOR = 512;
const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

function word6Ole(text: string): Uint8Array {
  const word = new Uint8Array(256);
  const dv = new DataView(word.buffer);
  dv.setUint16(0, 0xa5dc, true);
  dv.setUint16(2, 0x65, true);
  dv.setUint16(6, 0x0409, true);
  const body = enc.encode(text);
  const fcMin = 0x80;
  dv.setUint32(0x18, fcMin, true);
  dv.setUint32(0x1c, fcMin + body.length, true);
  word.set(body, fcMin);
  return oleWithStreams([{ name: 'WordDocument', data: word }]);
}

function oleWithStreams(streams: { name: string; data: Uint8Array }[]): Uint8Array {
  const dataStart = 2;
  const sectorCount = dataStart + streams.length;
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
  dv.setUint32(0x38, 1, true);
  dv.setUint32(0x3c, ENDOFCHAIN, true);
  dv.setUint32(0x44, ENDOFCHAIN, true);
  dv.setUint32(0x4c, 0, true);
  for (let i = 1; i < 109; i += 1) dv.setUint32(0x4c + i * 4, FREESECT, true);

  const fatOff = SECTOR;
  for (let i = 0; i < 128; i += 1) dv.setUint32(fatOff + i * 4, ENDOFCHAIN, true);
  dv.setUint32(fatOff, FATSECT, true);
  dv.setUint32(fatOff + 4, ENDOFCHAIN, true);
  for (let i = 0; i < streams.length; i += 1) {
    dv.setUint32(fatOff + (dataStart + i) * 4, ENDOFCHAIN, true);
  }

  writeDirEntry(bytes, SECTOR * 2, {
    name: 'Root Entry',
    type: 5,
    child: streams.length > 0 ? 1 : NOSTREAM,
    start: ENDOFCHAIN,
    size: 0,
    left: NOSTREAM,
    right: NOSTREAM,
  });
  for (let i = 0; i < streams.length; i += 1) {
    const stream = streams[i]!;
    writeDirEntry(bytes, SECTOR * 2 + 128 * (i + 1), {
      name: stream.name,
      type: 2,
      child: NOSTREAM,
      start: dataStart + i,
      size: stream.data.length,
      left: NOSTREAM,
      right: i + 2 < streams.length + 1 ? i + 2 : NOSTREAM,
    });
    bytes.set(stream.data, SECTOR * (dataStart + i + 1));
  }
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
