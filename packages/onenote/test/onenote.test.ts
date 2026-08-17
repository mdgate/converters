import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { onenote, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

const GUID_ONE_2010 = [
  0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3,
];

const GUID_ONETOC2 = [
  0xa1, 0x2f, 0xff, 0x43, 0xd9, 0xef, 0x76, 0x4c, 0x9e, 0xe2, 0x10, 0xea, 0x57, 0x22, 0x76, 0x5f,
];

describe('onenote', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = onenote();
    expect(converter.id).toBe('onenote');
    expect(converter.sniff(sampleOne('Meeting Notes', 'Hello from OneNote'))).toBe(2);
    expect(converter.sniff(sampleOneMagic('Notebook page body text'))).toBe(2);
    expect(converter.sniff(sampleGuid(GUID_ONETOC2, 'Table of contents page'))).toBe(2);
    expect(converter.sniff(enc.encode('{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.one' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'book.onetoc2' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'pack.onepkg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Notes.ONE' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(enc.encode('not a notebook'))).toBe(0);
  });

  it('converts a synthetic .one file to headings and paragraphs', async () => {
    const md = await toMarkdown(sampleOne('Meeting Notes', 'Hello from OneNote'), {
      path: 'notes.one',
    });
    expect(md).toContain('# Meeting Notes');
    expect(md).toContain('Hello from OneNote');
  });

  it('converts a .onepkg by converting inner .one members', async () => {
    const inner = sampleOne('Pack Title', 'Hello from package');
    const bytes = zipStore({ 'section.one': inner, '__MACOSX/._section.one': enc.encode('x') });
    const listed = await onenote().convert(bytes, { path: 'nb.onepkg' });
    expect(listed.markdown).toContain('section.one');
    expect(listed.markdown).not.toContain('__MACOSX');
    const md = await toMarkdown(bytes, { path: 'nb.onepkg' });
    expect(md).toContain('Pack Title');
    expect(md).toContain('Hello from package');
  });

  it('throws encrypted when the section is password protected', async () => {
    const bytes = sampleOne('Secret', 'this section is password protected');
    await expect(toMarkdown(bytes, { path: 'secret.one' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'encrypted',
    });
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.one' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => onenote().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() =>
      onenote().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
    expect(() => onenote().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
    const office = zipStore({ 'word/document.xml': enc.encode('<w:document/>') });
    await expect(toMarkdown(office, { path: 'x.one' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });
});

function sampleOne(title: string, body: string): Uint8Array {
  return concat(
    Uint8Array.from(GUID_ONE_2010),
    new Uint8Array(8),
    encodeUtf16le(title),
    new Uint8Array(8),
    encodeUtf16le(body),
  );
}

function sampleGuid(guid: number[], text: string): Uint8Array {
  return concat(Uint8Array.from(guid), new Uint8Array(8), encodeUtf16le(text));
}

function sampleOneMagic(text: string): Uint8Array {
  return concat(enc.encode('ONE '), new Uint8Array(4), encodeUtf16le(text));
}

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function zipStore(files: Record<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameB = encoder.encode(name);
    const local = new Uint8Array(30 + nameB.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    local.set(data, 30 + nameB.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameB.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameB, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, locals.length, true);
  ev.setUint16(10, locals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + eocd.length);
  let w = 0;
  for (const chunk of locals) {
    out.set(chunk, w);
    w += chunk.length;
  }
  for (const chunk of centrals) {
    out.set(chunk, w);
    w += chunk.length;
  }
  out.set(eocd, w);
  return out;
}
