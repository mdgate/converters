import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { html, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

describe('html', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = html();
    expect(converter.id).toBe('html');
    expect(converter.sniff(enc.encode('<!DOCTYPE html><html></html>'))).toBe(2);
    expect(converter.sniff(enc.encode('<html lang="en"></html>'))).toBe(2);
    expect(converter.sniff(enc.encode('<HTML></HTML>'))).toBe(2);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('<html></html>')]);
    expect(converter.sniff(bom)).toBe(2);
    expect(converter.sniff(enc.encode('<html xmlns="http://www.w3.org/1999/xhtml"></html>'))).toBe(
      2,
    );
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.htm' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'page.html' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'ch.xhtml' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'saved.mhtml' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'saved.mht' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(
      converter.sniff(
        enc.encode(
          '<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></office:document>',
        ),
      ),
    ).toBe(0);
  });

  it('converts a heading, paragraph, and link', async () => {
    const bytes = enc.encode(
      '<html><h1>Title</h1><p>Hello <a href="https://example.com">world</a></p></html>',
    );
    await expect(toMarkdown(bytes)).resolves.toBe(
      '# Title\n\nHello [world](https://example.com)\n',
    );
  });

  it('refuses a PDF', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.html' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => html().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() =>
      html().convert(
        enc.encode(
          '<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></office:document>',
        ),
        { path: 'flat.fodt' },
      ),
    ).toThrow(ConvertError);
  });
});
