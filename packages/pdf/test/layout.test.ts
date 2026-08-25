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

  it('keeps form header text but drops header rules so they do not become a table', () => {
    const formContent = `BT
/F1 12 Tf
1 0 0 1 20 120 Tm
(YARROW) Tj
1 0 0 1 22 82 Tm
(a b c d e f g) Tj
1 0 0 1 80 82 Tm
(h i j k l m n) Tj
1 0 0 1 22 52 Tm
(o p q r s t u) Tj
1 0 0 1 80 52 Tm
(v w x y z a b) Tj
ET
20 90 160 1 re S
20 70 160 1 re S
20 40 160 1 re S
20 40 1 50 re S
70 40 1 50 re S
180 40 1 50 re S
`;
    const formPdf = (pageContent: string): Uint8Array => {
      const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 140] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Fm1 6 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 220 140] /Resources << /Font << /F1 5 0 R >> >> /Length ${formContent.length} >>\nstream\n${formContent}endstream\nendobj\n`,
      ];
      let pdf = '%PDF-1.4\n';
      const offsets = [0];
      for (const obj of objects) {
        offsets.push(pdf.length);
        pdf += obj;
      }
      const xrefAt = pdf.length;
      let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= objects.length; i += 1) {
        xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
      }
      pdf += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
      return new TextEncoder().encode(pdf);
    };

    const leaked = toMarkdownFromPdf(formPdf('/Fm1 Do\n'));
    expect(leaked).toMatch(/\|---\|/);

    const md = toMarkdownFromPdf(
      formPdf(`/Artifact << /O /Layout >> BDC
/Fm1 Do
EMC
`),
    );
    expect(md).toContain('YARROW');
    expect(md).toContain('a b c d e f g');
    expect(md).not.toMatch(/\|---\|/);
  });
});

describe('paragraph breaks', () => {
  it('splits book-style first-line indents at the same line spacing', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 220 Tm
(The first paragraph has enough words to stay body text on this line) Tj
1 0 0 1 20 205 Tm
(and it finishes without a larger gap before the next one.) Tj
1 0 0 1 32 190 Tm
(The second paragraph starts with a first-line indent and continues) Tj
1 0 0 1 20 175 Tm
(on the following line back at the left margin of the column.) Tj
ET
`,
        [0, 0, 420, 260],
      ),
    );
    expect(md).toMatch(/next one\.\n\nThe second paragraph/);
    expect(md).not.toMatch(/next one\. The second paragraph/);
  });

  it('keeps a hanging marker with its indented body', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 220 Tm
(The notes section has enough words to stay ordinary body text here.) Tj
1 0 0 1 20 205 Tm
(i) Tj
1 0 0 1 32 190 Tm
(Endnote body text that belongs with the marker above it.) Tj
ET
`,
        [0, 0, 420, 260],
      ),
    );
    expect(md).toMatch(/i Endnote body text/);
    expect(md).not.toMatch(/i\n\nEndnote body text/);
  });

  it('keeps wrapped lines at the same left edge as one paragraph', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 220 Tm
(The first wrapped line has enough words to remain ordinary body text) Tj
1 0 0 1 20 205 Tm
(and the second wrapped line continues the same paragraph without a break) Tj
1 0 0 1 20 190 Tm
(and a third line still belongs with the sentence that started above.) Tj
ET
`,
        [0, 0, 420, 260],
      ),
    );
    expect(md).toMatch(/body text and the second wrapped line/);
    expect(md).not.toMatch(/body text\n\n/);
  });

  it('splits body paragraphs separated by an empty spacer line', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 220 Tm
(The opening paragraph has enough words to stay ordinary body text here) Tj
1 0 0 1 20 205 Tm
(and it ends just before a blank spacer that the PDF still paints.) Tj
1 0 0 1 20 190 Tm
( ) Tj
1 0 0 1 20 175 Tm
(The next paragraph should not be joined onto that previous sentence.) Tj
ET
`,
        [0, 0, 420, 260],
      ),
    );
    expect(md).toMatch(/paints\.\n\nThe next paragraph/);
    expect(md).not.toMatch(/paints\. The next paragraph/);
  });

  it('does not glue the next paragraph onto the last list item', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 220 Tm
(• A list item with enough words to wrap onto the following line) Tj
1 0 0 1 32 205 Tm
(and then a wrapped continuation of that same list item.) Tj
1 0 0 1 20 180 Tm
(After the list a new paragraph starts with many words of body text.) Tj
ET
`,
        [0, 0, 420, 260],
      ),
    );
    expect(md).toMatch(/list item\.\n\nAfter the list/);
    expect(md).not.toMatch(/list item\. After the list/);
  });
});
