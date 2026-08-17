import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMarkdown as csvToMarkdown } from '@mdgate/csv';
import { toMarkdown as docxToMarkdown } from '@mdgate/docx';
import { toMarkdown as pdfToMarkdown } from '@mdgate/pdf';
import { toMarkdown as rtfToMarkdown } from '@mdgate/rtf';
import { describe, expect, it } from 'vitest';

const FIXTURES = join(fileURLToPath(new URL('./fixtures', import.meta.url)));

function fixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, rel)));
}

describe('single-format toMarkdown', () => {
  it('converts its own format', async () => {
    expect(await docxToMarkdown(fixture('docx/text.docx'))).toContain('#');
    expect(await rtfToMarkdown(fixture('rtf/text.rtf'))).not.toBe('');
    expect(await pdfToMarkdown(fixture('pdf/text.pdf'))).not.toBe('');
    expect(await csvToMarkdown(fixture('csv/sheet.csv'), { path: 'sheet.csv' })).toContain('|');
  });

  it('refuses other formats instead of guessing', async () => {
    await expect(docxToMarkdown(fixture('pdf/text.pdf'))).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(rtfToMarkdown(fixture('docx/text.docx'))).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('lets content outrank a lying extension', async () => {
    // RTF bytes wearing a .doc name must still convert as RTF.
    const rtfBytes = fixture('rtf/text.rtf');
    const viaRtf = await rtfToMarkdown(rtfBytes, { path: 'legacy.doc' });
    expect(viaRtf).not.toBe('');
  });
});
