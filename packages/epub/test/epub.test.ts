import { describe, expect, it } from 'vitest';
import { epub, toMarkdown } from '../src/index.js';

describe('epub', () => {
  it('sniffs EPUB and iBooks packages', () => {
    const converter = epub();
    expect(converter.id).toBe('epub');
    expect(converter.sniff(book('application/epub+zip'))).toBe(2);
    expect(converter.sniff(book('application/x-ibooks+zip'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tiny.epub' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'testiBooks.ibooks' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
  });

  it('converts EPUB and iBooks XHTML spine text', async () => {
    const expected = '# Hello\n\nchapter\n';
    await expect(toMarkdown(book('application/epub+zip'))).resolves.toBe(expected);
    await expect(toMarkdown(book('application/x-ibooks+zip'), { path: 'n.ibooks' })).resolves.toBe(
      expected,
    );
  });
});

function book(mimetype: string): Uint8Array {
  return zipStore({
    mimetype,
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    'EPUB/content.opf': `<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:1</dc:identifier>
    <dc:title>Hello</dc:title>
  </metadata>
  <manifest>
    <item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch"/>
  </spine>
</package>`,
    'EPUB/ch.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>chapter</p></body></html>',
  });
}

function zipStore(files: Record<string, string>): Uint8Array {
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
