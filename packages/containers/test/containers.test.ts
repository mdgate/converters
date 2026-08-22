import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { Package, probeOle } from '../src/archive.js';
import { CompoundFile } from '../src/cfb.js';
import { detectOleDoc, detectZipDoc } from '../src/detect.js';
import {
  mimeAttachments,
  mimeHeader,
  mimeTextHtml,
  mimeTextPlain,
  parseMime,
  walkMimeParts,
} from '../src/mime.js';
import { resolve } from '../src/path.js';
import { normalizeOoxmlUri, normalizeStarOfficeUri, ns, parseXml } from '../src/xml.js';

const FIXTURES = join(fileURLToPath(new URL('../../../test/fixtures', import.meta.url)));

describe('ole fat padding', () => {
  it('opens a compound file whose extra FAT slots are ENDOFCHAIN', () => {
    const bytes = oleWithFatPad(ENDOFCHAIN_PAD, [
      { name: 'ENCRYPTIONINFO', data: new Uint8Array([1, 2, 3, 4]) },
      { name: 'ENCRYPTEDPACKAGE', data: new Uint8Array([5, 6, 7, 8]) },
    ]);
    const file = CompoundFile.open(bytes);
    expect(file.exists('EncryptionInfo')).toBe(true);
    expect(file.exists('EncryptedPackage')).toBe(true);
    expect(file.readStream('ENCRYPTIONINFO')).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('treats that layout as an encrypted OOXML package', () => {
    const bytes = oleWithFatPad(ENDOFCHAIN_PAD, [
      { name: 'ENCRYPTIONINFO', data: new Uint8Array([1]) },
      { name: 'ENCRYPTEDPACKAGE', data: new Uint8Array([2]) },
    ]);
    const err = probeOle(bytes);
    expect(err).toMatchObject({ name: 'ConvertError', code: 'encrypted' });
  });

  it('classifies uppercase WordDocument after the same FAT pad', () => {
    const bytes = oleWithFatPad(ENDOFCHAIN_PAD, [
      { name: 'WORDDOCUMENT', data: new Uint8Array(8) },
    ]);
    expect(detectOleDoc(bytes)).toBe('doc');
  });

  it('still rejects a FAT that points past the end of the file', () => {
    expect(() => olePastEof()).toThrow(ConvertError);
    try {
      olePastEof();
    } catch (e) {
      expect(e).toMatchObject({ name: 'ConvertError', code: 'malformed' });
    }
  });
});

describe('package path', () => {
  const path = (base: string, r: string) => resolve(base, r).path;

  it('resolves relative, absolute, dots, fragments', () => {
    expect(path('word/document.xml', 'media/image1.png')).toBe('word/media/image1.png');
    expect(path('word/document.xml', '/docProps/core.xml')).toBe('docProps/core.xml');
    expect(path('OEBPS/text/ch1.xhtml', '../images/i.png')).toBe('OEBPS/images/i.png');
    expect(path('a/b.xml', '../../../x.xml')).toBe('x.xml');
    const t = resolve('OEBPS/ch1.xhtml', 'ch2.xhtml#sec-2');
    expect(t.path).toBe('OEBPS/ch2.xhtml');
    expect(t.fragment).toBe('sec-2');
    expect(path('OEBPS/x.opf', 'my%20file.xhtml')).toBe('OEBPS/my file.xhtml');
    expect(() => resolve('a/b.xml', 'x%2Fy.xml')).toThrow(ConvertError);
    expect(() => resolve('a/b.xml', '%2E%2E/secret.xml')).toThrow(ConvertError);
  });
});

describe('xml', () => {
  it('resolves namespaces regardless of prefix', () => {
    const xml = '<x:root xmlns:x="urn:a" xmlns:y="urn:b"><y:kid x:id="1" plain="p"/></x:root>';
    const root = parseXml(Buffer.from(xml));
    const r = root.find('urn:a', 'root')!;
    const kid = r.find('urn:b', 'kid')!;
    expect(kid.attr('urn:a', 'id')).toBe('1');
    expect(kid.attr('urn:whatever', 'plain')).toBe('p');
  });

  it('normalizes Strict OOXML namespaces', () => {
    expect(normalizeOoxmlUri('http://purl.oclc.org/ooxml/wordprocessingml/main')).toBe(ns.W);
    expect(normalizeStarOfficeUri('http://openoffice.org/2000/office')).toBe(ns.OFFICE);
    expect(normalizeStarOfficeUri('http://openoffice.org/2001/manifest')).toBe(ns.MANIFEST);
    const xml =
      '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>';
    const root = parseXml(Buffer.from(xml));
    expect(root.find(ns.W, 'document')?.find(ns.W, 'body')).toBeTruthy();
    const star =
      '<office:document-content xmlns:office="http://openoffice.org/2000/office"><office:body/></office:document-content>';
    const starRoot = parseXml(Buffer.from(star));
    expect(starRoot.find(ns.OFFICE, 'document-content')?.find(ns.OFFICE, 'body')).toBeTruthy();
  });

  it('resolves Requires prefixes in lexical scope', () => {
    const xml = `<mc:AlternateContent
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
            <mc:Choice xmlns:z="urn:one" Requires="z"/>
            <mc:Choice xmlns:z="urn:two" Requires="z unknownprefix"/>
        </mc:AlternateContent>`;
    const root = parseXml(Buffer.from(xml));
    const alt = root.find(ns.MC, 'AlternateContent')!;
    const choices = alt.findAll(ns.MC, 'Choice');
    expect(choices[0]!.attrAny('Requires')).toBe('urn:one');
    expect(choices[1]!.attrAny('Requires')).toBe('urn:two unknownprefix');
  });

  it('recovers unclosed elements', () => {
    const root = parseXml(Buffer.from('<a><b>text'));
    expect(root.childElems()[0]!.local).toBe('a');
    expect(root.childElems()[0]!.text()).toBe('text');
  });

  it('parses deeper than the old xml depth cap', () => {
    const depth = 258;
    const xml = `${'<d>'.repeat(depth)}x${'</d>'.repeat(depth)}`;
    const root = parseXml(Buffer.from(xml));
    expect(root.text()).toBe('x');
  });
});

describe('detect', () => {
  it('ignores non-container signatures', () => {
    expect(detectZipDoc(Buffer.from('%PDF-1.7\n'))).toBeUndefined();
    expect(detectOleDoc(Buffer.from('%PDF-1.7\n'))).toBeUndefined();
    expect(detectZipDoc(Buffer.from('a,b,c\n1,2,3\n'))).toBeUndefined();
    expect(detectZipDoc(Buffer.from(''))).toBeUndefined();
    expect(detectOleDoc(Buffer.from(''))).toBeUndefined();
  });

  it('classifies fixtures from bytes', () => {
    const zipCases: Array<[string, string]> = [
      ['docx/text.docx', 'docx'],
      ['odt/text.odt', 'odt'],
      ['ods/sheet.ods', 'ods'],
      ['odp/pres.odp', 'odp'],
      ['epub/book.epub', 'epub'],
      ['pptx/pres.pptx', 'pptx'],
      ['xlsx/sheet.xlsx', 'xlsx'],
    ];
    for (const [rel, expected] of zipCases) {
      const bytes = readFileSync(join(FIXTURES, rel));
      expect(detectZipDoc(bytes), rel).toBe(expected);
      expect(detectOleDoc(bytes), rel).toBeUndefined();
    }
    const oleCases: Array<[string, string]> = [
      ['doc/text.doc', 'doc'],
      ['ppt/pres.ppt', 'ppt'],
      ['xls/sheet.xls', 'xls'],
    ];
    for (const [rel, expected] of oleCases) {
      const bytes = readFileSync(join(FIXTURES, rel));
      expect(detectOleDoc(bytes), rel).toBe(expected);
      expect(detectZipDoc(bytes), rel).toBeUndefined();
    }
    expect(detectZipDoc(readFileSync(join(FIXTURES, 'csv/sheet.csv')))).toBeUndefined();
  });

  it('classifies odg, vsdx, and hwpx from package bytes', () => {
    const odg = zipStore({
      mimetype: 'application/vnd.oasis.opendocument.graphics',
    });
    expect(detectZipDoc(odg)).toBe('odg');
    expect(detectOleDoc(odg)).toBeUndefined();

    const odgTemplate = zipStore({
      mimetype: 'application/vnd.oasis.opendocument.graphics-template',
    });
    expect(detectZipDoc(odgTemplate)).toBe('odg');

    const vsdx = zipStore({
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="visio/document.xml"/>
</Relationships>`,
      'visio/document.xml': '<VisioDocument/>',
    });
    expect(detectZipDoc(vsdx)).toBe('vsdx');

    const ibooks = zipStore({
      mimetype: 'application/x-ibooks+zip',
    });
    expect(detectZipDoc(ibooks)).toBe('epub');

    const hwpx = zipStore({
      mimetype: 'application/hwp+zip',
      'Contents/content.hpf': '<hpf/>',
    });
    expect(detectZipDoc(hwpx)).toBe('hwpx');

    const hwpxByPart = zipStore({
      'Contents/content.hpf': '<hpf/>',
    });
    expect(detectZipDoc(hwpxByPart)).toBe('hwpx');

    const sxw = zipStore({
      'META-INF/manifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest">
  <manifest:file-entry manifest:media-type="application/vnd.sun.xml.writer" manifest:full-path="/"/>
</manifest:manifest>`,
    });
    expect(detectZipDoc(sxw)).toBe('odt');

    const pages09 = zipStore({
      'index.xml': `<?xml version="1.0"?><sl:document xmlns:sl="http://developer.apple.com/namespaces/sl"/>`,
    });
    expect(detectZipDoc(pages09)).toBe('pages');
  });

  it('reads a zip part with limits', () => {
    const bytes = readFileSync(join(FIXTURES, 'docx/text.docx'));
    const pkg = Package.open(bytes);
    expect(pkg.hasPart('word/document.xml')).toBe(true);
    const xml = pkg.requiredXmlPart('word/document.xml');
    expect(xml.firstDescendant(ns.W, 'body')).toBeTruthy();
  });
});

describe('mime', () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  it('parses text/plain and preserves 8bit bytes', () => {
    const raw = enc.encode('Content-Type: text/plain; charset=utf-8\r\n\r\ncaf\u00e9\n');
    const part = parseMime(raw);
    expect(part.contentType).toBe('text/plain');
    expect(part.parts).toEqual([]);
    expect(dec.decode(part.bytes)).toBe('café\n');
    expect(mimeTextPlain(part)).toBe(part);
    expect(mimeTextHtml(part)).toBeUndefined();
  });

  it('decodes quoted-printable and base64 bodies', () => {
    const qp = parseMime(
      enc.encode(
        'Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nhello=20wo=\r\nrld=21',
      ),
    );
    expect(dec.decode(qp.bytes)).toBe('hello world!');

    const b64 = parseMime(
      enc.encode(
        'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8gd29ybGQ=\r\n',
      ),
    );
    expect(dec.decode(b64.bytes)).toBe('hello world');
  });

  it('keeps the last multipart part when the closing delimiter is missing', () => {
    const raw = enc.encode(
      [
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; boundary="x"',
        '',
        '--x',
        'Content-Type: text/html; charset="utf-8"',
        '',
        '<p>Saved page</p>',
        '',
      ].join('\n'),
    );
    const part = parseMime(raw);
    expect(part.parts).toHaveLength(1);
    expect(mimeTextHtml(part)?.contentType).toBe('text/html');
    expect(dec.decode(mimeTextHtml(part)!.bytes)).toContain('Saved page');
  });

  it('picks html, plain, and attachments from multipart mail', () => {
    const raw = enc.encode(
      [
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="mix"',
        '',
        '--mix',
        'Content-Type: multipart/alternative; boundary="alt"',
        '',
        '--alt',
        'Content-Type: text/plain',
        '',
        'plain body',
        '--alt',
        'Content-Type: text/html',
        '',
        '<p>html body</p>',
        '--alt--',
        '--mix',
        'Content-Type: application/pdf; name="note.pdf"',
        'Content-Disposition: attachment; filename="note.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERg==',
        '--mix--',
        '',
      ].join('\r\n'),
    );
    const root = parseMime(raw);
    expect(root.contentType).toBe('multipart/mixed');
    expect(walkMimeParts(root).length).toBeGreaterThan(3);
    expect(dec.decode(mimeTextPlain(root)!.bytes)).toBe('plain body');
    expect(dec.decode(mimeTextHtml(root)!.bytes)).toBe('<p>html body</p>');
    const atts = mimeAttachments(root);
    expect(atts).toHaveLength(1);
    expect(atts[0]!.filename).toBe('note.pdf');
    expect(atts[0]!.contentType).toBe('application/pdf');
    expect(mimeHeader(atts[0]!, 'content-disposition')?.startsWith('attachment')).toBe(true);
  });

  it('parses an mbox of two messages', () => {
    const raw = enc.encode(
      [
        'From a@b Mon Jan 01 00:00:00 2000',
        'Content-Type: text/plain',
        '',
        'first',
        'From c@d Mon Jan 01 00:00:01 2000',
        'Content-Type: text/plain',
        '',
        'second',
        '',
      ].join('\r\n'),
    );
    const root = parseMime(raw);
    expect(root.contentType).toBe('application/mbox');
    expect(root.parts).toHaveLength(2);
    expect(dec.decode(root.parts[0]!.bytes).trim()).toBe('first');
    expect(dec.decode(root.parts[1]!.bytes).trim()).toBe('second');
  });

  it('parses nested multipart without a depth cap', () => {
    let body = 'Content-Type: text/plain\r\n\r\nx';
    for (let i = 0; i < 40; i += 1) {
      const b = `b${i}`;
      body = `Content-Type: multipart/mixed; boundary=${b}\r\n\r\n--${b}\r\n${body}\r\n--${b}--\r\n`;
    }
    const root = parseMime(enc.encode(body));
    const texts = walkMimeParts(root)
      .filter((part) => part.contentType.startsWith('text/plain'))
      .map((part) => dec.decode(part.bytes));
    expect(texts.some((t) => t.includes('x'))).toBe(true);
  });
});

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

const SECTOR = 512;
const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;
const ENDOFCHAIN_PAD = 'end';
const CHAIN_PAST_EOF = 'past';

function oleWithFatPad(
  pad: typeof ENDOFCHAIN_PAD | typeof CHAIN_PAST_EOF,
  streams: { name: string; data: Uint8Array }[],
): Uint8Array {
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
  const extra = pad === CHAIN_PAST_EOF ? sectorCount : ENDOFCHAIN;
  for (let i = 0; i < 128; i += 1) dv.setUint32(fatOff + i * 4, extra, true);
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

function olePastEof(): void {
  CompoundFile.open(
    oleWithFatPad(CHAIN_PAST_EOF, [{ name: 'WordDocument', data: new Uint8Array(8) }]),
  );
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
