import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { toMarkdown, visio } from '../src/index.js';

const enc = new TextEncoder();

const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PAGE_REL = 'http://schemas.microsoft.com/visio/2010/relationships/page';
const PAGES_REL = 'http://schemas.microsoft.com/visio/2010/relationships/pages';
const OFFICE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

describe('visio', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = visio();
    expect(converter.id).toBe('visio');
    expect(converter.sniff(tinyVsdx())).toBe(2);
    expect(converter.sniff(oleStream('VisioDocument', utf16le('Hello from Visio')))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'drawing.vsd' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'drawing.vsdx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'stencil.vss' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'template.vst' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'stencil.vssx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'template.vstx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Drawing.VSDX' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(tinyDocx('Office wins'))).toBe(0);
    expect(converter.sniff(tinyDocx('Office wins'), { path: 'drawing.vsdx' })).toBe(0);
    expect(converter.sniff(oleStream('WordDocument', utf16le('Word')))).toBe(0);
  });

  it('converts vsdx page names and shape text in reading order', async () => {
    const md = await toMarkdown(tinyVsdx(), { path: 'flow.vsdx' });
    expect(md).toBe(
      '# Overview\n\nStart here\n\nDecision\n\nBlock note\n\n# Details\n\nNested label\n',
    );
  });

  it('converts unicode strings from a vsd OLE stream', async () => {
    const bytes = oleStream('VisioDocument', utf16le('Hello from Visio'));
    await expect(toMarkdown(bytes, { path: 'flow.vsd' })).resolves.toContain('Hello from Visio');
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.vsdx' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => visio().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => visio().convert(tinyDocx('Office wins'))).toThrow(ConvertError);
    expect(() => visio().convert(oleStream('WordDocument', utf16le('Word')))).toThrow(ConvertError);
  });
});

function tinyVsdx(): Uint8Array {
  const page1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="${VISIO_NS}" xmlns:r="${R_NS}" xml:space="preserve">
  <Shapes>
    <Shape ID="1" NameU="Process" Name="Process" Type="Shape">
      <Text>Start here</Text>
    </Shape>
    <Shape ID="2" Type="Group">
      <Shapes>
        <Shape ID="3" Type="Shape">
          <Text><cp IX="0"/>Decision</Text>
        </Shape>
      </Shapes>
    </Shape>
    <Shape ID="4" Type="Shape">
      <TextBlock>Block note</TextBlock>
    </Shape>
  </Shapes>
</PageContents>`;
  const page2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="${VISIO_NS}">
  <Shapes>
    <Shape ID="1" Type="Shape">
      <Text>Nested label</Text>
    </Shape>
  </Shapes>
</PageContents>`;
  return zipStore({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
  <Override PartName="/visio/pages/page2.xml" ContentType="application/vnd.ms-visio.page+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Relationship Id="rId1" Type="${OFFICE_REL}" Target="visio/document.xml"/>
</Relationships>`,
    'visio/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="${VISIO_NS}"/>`,
    'visio/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Relationship Id="rId1" Type="${PAGES_REL}" Target="pages/pages.xml"/>
</Relationships>`,
    'visio/pages/pages.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="${VISIO_NS}" xmlns:r="${R_NS}">
  <Page ID="0" NameU="Page-1" Name="Overview"><Rel r:id="rId1"/></Page>
  <Page ID="1" NameU="Page-2" Name="Details"><Rel r:id="rId2"/></Page>
</Pages>`,
    'visio/pages/_rels/pages.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Relationship Id="rId1" Type="${PAGE_REL}" Target="page1.xml"/>
  <Relationship Id="rId2" Type="${PAGE_REL}" Target="page2.xml"/>
</Relationships>`,
    'visio/pages/page1.xml': page1,
    'visio/pages/page2.xml': page2,
  });
}

function tinyDocx(text: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`;
  return zipStore({ 'word/document.xml': xml });
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

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
}

function oleStream(name: string, payload: Uint8Array): Uint8Array {
  const SECTOR = 512;
  const FATSECT = 0xfffffffd;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;
  const NOSTREAM = 0xffffffff;
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
    name,
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
