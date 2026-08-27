import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';

function pagePdf(content: string, mediaBox = [0, 0, 300, 200], encoding = ''): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(' ')}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica${encoding} >>\nendobj\n`,
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

describe('PDF math layout', () => {
  it('keeps a stacked fraction as text instead of a table', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 180 Tm (A mechanical system is described by a Lagrangian.) Tj
1 0 0 1 20 160 Tm (Traditionally the Lagrange equations are written) Tj
/F1 10 Tf
1 0 0 1 40 118 Tm (d) Tj
1 0 0 1 58 118 Tm (L) Tj
1 0 0 1 90 118 Tm (L) Tj
1 0 0 1 74 110 Tm (-) Tj
1 0 0 1 108 108 Tm (=) Tj
1 0 0 1 120 108 Tm (0.) Tj
1 0 0 1 38 104 Tm (dt) Tj
1 0 0 1 56 104 Tm (q) Tj
1 0 0 1 88 104 Tm (q) Tj
/F1 12 Tf
1 0 0 1 20 70 Tm (What could this expression possibly mean?) Tj
1 0 0 1 20 50 Tm (Let us try to write a program that implements them.) Tj
ET
`,
        [0, 0, 300, 200],
      ),
    );
    expect(md).not.toMatch(/\|---\|/);
    expect(md.replace(/\s+/g, '')).toContain('d/dt');
    expect(md).toContain('What could this expression possibly mean?');
  });

  it('attaches a letter exponent to its base', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 40 80 Tm (h) Tj
/F1 8 Tf
1 0 0 1 48 86 Tm (p) Tj
/F1 12 Tf
1 0 0 1 56 80 Tm (+) Tj
1 0 0 1 68 80 Tm (O) Tj
ET
`,
      ),
    );
    expect(md).toContain('hᵖ');
    expect(md).not.toMatch(/\|---\|/);
  });

  it('remaps a superior digit to subscript when the run sits below the baseline', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 40 80 Tm (H) Tj
/F1 8 Tf
1 0 0 1 48 74 Tm (\\262) Tj
ET
`,
        [0, 0, 300, 200],
        ' /Encoding /WinAnsiEncoding',
      ),
    );
    expect(md).toContain('H₂');
    expect(md).not.toContain('H²');
  });

  it('attaches p+1 as a superscript run', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 40 80 Tm (h) Tj
/F1 8 Tf
1 0 0 1 48 86 Tm (p) Tj
1 0 0 1 54 86 Tm (+) Tj
1 0 0 1 60 86 Tm (1) Tj
ET
`,
      ),
    );
    expect(md.replace(/\s+/g, '')).toContain('hᵖ⁺¹');
  });

  it('does not emit an equation number as a heading', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 160 Tm (As an example the forward-difference method is considered.) Tj
1 0 0 1 40 110 Tm (f) Tj
1 0 0 1 48 110 Tm (x) Tj
1 0 0 1 90 80 Tm (\\(3.18\\)) Tj
1 0 0 1 20 40 Tm (The next paragraph continues after the number.) Tj
ET
`,
        [0, 0, 300, 200],
      ),
    );
    expect(md).not.toMatch(/^#{1,6} \(?3\.18\)?/m);
    expect(md).toContain('(3.18)');
  });

  it('does not emit a lowercase lead-in as a heading', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 160 Tm (The derivative can be written one way) Tj
1 0 0 1 20 90 Tm (or inversely) Tj
1 0 0 1 20 40 Tm (as a function of the original path.) Tj
ET
`,
        [0, 0, 300, 200],
      ),
    );
    expect(md).not.toMatch(/^#{1,6} or inversely/m);
    expect(md).toContain('or inversely');
  });

  it('keeps a same-size hyphen as a hyphen, not a superscript', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 80 Tm (unam) Tj
1 0 0 1 50 80 Tm (-) Tj
1 0 0 1 58 80 Tm (biguously) Tj
ET
`,
      ),
    );
    expect(md).not.toContain('⁻');
    expect(md).toMatch(/unam-?\s*biguously/);
  });

  it('does not emit a colon lead-in as a heading', () => {
    const md = toMarkdownFromPdf(
      pagePdf(
        `BT
/F1 12 Tf
1 0 0 1 20 160 Tm (Rearranging Equation) Tj
1 0 0 1 20 90 Tm (Using Gamma we can write:) Tj
1 0 0 1 20 40 Tm (the Lagrange equation in functional form.) Tj
ET
`,
        [0, 0, 300, 200],
      ),
    );
    expect(md).not.toMatch(/^#{1,6} Using Gamma we can write:/m);
    expect(md).toContain('Using Gamma we can write:');
  });
});
