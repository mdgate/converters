import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { html, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();
const hint = { path: 'page.html' };

function md(html: string): Promise<string> {
  return toMarkdown(enc.encode(html), hint);
}

describe('html', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = html();
    expect(converter.id).toBe('html');
    expect(converter.sniff(enc.encode('<!DOCTYPE html><html></html>'))).toBe(3);
    expect(converter.sniff(enc.encode('<html lang="en"></html>'))).toBe(3);
    expect(converter.sniff(enc.encode('<HTML></HTML>'))).toBe(3);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('<html></html>')]);
    expect(converter.sniff(bom)).toBe(3);
    expect(converter.sniff(enc.encode('<html xmlns="http://www.w3.org/1999/xhtml"></html>'))).toBe(
      3,
    );
    expect(
      converter.sniff(
        enc.encode(
          'From: a@b\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=x\r\nContent-Location: cid:body\r\n\r\n--x\r\n',
        ),
      ),
    ).toBe(3);
    expect(converter.sniff(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(0);
    const ebookZip = zipStore({
      mimetype: 'application/epub+zip',
      'EPUB/ch.xhtml':
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>chapter</p></body></html>',
    });
    expect(converter.sniff(ebookZip)).toBe(0);
    expect(converter.sniff(ebookZip, { path: 'tiny.epub' })).toBe(0);
    expect(converter.sniff(ebookZip, { path: 'page.html' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.htm' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'page.html' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tables.html4' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'nordics.html5' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'ch.xhtml' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'saved.mhtml' })).toBe(3);
    expect(converter.sniff(new Uint8Array([1]), { path: 'saved.mht' })).toBe(3);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(
      converter.sniff(
        enc.encode(
          '<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></office:document>',
        ),
      ),
    ).toBe(0);
  });

  it('converts HTML fragments named .html4 or .html5', async () => {
    const fragment = enc.encode(
      '<p>Simple table with caption:</p><table><tr><td>12</td></tr></table>',
    );
    expect(html().sniff(fragment)).toBe(0);
    await expect(toMarkdown(fragment)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    const expected = 'Simple table with caption:\n\n|  |\n| --- |\n| 12 |\n';
    await expect(toMarkdown(fragment, { path: 'tables.html4' })).resolves.toBe(expected);
    await expect(toMarkdown(fragment, { path: 'nordics.html5' })).resolves.toBe(expected);
    await expect(toMarkdown(fragment, { path: 'tables.html' })).resolves.toBe(expected);
  });

  it('converts a heading, paragraph, and link', async () => {
    const bytes = enc.encode(
      '<html><h1>Title</h1><p>Hello <a href="https://example.com">world</a></p></html>',
    );
    await expect(toMarkdown(bytes)).resolves.toBe(
      '# Title\n\nHello [world](https://example.com)\n',
    );
  });

  it('keeps a code fence language from class names', async () => {
    await expect(md('<pre><code class="language-js">const x = 1;</code></pre>')).resolves.toBe(
      '```js\nconst x = 1;\n```\n',
    );
    await expect(md('<pre class="hljs lang-rust">fn main() {}</pre>')).resolves.toBe(
      '```rust\nfn main() {}\n```\n',
    );
    await expect(md('<pre class="lang-c language-cpp">int x;</pre>')).resolves.toBe(
      '```cpp\nint x;\n```\n',
    );
  });

  it('keeps relative and absolute image urls', async () => {
    await expect(md('<p><img alt="logo" src="images/logo.png"></p>')).resolves.toBe(
      '![logo](images/logo.png)\n',
    );
    await expect(md('<p><img alt="abs" src="https://example.com/a.png"></p>')).resolves.toBe(
      '![abs](https://example.com/a.png)\n',
    );
  });

  it('ingests data-uri images instead of emitting them', async () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const out = await md(`<p>Hi <img alt="dot" src="data:image/png;base64,${png}"></p>`);
    expect(out).toBe('Hi dot\n');
    expect(out).not.toContain('data:');
    expect(out).not.toContain(png);
    const bad = await md('<p>Hi <img src="data:image/png;base64,not-valid"></p>');
    expect(bad).toBe('Hi\n');
    expect(bad).not.toContain('data:');
    const svg = await md('<p><img alt="icon" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></p>');
    expect(svg).toBe('icon\n');
    expect(svg).not.toContain('data:');
  });

  it('converts lists, tables, and css strike', async () => {
    const out = await md(
      '<style>.s{text-decoration:line-through}</style><ul><li>one</li></ul><table><tr><th>H</th></tr><tr><td>v</td></tr></table><p class="s">old</p>',
    );
    expect(out).toBe('- one\n\n| H |\n| --- |\n| v |\n\n~~old~~\n');
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
  let i = 0;
  for (const local of locals) {
    out.set(local, i);
    i += local.length;
  }
  for (const central of centrals) {
    out.set(central, i);
    i += central.length;
  }
  out.set(eocd, i);
  return out;
}
