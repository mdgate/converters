import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';

function pagePdf(content: string, mediaBox = [0, 0, 200, 100]): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(' ')}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
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

describe('text matrix layout', () => {
  it('keeps identity Tm + Td in reading order', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Hello) Tj
30 0 Td
(World) Tj
ET
`),
    );
    expect(md).toContain('Hello');
    expect(md).toContain('World');
    expect(md.indexOf('Hello')).toBeLessThan(md.indexOf('World'));
  });

  it('scales Td/TD through a WPS-style Tm instead of treating offsets as page units', () => {
    // Tf 240 + Tm scale 0.05 → 12pt. TD 240 is one em in text space (12 page units),
    // not 240 page units. Adding the raw offset scrambles "2023" into "23…02".
    const md = toMarkdownFromPdf(
      pagePdf(
        `q
1 0 0 -1 0 100 cm
BT
/F1 240 Tf
0.05 0 0 -0.05 20 30 Tm
(2) Tj
240 0 TD
(0) Tj
240 0 TD
(2) Tj
ET
BT
/F1 240 Tf
0.05 0 0 -0.05 56 30 Tm
(3) Tj
ET
Q
`,
      ),
    );
    expect(md.replace(/\s+/g, '')).toContain('2023');
    expect(md.replace(/\s+/g, '')).not.toMatch(/23.*02/);
  });

  it('includes cm translation when combining Tm with the CTM', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 30 Tm
(Bottom) Tj
ET
q
1 0 0 1 0 50 cm
BT
/F1 12 Tf
1 0 0 1 20 20 Tm
(Top) Tj
ET
Q
`),
    );
    expect(md.indexOf('Top')).toBeLessThan(md.indexOf('Bottom'));
  });
});
