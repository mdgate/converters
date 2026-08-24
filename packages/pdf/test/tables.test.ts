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

  it('builds a markdown table from aligned cells without ruling lines', () => {
    const items = [
      { text: 'Name', x: 22, y: 82, width: 28, page: 1 },
      { text: 'Age', x: 82, y: 82, width: 20, page: 1 },
      { text: 'City', x: 142, y: 82, width: 24, page: 1 },
      { text: 'Ada', x: 22, y: 62, width: 20, page: 1 },
      { text: '36', x: 82, y: 62, width: 16, page: 1 },
      { text: 'London', x: 142, y: 62, width: 36, page: 1 },
      { text: 'Bob', x: 22, y: 42, width: 20, page: 1 },
      { text: '41', x: 82, y: 42, width: 16, page: 1 },
      { text: 'Paris', x: 142, y: 42, width: 28, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|Name|Age|City|');
    expect(tables[0]!.markdown).toContain('|Ada|36|London|');
    expect(tables[0]!.markdown).toContain('|Bob|41|Paris|');
  });

  it('keeps a word space when a cell fragment starts with one', () => {
    const items = [
      { text: 'W', x: 20, y: 80, width: 11, page: 1 },
      { text: 'ide', x: 31, y: 80, width: 15, page: 1 },
      { text: ' head', x: 46.1, y: 80, width: 22, page: 1 },
      { text: 'End', x: 140, y: 80, width: 20, page: 1 },
      { text: 'Tall', x: 20, y: 60, width: 24, page: 1 },
      { text: 'B2', x: 80, y: 60, width: 16, page: 1 },
      { text: 'C2', x: 140, y: 60, width: 16, page: 1 },
      { text: 'B3', x: 80, y: 40, width: 16, page: 1 },
      { text: 'C3', x: 140, y: 40, width: 16, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|Wide head|');
  });

  it('joins a hyphenated wrap inside a ruled cell without a space', () => {
    const items = [
      { text: 'some-', x: 22, y: 82, width: 30, page: 1, fontSize: 12 },
      { text: 'thing', x: 22, y: 72, width: 28, page: 1, fontSize: 12 },
      { text: 'Age', x: 82, y: 82, width: 20, page: 1, fontSize: 12 },
      { text: 'Ada', x: 22, y: 52, width: 20, page: 1, fontSize: 12 },
      { text: '36', x: 82, y: 52, width: 16, page: 1, fontSize: 12 },
    ];
    const rects = [
      { x: 20, y: 90, width: 120, height: 1, page: 1 },
      { x: 20, y: 65, width: 120, height: 1, page: 1 },
      { x: 20, y: 40, width: 120, height: 1, page: 1 },
      { x: 20, y: 40, width: 1, height: 50, page: 1 },
      { x: 70, y: 40, width: 1, height: 50, page: 1 },
      { x: 140, y: 40, width: 1, height: 50, page: 1 },
    ];
    const tables = detectTables(items, [], rects);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|some-thing|Age|');
    expect(tables[0]!.markdown).not.toContain('some- thing');
  });

  it('keeps a word space when cell fragments sit a space-width apart', () => {
    const items = [
      { text: 'Wide', x: 20, y: 80, width: 24, page: 1, fontSize: 12 },
      { text: 'head', x: 47, y: 80, width: 22, page: 1, fontSize: 12 },
      { text: 'End', x: 140, y: 80, width: 20, page: 1, fontSize: 12 },
      { text: 'Tall', x: 20, y: 60, width: 24, page: 1, fontSize: 12 },
      { text: 'B2', x: 80, y: 60, width: 16, page: 1, fontSize: 12 },
      { text: 'C2', x: 140, y: 60, width: 16, page: 1, fontSize: 12 },
      { text: 'B3', x: 80, y: 40, width: 16, page: 1, fontSize: 12 },
      { text: 'C3', x: 140, y: 40, width: 16, page: 1, fontSize: 12 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|Wide head|');
  });

  it('keeps a three-column grid when one corner cell is empty', () => {
    const items = [
      { text: 'Wide', x: 20, y: 80, width: 28, page: 1 },
      { text: 'End', x: 140, y: 80, width: 20, page: 1 },
      { text: 'Tall', x: 20, y: 60, width: 24, page: 1 },
      { text: 'B2', x: 80, y: 60, width: 16, page: 1 },
      { text: 'C2', x: 140, y: 60, width: 16, page: 1 },
      { text: 'B3', x: 80, y: 40, width: 16, page: 1 },
      { text: 'C3', x: 140, y: 40, width: 16, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.markdown).toContain('|Tall|B2|C2|');
    expect(tables[0]!.markdown).toContain('|B3|C3|');
  });

  it('does not treat two-column prose as a table', () => {
    const items = [
      {
        text: 'This opening sentence runs down the left column of the paper.',
        x: 20,
        y: 80,
        width: 140,
        page: 1,
      },
      {
        text: 'The matching sentence on the right continues the other argument.',
        x: 200,
        y: 80,
        width: 150,
        page: 1,
      },
      {
        text: 'A second left line keeps the paragraph going with more words.',
        x: 20,
        y: 60,
        width: 140,
        page: 1,
      },
      {
        text: 'A second right line also stays long and reads as body text.',
        x: 200,
        y: 60,
        width: 150,
        page: 1,
      },
    ];
    expect(detectTables(items, [], [])).toHaveLength(0);
  });

  it('detects two separate ruled grids on one page', () => {
    const items = [
      { text: 'Name', x: 22, y: 182, width: 30, page: 1 },
      { text: 'Age', x: 82, y: 182, width: 20, page: 1 },
      { text: 'Ada', x: 22, y: 152, width: 20, page: 1 },
      { text: '36', x: 82, y: 152, width: 16, page: 1 },
      { text: 'Item', x: 22, y: 82, width: 24, page: 1 },
      { text: 'Qty', x: 82, y: 82, width: 20, page: 1 },
      { text: 'Pen', x: 22, y: 52, width: 18, page: 1 },
      { text: '2', x: 82, y: 52, width: 10, page: 1 },
    ];
    const rects = [
      { x: 20, y: 190, width: 120, height: 1, page: 1 },
      { x: 20, y: 170, width: 120, height: 1, page: 1 },
      { x: 20, y: 140, width: 120, height: 1, page: 1 },
      { x: 20, y: 140, width: 1, height: 50, page: 1 },
      { x: 70, y: 140, width: 1, height: 50, page: 1 },
      { x: 140, y: 140, width: 1, height: 50, page: 1 },
      { x: 20, y: 90, width: 120, height: 1, page: 1 },
      { x: 20, y: 70, width: 120, height: 1, page: 1 },
      { x: 20, y: 40, width: 120, height: 1, page: 1 },
      { x: 20, y: 40, width: 1, height: 50, page: 1 },
      { x: 70, y: 40, width: 1, height: 50, page: 1 },
      { x: 140, y: 40, width: 1, height: 50, page: 1 },
    ];
    const tables = detectTables(items, [], rects);
    expect(tables).toHaveLength(2);
    const md = tables.map((t) => t.markdown).join('\n');
    expect(md).toContain('|Name|Age|');
    expect(md).toContain('|Ada|36|');
    expect(md).toContain('|Item|Qty|');
    expect(md).toContain('|Pen|2|');
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

  it('emits a markdown table from aligned text with no strokes', () => {
    const content = `BT
/F1 12 Tf
1 0 0 1 24 82 Tm (Name) Tj
1 0 0 1 84 82 Tm (Age) Tj
1 0 0 1 144 82 Tm (City) Tj
1 0 0 1 24 62 Tm (Ada) Tj
1 0 0 1 84 62 Tm (36) Tj
1 0 0 1 144 62 Tm (London) Tj
1 0 0 1 24 42 Tm (Bob) Tj
1 0 0 1 84 42 Tm (41) Tj
1 0 0 1 144 42 Tm (Paris) Tj
ET
`;
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
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
    const md = toMarkdownFromPdf(new TextEncoder().encode(body));
    expect(md).toMatch(/\|Name\|Age\|City\|/);
    expect(md).toMatch(/\|Ada\|36\|London\|/);
    expect(md).toMatch(/\|Bob\|41\|Paris\|/);
  });
});
