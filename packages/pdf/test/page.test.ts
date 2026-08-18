import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { pdf, toMarkdown } from '../src/index.js';
import { toMarkdownFromPdf } from '../src/pdf.js';

function twoPagePdf(page1: string, page2: string): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${page1.length} >>\nstream\n${page1}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `7 0 obj\n<< /Length ${page2.length} >>\nstream\n${page2}endstream\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function textPage(text: string): string {
  return `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(${text}) Tj
ET
`;
}

describe('hint.page', () => {
  const bytes = twoPagePdf(textPage('Alpha'), textPage('Beta'));

  it('converts every page when page is omitted', () => {
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('Alpha');
    expect(md).toContain('Beta');
  });

  it('keeps only the requested page', async () => {
    expect(toMarkdownFromPdf(bytes, undefined, 1)).toContain('Alpha');
    expect(toMarkdownFromPdf(bytes, undefined, 1)).not.toContain('Beta');
    expect(toMarkdownFromPdf(bytes, undefined, 2)).toContain('Beta');
    expect(toMarkdownFromPdf(bytes, undefined, 2)).not.toContain('Alpha');
    await expect(toMarkdown(bytes, { page: 1 })).resolves.toContain('Alpha');
    await expect(toMarkdown(bytes, { page: 1 })).resolves.not.toContain('Beta');
  });

  it('throws unsupported for a page outside the file', () => {
    const converter = pdf();
    expect(() => toMarkdownFromPdf(bytes, undefined, 3)).toThrow(ConvertError);
    expect(() => toMarkdownFromPdf(bytes, undefined, 0)).toThrow(ConvertError);
    try {
      converter.convert(bytes, { page: 3 });
      throw new Error('expected unsupported');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('unsupported');
    }
  });
});
