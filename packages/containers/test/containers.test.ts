import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { Package } from '../src/archive.js';
import { detectOleDoc, detectZipDoc } from '../src/detect.js';
import { MAX_XML_DEPTH } from '../src/limits.js';
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

  it('classifies anydoc fixtures from bytes', () => {
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

  it('reads a zip part with limits', () => {
    const bytes = readFileSync(join(FIXTURES, 'docx/text.docx'));
    const pkg = Package.open(bytes);
    expect(pkg.hasPart('word/document.xml')).toBe(true);
    const xml = pkg.requiredXmlPart('word/document.xml');
    expect(xml.firstDescendant(ns.W, 'body')).toBeTruthy();
  });
});
