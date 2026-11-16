import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';

// A delimiter that cannot start a value at its position (a stray `]`, `}`, `)` or lone `>`) used to
// be left unconsumed, so the dict, array and content-stream loops spun on it forever. Headless
// Chrome occasionally writes such a PDF, with bytes spliced into a font's /Widths array.

function buildPdf(fontEntries: string, contentTail: string): Uint8Array {
  const content = `BT /F1 12 Tf 1 0 0 1 20 50 Tm (Hello stray) Tj ET${contentTail}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${fontEntries} >>`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('stray delimiters', () => {
  it.each([
    ['a stray ] in a dict', '/FirstChar 32 /LastChar 34 /Widths [278 0 0] 0 1000]', ''],
    ['a stray } in a dict', '/FirstChar 32 } /LastChar 32', ''],
    ['a stray ) in a dict', '/FirstChar 32 ) /LastChar 32', ''],
    ['a lone > in a dict', '/FirstChar 32 > /LastChar 32', ''],
    ['a stray } in an array', '/Widths [278 } 0]', ''],
    ['a stray } in a content stream', '', ' } '],
    ['a stray ] in a content stream', '', ' ] '],
  ])('converts a PDF with %s', async (_name, fontEntries, contentTail) => {
    const md = await toMarkdownFromPdf(buildPdf(fontEntries, contentTail));
    expect(md).toContain('Hello stray');
  });
});
