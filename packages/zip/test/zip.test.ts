import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { toMarkdown, zip } from '../src/index.js';

const enc = new TextEncoder();

describe('zip', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = zip();
    expect(converter.id).toBe('zip');
    const generic = zipStore({ 'hello.txt': 'hi' });
    expect(converter.sniff(generic)).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.zip' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.zipx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'lib.jar' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    const office = zipStore({ 'word/document.xml': '<w:document/>' });
    expect(converter.sniff(office)).toBe(0);
    expect(converter.sniff(office, { path: 'pack.zip' })).toBe(0);
  });

  it('lists members when convert is missing', async () => {
    const bytes = zipStore({
      'notes.txt': 'hello',
      'dir/': '',
      '__MACOSX/._notes.txt': 'apple',
      'keep/file.csv': 'a,b',
    });
    const result = await zip().convert(bytes);
    expect(result.markdown).toBe('- notes.txt\n- keep/file.csv\n');
  });

  it('converts each member under a heading and isolates failures', async () => {
    const bytes = zipStore({
      'notes.txt': 'hello',
      'bad.bin': 'nope',
    });
    const result = await zip().convert(bytes, {
      convert: async (member, hint) => {
        if (hint?.path === 'bad.bin') throw new Error('boom');
        return `${new TextDecoder().decode(member)}\n`;
      },
    });
    expect(result.markdown).toBe(
      '## notes.txt\n\nhello\n\n## bad.bin\n\ncould not convert: boom\n',
    );
  });

  it('refuses a PDF/office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.zip' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => zip().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    const office = zipStore({ 'word/document.xml': '<w:document/>' });
    await expect(toMarkdown(office, { path: 'x.zip' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });

  it('throws encrypted when zip entries are encrypted', async () => {
    const bytes = zipStore({ 'secret.txt': 'x' }, 1);
    await expect(zip().convert(bytes, { convert: async () => 'ok' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'encrypted',
    });
  });
});

function zipStore(files: Record<string, string>, flags = 0): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = encoder.encode(name);
    const data = encoder.encode(text);
    const local = new Uint8Array(30 + nameB.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
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
    cv.setUint16(8, flags, true);
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
