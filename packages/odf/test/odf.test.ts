import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { odf, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();
const FIXTURE_SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixture-src');

const FLAT_TEXT = `<?xml version="1.0"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">Hello Flat</text:h>
      <text:p>A paragraph.</text:p>
    </office:text>
  </office:body>
</office:document>`;

const FLAT_DRAWING = `<?xml version="1.0"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
  <office:body>
    <office:drawing>
      <draw:page>
        <draw:frame>
          <draw:text-box>
            <text:h text:outline-level="1">Drawing Title</text:h>
            <text:p>Shape text.</text:p>
          </draw:text-box>
        </draw:frame>
      </draw:page>
    </office:drawing>
  </office:body>
</office:document>`;

describe('odf', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = odf();
    expect(converter.id).toBe('odf');
    expect(converter.sniff(enc.encode(FLAT_TEXT))).toBe(2);
    expect(
      converter.sniff(
        enc.encode(
          '<?xml version="1.0"?><root xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></root>',
        ),
      ),
    ).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'pic.odg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.fodt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tmpl.ott' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.ots' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'old.sxw' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'slides.sxi' })).toBe(1);
    expect(converter.sniff(starOfficeWriter('Example Text'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
  });

  it('converts flat text and drawing XML', async () => {
    await expect(toMarkdown(enc.encode(FLAT_TEXT))).resolves.toBe('# Hello Flat\n\nA paragraph.\n');
    const drawing = await toMarkdown(enc.encode(FLAT_DRAWING), { path: 'sketch.fodg' });
    expect(drawing).toContain('# Drawing Title');
    expect(drawing).toContain('Shape text.');

    const fodt = readFileSync(join(FIXTURE_SRC, 'text.fodt'));
    const fromFixture = await toMarkdown(fodt, { path: 'text.fodt' });
    expect(fromFixture).toContain('# Fixture Document');
    expect(fromFixture).toContain('Plain paragraph');
  });

  it('refuses a PDF', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.odt' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => odf().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
  });

  it('converts a StarOffice 6 writer package', async () => {
    const md = await toMarkdown(starOfficeWriter('Example Text'), { path: 'note.sxw' });
    expect(md).toContain('# Heading 1');
    expect(md).toContain('Example Text');
  });
});

function starOfficeWriter(text: string): Uint8Array {
  return zipStore({
    'META-INF/manifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest">
  <manifest:file-entry manifest:media-type="application/vnd.sun.xml.writer" manifest:full-path="/"/>
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>
</manifest:manifest>`,
    'content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="http://openoffice.org/2000/office"
    xmlns:text="http://openoffice.org/2000/text">
  <office:body>
    <text:h text:style-name="Heading 1">Heading 1</text:h>
    <text:p>${text}</text:p>
  </office:body>
</office:document-content>`,
  });
}

function zipStore(files: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
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
