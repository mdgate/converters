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

  it('drops fake-bold glyphs drawn twice at the same point', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Title) Tj
1 0 0 1 20 50 Tm
(Title) Tj
ET
`),
    );
    expect(md.match(/Title/g)).toHaveLength(1);
  });

  it('drops CSS text-shadow copies offset by a fraction of an em', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Index) Tj
1 0 0 1 20.3 50.2 Tm
(Index) Tj
1 0 0 1 19.8 49.9 Tm
(Index) Tj
ET
`),
    );
    expect(md.match(/Index/g)).toHaveLength(1);
  });

  it('keeps two identical characters that sit a full em apart', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(5) Tj
1 0 0 1 32 50 Tm
(5) Tj
ET
`),
    );
    expect(md.replace(/\s+/g, '')).toBe('55');
  });
});

describe('multi-column reading order', () => {
  it('reads a two-column page top-to-bottom per column, not row-by-row', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 90 Tm
(Alpha) Tj
1 0 0 1 20 70 Tm
(Bravo) Tj
1 0 0 1 160 90 Tm
(Charlie) Tj
1 0 0 1 160 70 Tm
(Delta) Tj
ET
`,
        [0, 0, 300, 120],
      ),
    );
    expect(md.indexOf('Alpha')).toBeLessThan(md.indexOf('Bravo'));
    expect(md.indexOf('Bravo')).toBeLessThan(md.indexOf('Charlie'));
    expect(md.indexOf('Charlie')).toBeLessThan(md.indexOf('Delta'));
    expect(md).not.toMatch(/Alpha\s+Charlie/);
  });

  it('keeps a full-width title above both columns', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 110 Tm
(Title Across Both Columns Here) Tj
1 0 0 1 20 80 Tm
(Left one) Tj
1 0 0 1 20 60 Tm
(Left two) Tj
1 0 0 1 170 80 Tm
(Right one) Tj
1 0 0 1 170 60 Tm
(Right two) Tj
ET
`,
        [0, 0, 320, 140],
      ),
    );
    expect(md.indexOf('Title')).toBeLessThan(md.indexOf('Left one'));
    expect(md.indexOf('Left two')).toBeLessThan(md.indexOf('Right one'));
    expect(md.indexOf('Right one')).toBeLessThan(md.indexOf('Right two'));
  });
});

describe('tagged artifacts', () => {
  it('keeps running header and page-number text marked as artifacts', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 90 Tm
/Artifact << /O /Layout >> BDC
(YARROW) Tj
EMC
1 0 0 1 20 50 Tm
(Body paragraph here) Tj
1 0 0 1 180 12 Tm
/Artifact << /Type /Pagination >> BDC
(5) Tj
EMC
ET
`),
    );
    expect(md).toContain('YARROW');
    expect(md).toContain('Body paragraph here');
    expect(md).toContain('5');
    expect(md.indexOf('YARROW')).toBeLessThan(md.indexOf('Body paragraph here'));
    expect(md.indexOf('Body paragraph here')).toBeLessThan(md.indexOf('5'));
  });

  it('keeps a pagination footer and does not drop nested marked content', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`/Artifact << /O /Layout >> BDC
BT
/F1 12 Tf
1 0 0 1 20 90 Tm
(314) Tj
ET
BT
/Span << /Lang (en-GB) >> BDC
/F1 12 Tf
1 0 0 1 50 90 Tm
( ) Tj
EMC
ET
BT
/F1 12 Tf
1 0 0 1 56 90 Tm
(YARROW) Tj
ET
EMC
BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Body paragraph here) Tj
ET
/Artifact << /Type /Pagination /Subtype /Footer >> BDC
BT
/F1 8 Tf
1 0 0 1 20 12 Tm
(PRICE TRANSPARENCY 1) Tj
ET
EMC
`),
    );
    expect(md).toContain('314');
    expect(md).toContain('YARROW');
    expect(md).toContain('Body paragraph here');
    expect(md).toContain('PRICE TRANSPARENCY 1');
  });
});
