import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { fb2, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <book-title>Foundation</book-title>
      <author>
        <first-name>Isaac</first-name>
        <last-name>Asimov</last-name>
      </author>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>Chapter 1</p></title>
      <p>Hello <emphasis>world</emphasis> and <strong>friends</strong>.</p>
      <poem>
        <stanza>
          <v>Line one</v>
          <v>Line two</v>
        </stanza>
      </poem>
      <cite>
        <p>A quote</p>
        <text-author>Someone</text-author>
      </cite>
      <table>
        <tr>
          <th><p>Name</p></th>
          <th><p>Age</p></th>
        </tr>
        <tr>
          <td><p>Ada</p></td>
          <td><p>36</p></td>
        </tr>
      </table>
    </section>
  </body>
</FictionBook>`;

describe('fb2', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = fb2();
    expect(converter.id).toBe('fb2');
    expect(converter.sniff(enc.encode(SAMPLE))).toBe(2);
    expect(
      converter.sniff(
        enc.encode('<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"/>'),
      ),
    ).toBe(2);
    expect(converter.sniff(enc.encode('<FictionBook></FictionBook>'))).toBe(2);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('<FictionBook></FictionBook>')]);
    expect(converter.sniff(bom)).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'book.fb2' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Book.FB2' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'book.fb2.zip' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(enc.encode('<html><body>hi</body></html>'))).toBe(0);
  });

  it('converts title, author, sections, emphasis, poem, cite, and table', async () => {
    await expect(toMarkdown(enc.encode(SAMPLE))).resolves.toBe(
      [
        '# Foundation',
        '',
        'Isaac Asimov',
        '',
        '## Chapter 1',
        '',
        'Hello *world* and **friends**.',
        '',
        '> Line one\\',
        '> Line two',
        '',
        '> A quote',
        '>',
        '> *Someone*',
        '',
        '| Name | Age |',
        '| --- | --- |',
        '| Ada | 36 |',
        '',
      ].join('\n'),
    );
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.fb2' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => fb2().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() =>
      fb2().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
    expect(() => fb2().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
  });
});
