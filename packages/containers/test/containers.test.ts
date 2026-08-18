import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { Package } from '../src/archive.js';
import { detectOleDoc, detectZipDoc } from '../src/detect.js';
import { MAX_XML_DEPTH } from '../src/limits.js';
import {
  mimeAttachments,
  mimeHeader,
  mimeTextHtml,
  mimeTextPlain,
  parseMime,
  walkMimeParts,
} from '../src/mime.js';
import { resolve } from '../src/path.js';
import { normalizeOoxmlUri, ns, parseXml } from '../src/xml.js';

const FIXTURES = join(fileURLToPath(new URL('../../../test/fixtures', import.meta.url)));

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
    const xml =
      '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>';
    const root = parseXml(Buffer.from(xml));
    expect(root.find(ns.W, 'document')?.find(ns.W, 'body')).toBeTruthy();
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

  it('hard-fails on depth limit', () => {
    const xml = '<d>'.repeat(MAX_XML_DEPTH + 2);
    try {
      parseXml(Buffer.from(xml));
      throw new Error('expected resourceLimit');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('resourceLimit');
      expect((err as ConvertError).limit).toBe('max_xml_depth');
    }
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

    const hwpx = zipStore({
      mimetype: 'application/hwp+zip',
      'Contents/content.hpf': '<hpf/>',
    });
    expect(detectZipDoc(hwpx)).toBe('hwpx');

    const hwpxByPart = zipStore({
      'Contents/content.hpf': '<hpf/>',
    });
    expect(detectZipDoc(hwpxByPart)).toBe('hwpx');
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

  it('hard-fails on nested multipart bombs', () => {
    let body = 'Content-Type: text/plain\r\n\r\nx';
    for (let i = 0; i < 40; i += 1) {
      const b = `b${i}`;
      body = `Content-Type: multipart/mixed; boundary=${b}\r\n\r\n--${b}\r\n${body}\r\n--${b}--\r\n`;
    }
    try {
      parseMime(enc.encode(body));
      throw new Error('expected resourceLimit');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('resourceLimit');
      expect((err as ConvertError).limit).toBe('max_mime_depth');
    }
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
