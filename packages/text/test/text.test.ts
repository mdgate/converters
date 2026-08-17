import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { text, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

describe('text', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = text();
    expect(converter.id).toBe('text');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('hello')]);
    expect(converter.sniff(bom, { path: 'notes.txt' })).toBe(2);
    expect(converter.sniff(enc.encode('hello'), { path: 'notes.txt' })).toBe(1);
    expect(converter.sniff(enc.encode('x'), { path: 'readme.md' })).toBe(1);
    expect(converter.sniff(enc.encode('x'), { path: 'app.js' })).toBe(1);
    expect(converter.sniff(enc.encode('x'), { path: 'Main.TSX' })).toBe(1);
    expect(converter.sniff(bom)).toBe(0);
    expect(converter.sniff(enc.encode('hello'))).toBe(0);
    expect(converter.sniff(enc.encode('{}'), { path: 'a.json' })).toBe(0);
    expect(converter.sniff(enc.encode('a,b'), { path: 'a.csv' })).toBe(0);
    expect(converter.sniff(enc.encode('<html></html>'), { path: 'a.html' })).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
  });

  it('converts plain text, markdown passthrough, and source fences', async () => {
    await expect(toMarkdown(enc.encode('Hello\n\nWorld'), { path: 'notes.txt' })).resolves.toBe(
      'Hello\n\nWorld\n',
    );
    await expect(toMarkdown(enc.encode('# Title'), { path: 'readme.md' })).resolves.toBe(
      '# Title\n',
    );
    await expect(toMarkdown(enc.encode('const x = 1;'), { path: 'app.js' })).resolves.toBe(
      '```js\nconst x = 1;\n```\n',
    );
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    await expect(toMarkdown(utf16, { path: 'notes.txt' })).resolves.toBe('Hi\n');
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.txt' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => text().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => text().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
    expect(() =>
      text().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
  });
});
