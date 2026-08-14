import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';
import { detectTables } from '../src/tables.js';

describe('ruled table detection', () => {
  it('builds a markdown table from a 2×2 line grid', () => {
    const items = [
      { text: 'Name', x: 22, y: 82, width: 30, page: 1 },
      { text: 'Age', x: 82, y: 82, width: 20, page: 1 },
      { text: 'Ada', x: 22, y: 52, width: 20, page: 1 },
      { text: '36', x: 82, y: 52, width: 16, page: 1 },
    ];
    const rects = [
      { x: 20, y: 90, width: 120, height: 1, page: 1 },
      { x: 20, y: 70, width: 120, height: 1, page: 1 },
      { x: 20, y: 40, width: 120, height: 1, page: 1 },
      { x: 20, y: 40, width: 1, height: 50, page: 1 },
      { x: 70, y: 40, width: 1, height: 50, page: 1 },
      { x: 140, y: 40, width: 1, height: 50, page: 1 },
    ];
    const tables = detectTables(items, [], rects);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|Name|Age|');
    expect(tables[0]!.markdown).toContain('|Ada|36|');
    expect(tables[0]!.itemIndices).toHaveLength(4);
  });

  it('keeps sub-1pt ruled borders as grid edges', () => {
    const items = [
      { text: 'A', x: 22, y: 82, width: 10, page: 1 },
      { text: 'B', x: 82, y: 82, width: 10, page: 1 },
      { text: 'C', x: 22, y: 52, width: 10, page: 1 },
      { text: 'D', x: 82, y: 52, width: 10, page: 1 },
    ];
    const rects = [
      { x: 20, y: 90, width: 120, height: 0.7, page: 1 },
      { x: 20, y: 70, width: 120, height: 0.7, page: 1 },
      { x: 20, y: 40, width: 120, height: 0.7, page: 1 },
      { x: 20, y: 40, width: 0.7, height: 50, page: 1 },
      { x: 70, y: 40, width: 0.7, height: 50, page: 1 },
      { x: 140, y: 40, width: 0.7, height: 50, page: 1 },
    ];
    const tables = detectTables(items, [], rects);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|A|B|');
    expect(tables[0]!.markdown).toContain('|C|D|');
  });

  it('leaves flowing prose without a grid as paragraphs', () => {
    const items = [
      { text: 'Hello world this is a paragraph.', x: 20, y: 80, width: 200, page: 1 },
      { text: 'Another line of prose continues here.', x: 20, y: 60, width: 220, page: 1 },
    ];
    expect(detectTables(items, [], [])).toHaveLength(0);
  });
});

function filledPathGridPdf(): Uint8Array {
  const box = (x: number, y: number, w: number, h: number): string =>
    `${x} ${y} m ${x + w} ${y} l ${x + w} ${y + h} l ${x} ${y + h} l h f\n`;
  const content = `BT
/F1 12 Tf
1 0 0 1 24 82 Tm (Name) Tj
1 0 0 1 84 82 Tm (Age) Tj
1 0 0 1 24 52 Tm (Ada) Tj
1 0 0 1 84 52 Tm (36) Tj
ET
${box(20, 90, 120, 1)}${box(20, 70, 120, 1)}${box(20, 40, 120, 1)}${box(20, 40, 1, 50)}${box(70, 40, 1, 50)}${box(140, 40, 1, 50)}`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
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
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function gridPdf(): Uint8Array {
  const content = `BT
/F1 12 Tf
1 0 0 1 24 82 Tm (Name) Tj
1 0 0 1 84 82 Tm (Age) Tj
1 0 0 1 24 52 Tm (Ada) Tj
1 0 0 1 84 52 Tm (36) Tj
ET
20 90 120 1 re S
20 70 120 1 re S
20 40 120 1 re S
20 40 1 50 re S
70 40 1 50 re S
140 40 1 50 re S
`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
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
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('PDF table conversion', () => {
  it('emits a markdown table instead of a single paragraph', () => {
    const md = toMarkdownFromPdf(gridPdf());
    expect(md).toMatch(/\|Name\|Age\|/);
    expect(md).toMatch(/\|Ada\|36\|/);
    expect(md).toMatch(/\|---\|/);
  });

  it('detects tables drawn as filled closed paths', () => {
    const md = toMarkdownFromPdf(filledPathGridPdf());
    expect(md).toMatch(/\|Name\|Age\|/);
    expect(md).toMatch(/\|Ada\|36\|/);
  });
});
