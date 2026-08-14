import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromStyleName } from '../src/internal/common/blockstyle.js';
import { hyperlinkTarget } from '../src/internal/common/fields.js';
import { resolveHeaderRows } from '../src/internal/common/header.js';
import { compositeLabel, parsePercentPattern } from '../src/internal/common/numbering.js';
import { cleanText } from '../src/internal/common/text.js';
import { isAbsoluteUri } from '../src/internal/common/uri.js';
import { formatFromBytes, formatFromExtension } from '../src/internal/detect.js';
import { ConvertError } from '../src/internal/error.js';
import { cellFromInlines, plain, tableFromRows } from '../src/internal/model/index.js';
import { Package } from '../src/internal/package/archive.js';
import { MAX_XML_DEPTH } from '../src/internal/package/limits.js';
import { resolve } from '../src/internal/package/path.js';
import { normalizeOoxmlUri, ns, parseXml } from '../src/internal/package/xml.js';

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
  it('reads signatures', () => {
    expect(formatFromBytes(Buffer.from('%PDF-1.7\n'))).toBeUndefined();
    expect(formatFromBytes(Buffer.from('{\\rtf1\\ansi hi}'))).toBe('rtf');
    expect(formatFromBytes(Buffer.from('a,b,c\n1,2,3\n'))).toBeUndefined();
    expect(formatFromBytes(Buffer.from(''))).toBeUndefined();
    expect(formatFromExtension('DOCX')).toBe('docx');
    expect(formatFromExtension('csv')).toBe('csv');
  });

  it('classifies anydoc fixtures from bytes', () => {
    const cases: Array<[string, string]> = [
      ['docx/text.docx', 'docx'],
      ['odt/text.odt', 'odt'],
      ['ods/sheet.ods', 'ods'],
      ['odp/pres.odp', 'odp'],
      ['epub/book.epub', 'epub'],
      ['pptx/pres.pptx', 'pptx'],
      ['xlsx/sheet.xlsx', 'excel'],
      ['rtf/text.rtf', 'rtf'],
      ['doc/text.doc', 'doc'],
      ['ppt/pres.ppt', 'ppt'],
      ['xls/sheet.xls', 'excel'],
    ];
    for (const [rel, expected] of cases) {
      const bytes = readFileSync(join(FIXTURES, rel));
      expect(formatFromBytes(bytes), rel).toBe(expected);
    }
    expect(formatFromBytes(readFileSync(join(FIXTURES, 'csv/sheet.csv')))).toBeUndefined();
  });

  it('reads a zip part with limits', () => {
    const bytes = readFileSync(join(FIXTURES, 'docx/text.docx'));
    const pkg = Package.open(bytes);
    expect(pkg.hasPart('word/document.xml')).toBe(true);
    const xml = pkg.requiredXmlPart('word/document.xml');
    expect(xml.firstDescendant(ns.W, 'body')).toBeTruthy();
  });
});

describe('common helpers', () => {
  it('cleans text like rust', () => {
    expect(cleanText('می\u{200c}خواهم')).toBe('می\u{200c}خواهم');
    expect(cleanText('a\u{ad}b\u{200b}c\u{feff}d\u{a0}e')).toBe('abcd e');
  });

  it('maps style names', () => {
    expect(fromStyleName('Intense Quote')).toBe('quote');
    expect(fromStyleName('Preformatted_20_Text')).toBe('code');
    expect(fromStyleName('Normal')).toBeUndefined();
  });

  it('parses percent patterns and composite labels', () => {
    expect(parsePercentPattern('%1.%2)')).toEqual([
      { type: 'level', level: 0 },
      { type: 'literal', text: '.' },
      { type: 'level', level: 1 },
      { type: 'literal', text: ')' },
    ]);
    const label = compositeLabel(
      { text: parsePercentPattern('%1-%2)'), legal: false },
      'lowerAlpha',
      5,
      (l) => (l === 0 ? 'decimal' : 'lowerAlpha'),
      (l) => [2, 5][Math.min(l, 1)]!,
    );
    expect(label).toBe('2-e)');
  });

  it('detects header rows', () => {
    const detect = (rows: string[][]): number => {
      const cells = rows.map((r) => r.map((t) => cellFromInlines([plain(t)])));
      return resolveHeaderRows(tableFromRows(cells, 0, 'data'), 0);
    };
    expect(
      detect([
        ['name', 'qty'],
        ['a', '1'],
        ['b', '2'],
      ]),
    ).toBe(1);
    expect(
      detect([
        ['36', '12', 'aka'],
        ['173', '57', 'aka'],
        ['306', '220', 'aka'],
      ]),
    ).toBe(0);
  });

  it('classifies uris and hyperlink fields', () => {
    expect(isAbsoluteUri('https://e.com')).toBe(true);
    expect(isAbsoluteUri('C:\\docs\\a.doc')).toBe(false);
    expect(hyperlinkTarget(' HYPERLINK "https://e.com/a b" ')).toEqual({
      type: 'external',
      url: 'https://e.com/a b',
    });
    expect(hyperlinkTarget('HYPERLINK \\l "sec2"')).toEqual({ type: 'anchor', id: 'sec2' });
  });
});
