import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { odf, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();
const FIXTURE_SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixture-src');

const FLAT_TEXT = `<?xml version="1.0"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">Hello Flat</text:h>
      <text:p>A paragraph.</text:p>
    </office:text>
  </office:body>
</office:document>`;

const FLAT_DRAWING = `<?xml version="1.0"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
  <office:body>
    <office:drawing>
      <draw:page>
        <draw:frame>
          <draw:text-box>
            <text:h text:outline-level="1">Drawing Title</text:h>
            <text:p>Shape text.</text:p>
          </draw:text-box>
        </draw:frame>
      </draw:page>
    </office:drawing>
  </office:body>
</office:document>`;

describe('odf', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = odf();
    expect(converter.id).toBe('odf');
    expect(converter.sniff(enc.encode(FLAT_TEXT))).toBe(2);
    expect(
      converter.sniff(
        enc.encode(
          '<?xml version="1.0"?><root xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></root>',
        ),
      ),
    ).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'pic.odg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.fodt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'tmpl.ott' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.ots' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
  });

  it('converts flat text and drawing XML', async () => {
    await expect(toMarkdown(enc.encode(FLAT_TEXT))).resolves.toBe('# Hello Flat\n\nA paragraph.\n');
    const drawing = await toMarkdown(enc.encode(FLAT_DRAWING), { path: 'sketch.fodg' });
    expect(drawing).toContain('# Drawing Title');
    expect(drawing).toContain('Shape text.');

    const fodt = readFileSync(join(FIXTURE_SRC, 'text.fodt'));
    const fromFixture = await toMarkdown(fodt, { path: 'text.fodt' });
    expect(fromFixture).toContain('# Fixture Document');
    expect(fromFixture).toContain('Plain paragraph');
  });

  it('refuses a PDF', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.odt' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => odf().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
  });
});
