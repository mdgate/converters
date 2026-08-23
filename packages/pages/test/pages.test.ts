import { describe, expect, it } from 'vitest';
import { samplePages, zipStore } from '../../iwork-common/test/fixtures.js';
import { pages, toMarkdown } from '../src/index.js';

describe('pages', () => {
  it('sniffs synthetic pages bytes', () => {
    const bytes = samplePages('Hello from Pages');
    expect(pages().sniff(bytes)).toBe(2);
    expect(pages().sniff(new Uint8Array([1, 2, 3]), { path: 'x.pages' })).toBe(1);
  });

  it('converts body text to markdown', async () => {
    const md = await toMarkdown(samplePages('Hello from Pages'), { path: 'note.pages' });
    expect(md).toContain('Hello from Pages');
  });

  it('sniffs and converts a pre-IWA index.xml package', async () => {
    const bytes = zipStore({
      'index.xml': new TextEncoder().encode(`<?xml version="1.0"?>
<sl:document xmlns:sl="http://developer.apple.com/namespaces/sl" xmlns:sf="http://developer.apple.com/namespaces/sf">
  <sf:p><sf:text>Hello from Pages 09</sf:text></sf:p>
</sl:document>`),
    });
    expect(pages().sniff(bytes, { path: 'note.pages' })).toBe(2);
    const md = await toMarkdown(bytes, { path: 'note.pages' });
    expect(md).toContain('Hello from Pages 09');
  });

  it('throws encrypted for Apple zip methods', async () => {
    const bytes = zipWithMethod({ 'Index/Document.iwa': 'x' }, 0x636b);
    expect(pages().sniff(bytes)).toBe(2);
    await expect(toMarkdown(bytes, { path: 'secret.pages' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'encrypted',
    });
  });
});

function zipWithMethod(files: Record<string, string>, method: number): Uint8Array {
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
    lv.setUint16(8, method, true);
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
    cv.setUint16(10, method, true);
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
