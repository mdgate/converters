import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { data, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

describe('data', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = data();
    expect(converter.id).toBe('data');
    expect(converter.sniff(enc.encode('{"a":1}'))).toBe(2);
    expect(converter.sniff(enc.encode('  [1, 2]'))).toBe(2);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('{"a":1}')]);
    expect(converter.sniff(bom)).toBe(2);
    expect(converter.sniff(enc.encode('x'), { path: 'a.json' })).toBe(2);
    expect(converter.sniff(enc.encode('x'), { path: 'rows.jsonl' })).toBe(2);
    expect(converter.sniff(enc.encode('<root/>'), { path: 'a.xml' })).toBe(1);
    expect(converter.sniff(enc.encode('foo: bar'), { path: 'a.yaml' })).toBe(1);
    expect(converter.sniff(enc.encode('foo: bar'), { path: 'a.yml' })).toBe(1);
    expect(
      converter.sniff(enc.encode('<?xml version="1.0"?><office:document></office:document>')),
    ).toBe(0);
    expect(converter.sniff(enc.encode('<?xml version="1.0"?><root/>'), { path: 'doc.xml' })).toBe(
      1,
    );
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'), { path: 'a.json' })).toBe(0);
    expect(converter.sniff(ZIP, { path: 'a.json' })).toBe(0);
    expect(converter.sniff(OLE, { path: 'a.xml' })).toBe(0);
    expect(converter.sniff(enc.encode('{\\rtf1\\ansi hi}'))).toBe(0);
    expect(converter.sniff(enc.encode('{\\rtf1\\ansi hi}'), { path: 'a.json' })).toBe(0);
    expect(converter.sniff(enc.encode('[ti:Swansong]\n[00:35.62]Hello\n'))).toBe(0);
    expect(converter.sniff(enc.encode('{0}{}25.000 FPS\n{1000}{}foo\n'))).toBe(0);
    expect(converter.sniff(enc.encode('[0][12]Foo|bar|bla\n'))).toBe(0);
    expect(converter.sniff(enc.encode('[0]\n'))).toBe(2);
  });

  it('converts a small json object to a list and an array of objects to a table', async () => {
    await expect(toMarkdown(enc.encode('{"host":"example.com","port":443}'))).resolves.toBe(
      '- host: example.com\n- port: 443\n',
    );
    await expect(
      toMarkdown(enc.encode('[{"name":"Ada","id":1},{"name":"Bob","id":2}]')),
    ).resolves.toBe('| name | id |\n| --- | --- |\n| Ada | 1 |\n| Bob | 2 |\n');
  });

  it('fences nested json, jsonl without shared keys, xml, and yaml', async () => {
    const nested = await toMarkdown(enc.encode('{"a":{"b":1}}'));
    expect(nested).toContain('```json');
    expect(nested).toContain('"b": 1');

    const jsonl = await toMarkdown(enc.encode('{"a":1}\n[2]\n'), { path: 'rows.jsonl' });
    expect(jsonl).toContain('# rows');
    expect(jsonl).toContain('```json');
    expect(jsonl).toContain('"a": 1');

    const shared = await toMarkdown(enc.encode('{"a":1}\n{"a":2}\n'), { path: 'rows.jsonl' });
    expect(shared).toBe('# rows\n\n| a |\n| --- |\n| 1 |\n| 2 |\n');

    const many = Array.from({ length: 250 }, (_, i) => JSON.stringify({ n: i })).join('\n');
    const allLines = await toMarkdown(enc.encode(many), { path: 'rows.jsonl' });
    expect(allLines).toContain('"n": 0');
    expect(allLines).toContain('"n": 249');
    expect(allLines.split('```json').length - 1).toBe(250);

    const xml = await toMarkdown(enc.encode('<?xml version="1.0"?><root><x>1</x></root>'), {
      path: 'a.xml',
    });
    expect(xml).toContain('```xml');
    expect(xml).toContain('<root>');
    expect(xml).toContain('<x>1</x>');

    const yaml = await toMarkdown(enc.encode('foo: bar\n'), { path: 'cfg.yaml' });
    expect(yaml).toBe('```yaml\nfoo: bar\n```\n');
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.xml' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => data().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => data().convert(ZIP, { path: 'a.json' })).toThrow(ConvertError);
    expect(() => data().convert(OLE, { path: 'a.yaml' })).toThrow(ConvertError);
    expect(() => data().convert(enc.encode('{\\rtf1\\ansi hi}'))).toThrow(ConvertError);
  });

  it('rejects malformed json', async () => {
    await expect(toMarkdown(enc.encode('{'), { path: 'a.json' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'malformed',
    });
  });
});
