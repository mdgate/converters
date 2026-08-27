import { describe, expect, it } from 'vitest';
import { reattachDropCaps } from '../src/layout.js';
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

  it('uses marked-content ActualText instead of the shown glyphs', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 90 Tm
(3) Tj
/Span << /ActualText <FEFF0031> >> BDC
(x) Tj
EMC
(4) Tj
ET
`),
    );
    expect(md).toContain('314');
    expect(md).not.toContain('3x4');
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

describe('footnotes', () => {
  it('attaches a raised digit after punctuation instead of dropping it into the next line', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 220 Tm
(from FY2019.) Tj
/F1 7 Tf
4 Ts
(4) Tj
0 Ts
/F1 12 Tf
( The data collected after implementation) Tj
1 0 0 1 20 200 Tm
(of the FIT scheme revealed the costs.) Tj
/F1 8 Tf
1 0 0 1 20 40 Tm
(4 Biomass of waste is not eligible from FY2021.) Tj
ET
`,
        [0, 0, 420, 280],
      ),
    );
    expect(md).toContain('FY2019.⁴');
    expect(md).not.toMatch(/implementation 4 of/);
    expect(md).toMatch(/costs\.\n\n4 Biomass of waste/);
  });

  it('reads two-column notes after both columns of body, not mixed into the other column', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 240 Tm
(Alpha) Tj
1 0 0 1 20 220 Tm
(Bravo) Tj
1 0 0 1 220 240 Tm
(Charlie) Tj
1 0 0 1 220 220 Tm
(Delta) Tj
/F1 8 Tf
1 0 0 1 20 50 Tm
(25 Left note continues here.) Tj
1 0 0 1 20 35 Tm
(26 Left note also continues.) Tj
1 0 0 1 220 50 Tm
(30 Right note continues here.) Tj
1 0 0 1 220 35 Tm
(31 Right note also continues.) Tj
ET
`,
        [0, 0, 420, 280],
      ),
    );
    expect(md.indexOf('Alpha')).toBeLessThan(md.indexOf('Bravo'));
    expect(md.indexOf('Bravo')).toBeLessThan(md.indexOf('Charlie'));
    expect(md.indexOf('Charlie')).toBeLessThan(md.indexOf('Delta'));
    expect(md.indexOf('Delta')).toBeLessThan(md.indexOf('25 Left note'));
    expect(md.indexOf('25 Left note')).toBeLessThan(md.indexOf('26 Left note'));
    expect(md.indexOf('26 Left note')).toBeLessThan(md.indexOf('30 Right note'));
    expect(md).not.toMatch(/Bravo[\s\S]*25 Left note[\s\S]*Charlie/);
    expect(md).toMatch(/25 Left note continues here\.\n\n26 Left note also continues/);
    expect(md).toMatch(/30 Right note continues here\.\n\n31 Right note also continues/);
  });

  it('does not glue footer notes onto the last body paragraph', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 120 Tm
(This report surveys land.) Tj
/F1 7 Tf
4 Ts
(1) Tj
0 Ts
/F1 12 Tf
1 0 0 1 20 100 Tm
(Coverage is selected to stay representative.) Tj
/F1 8 Tf
1 0 0 1 20 40 Tm
(1 The surveyed jurisdictions are listed in the appendix text.) Tj
1 0 0 1 20 25 Tm
(2 World Bank Databank Gross Domestic Product figures.) Tj
ET
`,
        [0, 0, 420, 180],
      ),
    );
    expect(md).toContain('land.¹');
    expect(md).toMatch(/representative\.\n\n1 The surveyed jurisdictions/);
    expect(md).toMatch(/appendix text\.\n\n2 World Bank Databank/);
    expect(md).not.toMatch(/representative\. 1 The surveyed/);
  });

  it('does not glue footer notes onto the last list item', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 200 Tm
(Coverage is selected to stay representative.) Tj
/F1 7 Tf
4 Ts
(1) Tj
0 Ts
/F1 12 Tf
1 0 0 1 20 90 Tm
(- First list item on this page.) Tj
1 0 0 1 20 72 Tm
(- Second list item on this page.) Tj
/F1 8 Tf
1 0 0 1 20 54 Tm
(1 The surveyed jurisdictions are listed in the appendix text.) Tj
ET
`,
        [0, 0, 420, 240],
      ),
    );
    expect(md).toMatch(/Second list item on this page\.\n\n1 The surveyed jurisdictions/);
    expect(md).not.toMatch(/Second list item on this page\. 1 The surveyed/);
  });

  it('does not treat a following note as the next list item', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 200 Tm
(Coverage is selected to stay representative.) Tj
/F1 7 Tf
4 Ts
(1) Tj
0 Ts
/F1 12 Tf
1 0 0 1 20 160 Tm
(1. First list item stays in the body.) Tj
1 0 0 1 20 140 Tm
(2. Second list item stays in the body.) Tj
/F1 8 Tf
1 0 0 1 20 40 Tm
(1. The surveyed jurisdictions are listed in the appendix text.) Tj
ET
`,
        [0, 0, 420, 240],
      ),
    );
    expect(md).toMatch(/stays in the body\.\n\n1\. The surveyed jurisdictions/);
    expect(md).not.toMatch(/stays in the body\.\n1\. The surveyed/);
  });

  it('keeps a raised note marker at the end of the sentence, not prepended', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 160 Tm
(Now, how do we solve for the analytical equilibrium?) Tj
/F1 7 Tf
4 Ts
(12) Tj
0 Ts
/F1 12 Tf
1 0 0 1 20 140 Tm
(Player two applies backward induction to find the equilibrium.) Tj
/F1 8 Tf
1 0 0 1 20 40 Tm
(12. This equilibrium is known as a Perfect Bayesian Equilibrium.) Tj
ET
`,
        [0, 0, 420, 220],
      ),
    );
    expect(md).toContain('equilibrium?¹²');
    expect(md).not.toMatch(/^12 Now,/m);
    expect(md).toMatch(/equilibrium\.\n\n12\. This equilibrium/);
  });
});

describe('drop-caps, ligatures, and false headings', () => {
  it('glues a drop-cap onto the first body line and does not emit it as a heading', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 48 Tf
1 0 0 1 20 50 Tm
(T) Tj
/F1 12 Tf
1 0 0 1 55 82 Tm
(his report defines the scope of this study.) Tj
1 0 0 1 55 66 Tm
(cholesterol that is getting in the way.) Tj
1 0 0 1 55 50 Tm
(the way of doing business continues here.) Tj
ET
`,
        [0, 0, 400, 140],
      ),
    );
    expect(md).toContain('This report defines the scope of this study.');
    expect(md).not.toMatch(/^#{1,6} T\b/m);
    expect(md).not.toMatch(/^#{1,6} This report/m);
    expect(md).not.toMatch(/^#{1,6} cholesterol/m);
    expect(md).not.toMatch(/\bhis report defines/);
  });

  it('does not glue a drop-cap onto a higher right-column line', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 48 Tf
1 0 0 1 20 50 Tm
(T) Tj
/F1 12 Tf
1 0 0 1 55 82 Tm
(his report defines the scope of this study.) Tj
1 0 0 1 55 66 Tm
(cholesterol that is getting in the way.) Tj
1 0 0 1 55 50 Tm
(the way of doing business continues here.) Tj
1 0 0 1 240 90 Tm
(Right column starts at the top of the page.) Tj
1 0 0 1 240 74 Tm
(It must not receive the drop-cap letter.) Tj
ET
`,
        [0, 0, 420, 140],
      ),
    );
    expect(md).toContain('This report defines the scope of this study.');
    expect(md).toContain('Right column starts at the top of the page.');
    expect(md).not.toMatch(/TRight column/);
    expect(md).not.toMatch(/\bhis report defines/);
  });

  it('does not glue a drop-cap onto a higher line that starts farther right', () => {
    const drop = {
      text: 'T',
      x: 20,
      y: 50,
      width: 28,
      height: 48,
      fontSize: 48,
      page: 1,
    };
    const farther = {
      text: 'Earlier paragraph still overlaps the cap.',
      x: 80,
      y: 90,
      width: 200,
      height: 12,
      fontSize: 12,
      page: 1,
    };
    const first = {
      text: 'his report defines the scope of this study.',
      x: 55,
      y: 82,
      width: 200,
      height: 12,
      fontSize: 12,
      page: 1,
    };
    const wrap = {
      text: 'cholesterol that is getting in the way.',
      x: 55,
      y: 66,
      width: 180,
      height: 12,
      fontSize: 12,
      page: 1,
    };
    const texts = reattachDropCaps([[farther], [drop], [first], [wrap]]).map((line) =>
      line.map((t) => t.text).join(''),
    );
    expect(texts.some((t) => t.startsWith('This report'))).toBe(true);
    expect(texts).toContain('Earlier paragraph still overlaps the cap.');
    expect(texts.some((t) => t.startsWith('TEarlier'))).toBe(false);
  });

  it('still emits a larger title as a heading', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 24 Tf
1 0 0 1 20 160 Tm
(Executive Summary) Tj
/F1 12 Tf
1 0 0 1 20 120 Tm
(India suffers from regulatory cholesterol that is getting in the way of doing business across the union.) Tj
1 0 0 1 20 100 Tm
(The presence of hostile clauses in these laws has grown since independence and still shapes the rules.) Tj
1 0 0 1 20 80 Tm
(These changes in compliance requirements occur constantly and add to business uncertainty every year.) Tj
ET
`,
        [0, 0, 500, 200],
      ),
    );
    expect(md).toMatch(/^#{1,6} Executive Summary/m);
    expect(md).toContain('India suffers from regulatory cholesterol');
  });

  it('inserts a word space from a large negative TJ adjustment', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 50 Tm
[(SOLAR) -250 (10.7B:) -250 (Scaling) -250 (Language)] TJ
ET
`),
    );
    expect(md).toContain('SOLAR 10.7B: Scaling Language');
    expect(md).not.toContain('SOLAR10.7B');
  });

  it('does not promote wrapped body to a heading when notes use a smaller font', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 11 Tf
1 0 0 1 200 160 Tm
(Peninsula to Europe, where they were customarily) Tj
1 0 0 1 200 140 Tm
(used in tinctures, purges, and other more or less) Tj
1 0 0 1 200 120 Tm
(effective elixirs after the plants reached the west.) Tj
/F1 9 Tf
1 0 0 1 20 80 Tm
(34 Richard Walker, Memoirs of Medicine including a sketch of medical history from the earliest accounts.) Tj
1 0 0 1 20 64 Tm
(35 For the influence of the Arabian medicine on Western Europe, see volume three of the treatise.) Tj
1 0 0 1 20 48 Tm
(36 Incense was used for its love-inducing and rejuvenating properties in later etchings.) Tj
ET
`,
        [0, 0, 420, 200],
      ),
    );
    expect(md).not.toMatch(/^#{1,6} Peninsula/m);
    expect(md).toContain('Peninsula to Europe, where they were customarily');
  });

  it('inserts a space between a section number and title in TJ', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 14 Tf
1 0 0 1 20 80 Tm
[(1) -1000 (Introduction)] TJ
/F1 12 Tf
1 0 0 1 20 50 Tm
(The field of natural language processing has been transformed.) Tj
ET
`),
    );
    expect(md).toContain('1 Introduction');
    expect(md).not.toContain('1Introduction');
  });
});
