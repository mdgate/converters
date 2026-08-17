import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { toMarkdown, wps } from '../src/index.js';

const enc = new TextEncoder();

describe('wps', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = wps();
    expect(converter.id).toBe('wps');
    expect(converter.sniff(kingsoftZip('Hello from WPS'))).toBe(2);
    expect(converter.sniff(enc.encode('xxxx application/vnd.kingsoft.wps yyyy'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.wps' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tpl.wpt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.et' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.ett' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'deck.dps' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'deck.dpt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(tinyDocx('Office wins'))).toBe(0);
    expect(converter.sniff(tinyDocx('Office wins'), { path: 'note.wps' })).toBe(0);
  });

  it('converts proprietary Kingsoft text to markdown', async () => {
    await expect(toMarkdown(kingsoftZip('Hello from WPS'))).resolves.toContain('Hello from WPS');
  });

  it('handles a tiny docx-like .wps file', async () => {
    const bytes = tinyDocx('Hello WPS');
    const score = wps().sniff(bytes, { path: 'note.wps' });
    if (score === 0) {
      const result = await Promise.resolve(wps().convert(bytes, { path: 'note.wps' }));
      expect(result.markdown).toContain('Hello WPS');
    } else {
      expect(score).toBeGreaterThanOrEqual(1);
      await expect(toMarkdown(bytes, { path: 'note.wps' })).resolves.toContain('Hello WPS');
    }
  });

  it('refuses a PDF', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.wps' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => wps().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
  });
});

function kingsoftZip(text: string): Uint8Array {
  return zipStore({
    mimetype: enc.encode('application/vnd.kingsoft-office.wps'),
    'KSDocument.xml': enc.encode(`<document><p>${text}</p></document>`),
  });
}

function tinyDocx(text: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`;
  return zipStore({ 'word/document.xml': enc.encode(xml) });
}

function zipStore(files: Record<string, Uint8Array>): Uint8Array {
  const locals: number[] = [];
  const centrals: number[] = [];
  let offset = 0;
  const entries: { name: string; data: Uint8Array; localOffset: number }[] = [];

  for (const [name, data] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    entries.push({ name, data, localOffset: offset });
    writeU32(locals, 0x04034b50);
    writeU16(locals, 20);
    writeU16(locals, 0);
    writeU16(locals, 0);
    writeU16(locals, 0);
    writeU16(locals, 0);
    writeU32(locals, crc32(data));
    writeU32(locals, data.length);
    writeU32(locals, data.length);
    writeU16(locals, nameBytes.length);
    writeU16(locals, 0);
    for (const b of nameBytes) locals.push(b);
    for (const b of data) locals.push(b);
    offset = locals.length;
  }

  const cdOffset = locals.length;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    writeU32(centrals, 0x02014b50);
    writeU16(centrals, 20);
    writeU16(centrals, 20);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU32(centrals, crc32(e.data));
    writeU32(centrals, e.data.length);
    writeU32(centrals, e.data.length);
    writeU16(centrals, nameBytes.length);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU16(centrals, 0);
    writeU32(centrals, 0);
    writeU32(centrals, e.localOffset);
    for (const b of nameBytes) centrals.push(b);
  }

  const out = [...locals, ...centrals];
  writeU32(out, 0x06054b50);
  writeU16(out, 0);
  writeU16(out, 0);
  writeU16(out, entries.length);
  writeU16(out, entries.length);
  writeU32(out, centrals.length);
  writeU32(out, cdOffset);
  writeU16(out, 0);
  return Uint8Array.from(out);
}

function writeU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

function writeU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

const CRC_TABLE = (() => {
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
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
