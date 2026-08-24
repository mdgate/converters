import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { pdf } from '../src/converter.js';
import { toMarkdownFromPdf } from '../src/pdf.js';

function buildPdf(objects: string[]): Uint8Array {
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

function helloPdf(): Uint8Array {
  return buildPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 1 0 0 1 20 50 Tm (Hello) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]);
}

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

function u16be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 8) & 255, n & 255);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('open issue fixtures', () => {
  it('returns malformed for a cyclic /Pages tree instead of overflowing', () => {
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 >>\nendobj\n',
    ]);
    expect(() => toMarkdownFromPdf(bytes)).toThrowError(ConvertError);
    try {
      toMarkdownFromPdf(bytes);
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('malformed');
    }
  });

  it('unwraps an AppleSingle data fork that holds a PDF', () => {
    const inner = helloPdf();
    const header = concat([
      u32be(0x00051600),
      u32be(0x00020000),
      new Uint8Array(16),
      u16be(1),
      u32be(1),
      u32be(26 + 12),
      u32be(inner.length),
    ]);
    const wrapped = concat([header, inner]);
    expect(toMarkdownFromPdf(wrapped)).toContain('Hello');
    expect(pdf().sniff(wrapped, { path: 'testAppleSingleFile.pdf' })).toBe(2);
  });

  it('uses the full stream when /Length is too short', () => {
    const content = `BT
/F1 12 Tf
1 0 0 1 20 80 Tm
(Hello) Tj
0 -20 Td
(World) Tj
ET
`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length 20 >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ]);
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('Hello');
    expect(md).toContain('World');
  });

  it('reads Type0 Encoding /V JIS bytes', () => {
    const content = `BT /F2 12 Tf 1 0 0 1 20 50 Tm ($"$$$&$\\($*) Tj ET\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F2 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      `5 0 obj
<< /Type /Font /Subtype /Type0 /BaseFont /Ryumin-Light-V /Encoding /V
   /DescendantFonts [6 0 R] >>
endobj
`,
      `6 0 obj
<< /Type /Font /Subtype /CIDFontType0
   /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 1 >> >>
endobj
`,
    ]);
    expect(toMarkdownFromPdf(bytes)).toContain('あいうえお');
  });

  it('decodes GBK bytes on a WinAnsi CJK-named simple font', () => {
    const content = `BT /F1 12 Tf 1 0 0 1 20 50 Tm <d6d0cec4> Tj ET\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /SimSun_GB2312 /Encoding /WinAnsiEncoding /FirstChar 0 /LastChar 255 >>\nendobj\n',
    ]);
    expect(toMarkdownFromPdf(bytes)).toContain('中文');
  });

  it('emits widget and popup annotation values', () => {
    const content = 'BT /F1 12 Tf 1 0 0 1 20 80 Tm (Label) Tj ET\n';
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] >> >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Annots [6 0 R 7 0 R] /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      '6 0 obj\n<< /Type /Annot /Subtype /Widget /T (Check) /V (Yes) /Rect [20 20 80 40] >>\nendobj\n',
      '7 0 obj\n<< /Type /Annot /Subtype /Text /Contents (this is the note) /Rect [20 50 80 70] >>\nendobj\n',
    ]);
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('Label');
    expect(md).toContain('Yes');
    expect(md).toContain('this is the note');
  });

  it('reads PDF 2.0 UTF-8 annotation text', () => {
    const thai = new TextEncoder().encode('ไฮไลต์ข้อความ');
    const contents = `<${[...thai].map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Annots [4 0 R] >>\nendobj\n`,
      `4 0 obj\n<< /Type /Annot /Subtype /Highlight /Contents ${contents} /Rect [10 10 80 40] >>\nendobj\n`,
    ]);
    expect(toMarkdownFromPdf(bytes)).toContain('ไฮไลต์ข้อความ');
  });

  it('sniffs XFDF and emits field names', () => {
    const xfdf = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">
  <fields>
    <field name="CheckBox1"></field>
  </fields>
</xfdf>
`);
    expect(pdf().sniff(xfdf, { path: 'testXFDF.xfdf' })).toBe(2);
    expect(toMarkdownFromPdf(xfdf)).toContain('CheckBox1');
  });

  it('ignores /Encrypt when streams use the Identity filter', () => {
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 1 0 0 1 20 50 Tm (Hello) Tj ET\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `6 0 obj
<< /Filter /Standard /V 5 /R 6 /Length 256 /P -4
   /O <000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f>
   /U <000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f>
   /CF << /StdCF << /AuthEvent /EFOpen /CFM /AESV3 /Length 32 >> >>
   /StmF /Identity /StrF /Identity >>
endobj
`,
    ]);
    const withEnc = new TextEncoder().encode(
      new TextDecoder('latin1')
        .decode(bytes)
        .replace(
          '/Root 1 0 R >>',
          '/Root 1 0 R /Encrypt 6 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] >>',
        ),
    );
    expect(toMarkdownFromPdf(withEnc)).toContain('Hello');
  });
});
