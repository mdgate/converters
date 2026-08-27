import { describe, expect, it } from 'vitest';
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

function pagePdf(
  content: string,
  opts: { mediaBox?: number[]; cropBox?: number[]; pagesMediaBox?: number[] } = {},
): Uint8Array {
  const mediaBox = opts.mediaBox ?? [0, 0, 200, 100];
  const crop = opts.cropBox ? ` /CropBox [${opts.cropBox.join(' ')}]` : '';
  const pageMedia = opts.pagesMediaBox ? '' : ` /MediaBox [${mediaBox.join(' ')}]`;
  const pagesMedia = opts.pagesMediaBox ? ` /MediaBox [${opts.pagesMediaBox.join(' ')}]` : '';
  return buildPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1${pagesMedia} >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R${pageMedia}${crop} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]);
}

describe('visible-region clipping', () => {
  it('drops text outside the MediaBox', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Visible) Tj
1 0 0 1 250 50 Tm
(Offpage) Tj
1 0 0 1 20 -40 Tm
(Below) Tj
ET
`),
    );
    expect(md).toContain('Visible');
    expect(md).not.toContain('Offpage');
    expect(md).not.toContain('Below');
  });

  it('clips to CropBox when it is smaller than MediaBox', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Inside) Tj
1 0 0 1 250 50 Tm
(Margin) Tj
ET
`,
        { mediaBox: [0, 0, 400, 100], cropBox: [0, 0, 200, 100] },
      ),
    );
    expect(md).toContain('Inside');
    expect(md).not.toContain('Margin');
  });

  it('inherits MediaBox from the parent Pages node', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Inside) Tj
1 0 0 1 250 50 Tm
(Offpage) Tj
ET
`,
        { pagesMediaBox: [0, 0, 200, 100] },
      ),
    );
    expect(md).toContain('Inside');
    expect(md).not.toContain('Offpage');
  });

  it('drops text outside a W clip even when it is inside the crop box', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`q
0 0 80 100 re
W n
BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Kept) Tj
1 0 0 1 120 50 Tm
(Clipped) Tj
ET
Q
`),
    );
    expect(md).toContain('Kept');
    expect(md).not.toContain('Clipped');
  });

  it('restores the clip after Q so later text is visible', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`q
0 0 80 100 re
W n
BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Kept) Tj
ET
Q
BT
/F1 12 Tf
1 0 0 1 120 50 Tm
(After) Tj
ET
`),
    );
    expect(md).toContain('Kept');
    expect(md).toContain('After');
  });

  it('drops leftover adjacent-page text behind nested W clips', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `q
0 0 200 100 re
W n
BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(Onpage) Tj
ET
Q
q
0 0 200 100 re
W n
q
200 0 200 100 re
W n
BT
/F1 12 Tf
1 0 0 1 220 50 Tm
(Nextpage) Tj
1 0 0 1 220 80 Tm
(6.Conclusion) Tj
ET
Q
Q
`,
        { mediaBox: [0, 0, 200, 100] },
      ),
    );
    expect(md).toContain('Onpage');
    expect(md).not.toContain('Nextpage');
    expect(md).not.toContain('Conclusion');
  });

  it('normalizes a negative-height re clip', () => {
    const md = toMarkdownFromPdf(
      pagePdf(`q
100 90 50 -40 re
W n
BT
/F1 12 Tf
1 0 0 1 110 60 Tm
(Inclip) Tj
1 0 0 1 20 60 Tm
(Outclip) Tj
ET
Q
`),
    );
    expect(md).toContain('Inclip');
    expect(md).not.toContain('Outclip');
  });

  it('clips form XObject text to the form BBox', () => {
    const formContent = `BT
/F1 12 Tf
1 0 0 1 10 20 Tm
(FormIn) Tj
1 0 0 1 80 20 Tm
(FormOut) Tj
ET
`;
    const pageContent = '/Fm1 Do\n';
    const md = toMarkdownFromPdf(
      buildPdf([
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Fm1 6 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 50 50] /Resources << /Font << /F1 5 0 R >> >> /Length ${formContent.length} >>\nstream\n${formContent}endstream\nendobj\n`,
      ]),
    );
    expect(md).toContain('FormIn');
    expect(md).not.toContain('FormOut');
  });

  it('keeps on-page appearance text when CropBox does not overlap the form BBox', () => {
    const formContent = `BT
/F1 12 Tf
1 0 0 1 10 20 Tm
(WidgetLabel) Tj
ET
`;
    const pageContent = 'BT /F1 12 Tf 1 0 0 1 220 360 Tm (PageText) Tj ET\n';
    const md = toMarkdownFromPdf(
      buildPdf([
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /CropBox [200 200 400 400] /Contents 4 0 R /Annots [6 0 R] /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        '6 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [220 220 300 280] /AP << /N 7 0 R >> >>\nendobj\n',
        `7 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 80 60] /Resources << /Font << /F1 5 0 R >> >> /Length ${formContent.length} >>\nstream\n${formContent}endstream\nendobj\n`,
      ]),
    );
    expect(md).toContain('PageText');
    expect(md).toContain('WidgetLabel');
  });

  it('drops off-page appearance text even when form-space coords sit inside the page box', () => {
    const formContent = `BT
/F1 12 Tf
1 0 0 1 10 20 Tm
(OffpageAnnot) Tj
ET
`;
    const pageContent = 'BT /F1 12 Tf 1 0 0 1 20 50 Tm (PageText) Tj ET\n';
    const md = toMarkdownFromPdf(
      buildPdf([
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Annots [6 0 R] /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        '6 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [250 20 330 50] /AP << /N 7 0 R >> >>\nendobj\n',
        `7 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 80 40] /Resources << /Font << /F1 5 0 R >> >> /Length ${formContent.length} >>\nstream\n${formContent}endstream\nendobj\n`,
      ]),
    );
    expect(md).toContain('PageText');
    expect(md).not.toContain('OffpageAnnot');
  });
});
