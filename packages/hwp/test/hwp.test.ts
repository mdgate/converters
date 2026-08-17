import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { hwp, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

describe('hwp', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = hwp();
    expect(converter.id).toBe('hwp');
    expect(converter.sniff(tinyHwpx('Hello HWPX'))).toBe(2);
    expect(converter.sniff(hwpSignatureFile('Hello Hangul'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.hwp' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.hwpx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tpl.hwt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tpl.hwtx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Note.HWP' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(tinyDocx('Office wins'))).toBe(0);
    expect(converter.sniff(enc.encode('just text'))).toBe(0);
  });

  it('converts a synthetic HWPX package to markdown', async () => {
    const md = await toMarkdown(tinyHwpx('Hello HWPX'));
    expect(md).toContain('# Outline Title');
    expect(md).toContain('Hello HWPX');
    expect(md).toContain('| A | B |');
    expect(md).toContain('| C | D |');
  });

  it('converts classic HWP signature bytes via UTF-16 strings', async () => {
    await expect(toMarkdown(hwpSignatureFile('Hello Hangul'))).resolves.toContain('Hello Hangul');
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.hwp' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => hwp().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => hwp().convert(tinyDocx('Office wins'))).toThrow(ConvertError);
    expect(() => hwp().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
  });
});

function tinyHwpx(text: string): Uint8Array {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:styles>
    <hh:style id="0" type="PARA" name="바탕글" engName="Normal"/>
    <hh:style id="2" type="PARA" name="개요 1" engName="Outline 1"/>
  </hh:styles>
</hh:head>`;
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="0" paraPrIDRef="2" styleIDRef="2">
    <hp:run><hp:t>Outline Title</hp:t></hp:run>
  </hp:p>
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0">
    <hp:run><hp:t>${text}</hp:t></hp:run>
  </hp:p>
  <hp:tbl id="0" rowCnt="2" colCnt="2">
    <hp:tr>
      <hp:tc>
        <hp:subList><hp:p><hp:run><hp:t>A</hp:t></hp:run></hp:p></hp:subList>
      </hp:tc>
      <hp:tc>
        <hp:subList><hp:p><hp:run><hp:t>B</hp:t></hp:run></hp:p></hp:subList>
      </hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc>
        <hp:subList><hp:p><hp:run><hp:t>C</hp:t></hp:run></hp:p></hp:subList>
      </hp:tc>
      <hp:tc>
        <hp:subList><hp:p><hp:run><hp:t>D</hp:t></hp:run></hp:p></hp:subList>
      </hp:tc>
    </hp:tr>
  </hp:tbl>
</hs:sec>`;
  return zipStore({
    mimetype: 'application/hwp+zip',
    'Contents/content.hpf': '<hpf/>',
    'Contents/header.xml': header,
    'Contents/section0.xml': section,
  });
}

function hwpSignatureFile(text: string): Uint8Array {
  const sig = enc.encode('HWP Document File');
  const header = new Uint8Array(32);
  header.set(sig);
  const payload = encodeUtf16le(text);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header);
  out.set(payload, header.length);
  return out;
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

function tinyDocx(text: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`;
  return zipStore({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': xml,
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
