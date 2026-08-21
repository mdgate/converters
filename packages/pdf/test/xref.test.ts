import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';

function concatParts(parts: Array<string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const bins = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  let n = 0;
  for (const b of bins) n += b.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const b of bins) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** Linearized-style PDF 1.5: Catalog lives in an ObjStm; no `trailer` keyword. */
function buildXrefStreamPdf(): Uint8Array {
  const pageContent = 'BT /F1 12 Tf 1 0 0 1 20 50 Tm (ObjStm Hello) Tj ET\n';
  const catalogObj = '<< /Type /Catalog /Pages 2 0 R >>\n';
  const pagesObj = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n';
  const stmHeader = `1 0 2 ${catalogObj.length}\n`;
  const stmBody = `${stmHeader}${catalogObj}${pagesObj}`;
  const parts: string[] = [
    '%PDF-1.5\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `6 0 obj\n<< /Type /ObjStm /N 2 /First ${stmHeader.length} /Length ${stmBody.length} >>\nstream\n${stmBody}endstream\nendobj\n`,
  ];
  let size = 0;
  const offsets = new Map<number, number>();
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.startsWith('%')) {
      chunks.push(part);
      size += part.length;
      continue;
    }
    const num = Number(part.slice(0, part.indexOf(' ')));
    offsets.set(num, size);
    chunks.push(part);
    size += part.length;
  }
  const w = [1, 2, 1];
  const entrySize = 4;
  const count = 8;
  const table = new Uint8Array(count * entrySize);
  const write = (num: number, type: number, field2: number, field3: number): void => {
    const at = num * entrySize;
    table[at] = type;
    table[at + 1] = (field2 >> 8) & 0xff;
    table[at + 2] = field2 & 0xff;
    table[at + 3] = field3 & 0xff;
  };
  write(3, 1, offsets.get(3) ?? 0, 0);
  write(4, 1, offsets.get(4) ?? 0, 0);
  write(5, 1, offsets.get(5) ?? 0, 0);
  write(6, 1, offsets.get(6) ?? 0, 0);
  write(1, 2, 6, 0);
  write(2, 2, 6, 1);
  const xref = `7 0 obj\n<< /Type /XRef /Size ${count} /W [${w.join(' ')}] /Root 1 0 R /Index [0 ${count}] /Length ${table.length} >>\nstream\n`;
  const xrefAt = size;
  const tail = '\nendstream\nendobj\n';
  const startxref = `startxref\n${xrefAt}\n%%EOF\n`;
  return concatParts([...chunks, xref, table, tail, startxref]);
}

describe('pdf xref stream and object streams', () => {
  it('finds Catalog inside an ObjStm when the file has no trailer keyword', () => {
    const md = toMarkdownFromPdf(buildXrefStreamPdf());
    expect(md).toContain('ObjStm Hello');
  });

  it('does not throw unsupported for an empty well-formed page', () => {
    const bytes = concatParts([
      '%PDF-1.4\n',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Contents 4 0 R >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
    ]);
    expect(toMarkdownFromPdf(bytes)).toBe('');
  });
});
