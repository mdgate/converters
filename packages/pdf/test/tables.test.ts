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

  it('keeps a wrapped cell in one ruled row when verticals are short', () => {
    const items = [
      { text: 'Law', x: 30, y: 186, width: 24, page: 1 },
      { text: 'Union/State', x: 90, y: 192, width: 50, page: 1 },
      { text: 'Imprisonment', x: 160, y: 192, width: 50, page: 1 },
      { text: 'rule', x: 100, y: 176, width: 22, page: 1 },
      { text: 'clauses', x: 170, y: 176, width: 32, page: 1 },
      { text: 'Arms Act, 1959', x: 24, y: 158, width: 50, page: 1 },
      { text: 'Union', x: 96, y: 158, width: 28, page: 1 },
      { text: '152', x: 168, y: 158, width: 20, page: 1 },
      { text: 'Food Safety Act', x: 24, y: 130, width: 52, page: 1 },
      { text: 'Licensing Rules', x: 24, y: 114, width: 52, page: 1 },
      { text: 'Union', x: 96, y: 122, width: 28, page: 1 },
      { text: '123', x: 168, y: 122, width: 20, page: 1 },
      { text: 'Regulations, 2011', x: 24, y: 98, width: 56, page: 1 },
    ];
    const lines = [
      { x1: 20, y1: 200, x2: 210, y2: 200, page: 1 },
      { x1: 20, y1: 170, x2: 210, y2: 170, page: 1 },
      { x1: 20, y1: 148, x2: 210, y2: 148, page: 1 },
      { x1: 20, y1: 80, x2: 210, y2: 80, page: 1 },
      { x1: 20, y1: 170, x2: 20, y2: 200, page: 1 },
      { x1: 80, y1: 170, x2: 80, y2: 200, page: 1 },
      { x1: 150, y1: 170, x2: 150, y2: 200, page: 1 },
      { x1: 210, y1: 170, x2: 210, y2: 200, page: 1 },
      { x1: 20, y1: 148, x2: 20, y2: 168, page: 1 },
      { x1: 80, y1: 148, x2: 80, y2: 168, page: 1 },
      { x1: 150, y1: 148, x2: 150, y2: 168, page: 1 },
      { x1: 210, y1: 148, x2: 210, y2: 168, page: 1 },
      { x1: 20, y1: 80, x2: 20, y2: 148, page: 1 },
      { x1: 80, y1: 80, x2: 80, y2: 148, page: 1 },
      { x1: 150, y1: 80, x2: 150, y2: 148, page: 1 },
      { x1: 210, y1: 80, x2: 210, y2: 148, page: 1 },
    ];
    const tables = detectTables(items, lines, []);
    expect(tables).toHaveLength(1);
    const md = tables[0]!.markdown;
    expect(md).toMatch(/\|Law\|Union\/State rule\|Imprisonment clauses\|/);
    expect(md).toMatch(/\|Arms Act, 1959\|Union\|152\|/);
    expect(md).toMatch(/\|Food Safety Act Licensing Rules Regulations, 2011\|Union\|123\|/);
    expect(md.match(/^\|/gm)).toHaveLength(4);
  });

  it('keeps wrapped org names and the header inside one borderless table', () => {
    const items = [
      { text: 'No.', x: 22, y: 120, width: 16, page: 1 },
      { text: 'Name of organization', x: 50, y: 120, width: 80, page: 1 },
      { text: 'Number of accredited', x: 160, y: 120, width: 70, page: 1 },
      { text: 'observers', x: 172, y: 108, width: 40, page: 1 },
      { text: '1', x: 24, y: 92, width: 8, page: 1 },
      { text: 'Union of Youth Federations', x: 50, y: 92, width: 90, page: 1 },
      { text: '17,266', x: 176, y: 92, width: 30, page: 1 },
      { text: '(UYFC)', x: 50, y: 80, width: 32, page: 1 },
      { text: '2', x: 24, y: 64, width: 8, page: 1 },
      { text: 'Cambodian Women for Peace', x: 50, y: 64, width: 90, page: 1 },
      { text: '9,835', x: 178, y: 64, width: 26, page: 1 },
      { text: 'Development', x: 50, y: 52, width: 48, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    const md = tables[0]!.markdown;
    expect(md).toContain('|No.|Name of organization|Number of accredited observers|');
    expect(md).toContain('|1|Union of Youth Federations (UYFC)|17,266|');
    expect(md).toContain('|2|Cambodian Women for Peace Development|9,835|');
    expect(md.match(/^\|/gm)).toHaveLength(4);
  });

  it('detects a two-column table when most value cells wrap', () => {
    const items = [
      { text: 'Field', x: 20, y: 240, width: 30, page: 1 },
      { text: 'Value', x: 80, y: 240, width: 30, page: 1 },
      { text: 'A', x: 20, y: 220, width: 10, page: 1 },
      { text: 'One', x: 80, y: 220, width: 18, page: 1 },
      { text: 'Two', x: 80, y: 206, width: 18, page: 1 },
      { text: 'Three', x: 80, y: 192, width: 24, page: 1 },
      { text: 'B', x: 20, y: 172, width: 10, page: 1 },
      { text: 'Four', x: 80, y: 172, width: 22, page: 1 },
      { text: 'Five', x: 80, y: 158, width: 22, page: 1 },
      { text: 'Six', x: 80, y: 144, width: 18, page: 1 },
      { text: 'C', x: 20, y: 124, width: 10, page: 1 },
      { text: 'Seven', x: 80, y: 124, width: 26, page: 1 },
      { text: 'Eight', x: 80, y: 110, width: 24, page: 1 },
      { text: 'Nine', x: 80, y: 96, width: 22, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    const md = tables[0]!.markdown;
    expect(md).toContain('|Field|Value|');
    expect(md).toContain('|A|One Two Three|');
    expect(md).toContain('|B|Four Five Six|');
    expect(md).toContain('|C|Seven Eight Nine|');
    expect(md.match(/^\|/gm)).toHaveLength(5);
  });

  it('folds a short capitalized wrap into the current cell', () => {
    const items = [
      { text: 'No.', x: 22, y: 120, width: 16, page: 1 },
      { text: 'Name', x: 50, y: 120, width: 30, page: 1 },
      { text: 'Count', x: 160, y: 120, width: 30, page: 1 },
      { text: '1', x: 24, y: 92, width: 8, page: 1 },
      { text: 'Acme Corp', x: 50, y: 92, width: 50, page: 1 },
      { text: '12', x: 176, y: 92, width: 14, page: 1 },
      { text: 'Inc', x: 50, y: 80, width: 16, page: 1 },
      { text: '2', x: 24, y: 64, width: 8, page: 1 },
      { text: 'New', x: 50, y: 64, width: 20, page: 1 },
      { text: '9', x: 178, y: 64, width: 10, page: 1 },
      { text: 'York', x: 50, y: 52, width: 24, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    const md = tables[0]!.markdown;
    expect(md).toContain('|No.|Name|Count|');
    expect(md).toContain('|1|Acme Corp Inc|12|');
    expect(md).toContain('|2|New York|9|');
    expect(md.match(/^\|/gm)).toHaveLength(4);
  });

  it('keeps sparse Y/N cells in their columns across wrapped restriction text', () => {
    const items = [
      { text: 'Jurisdiction', x: 20, y: 214, width: 50, page: 1 },
      { text: 'GATS', x: 90, y: 214, width: 28, page: 1 },
      { text: 'Permitted', x: 140, y: 214, width: 40, page: 1 },
      { text: 'Restrictions', x: 200, y: 214, width: 50, page: 1 },
      { text: 'Reporting', x: 320, y: 214, width: 40, page: 1 },
      { text: '(1994)', x: 90, y: 200, width: 28, page: 1 },
      { text: 'Requirements', x: 320, y: 200, width: 50, page: 1 },
      { text: 'Argentina', x: 20, y: 180, width: 44, page: 1 },
      { text: 'Y', x: 98, y: 180, width: 10, page: 1 },
      { text: 'Y', x: 150, y: 180, width: 10, page: 1 },
      { text: 'Prohibition on ownership of', x: 200, y: 180, width: 90, page: 1 },
      { text: 'property that borders water.', x: 200, y: 166, width: 90, page: 1 },
      { text: 'Australia', x: 20, y: 140, width: 44, page: 1 },
      { text: 'N', x: 98, y: 140, width: 10, page: 1 },
      { text: 'Y', x: 150, y: 140, width: 10, page: 1 },
      { text: 'Approval is needed from the', x: 200, y: 140, width: 90, page: 1 },
      { text: 'Treasurer for land purchases.', x: 200, y: 126, width: 90, page: 1 },
      { text: 'Must report acquisitions.', x: 320, y: 140, width: 70, page: 1 },
      { text: 'to the agency.', x: 320, y: 126, width: 50, page: 1 },
      { text: 'Belgium', x: 20, y: 100, width: 40, page: 1 },
      { text: 'N', x: 98, y: 100, width: 10, page: 1 },
      { text: 'Y', x: 150, y: 100, width: 10, page: 1 },
      { text: 'None.', x: 200, y: 100, width: 24, page: 1 },
    ];
    const tables = detectTables(items, [], []);
    expect(tables).toHaveLength(1);
    const md = tables[0]!.markdown;
    expect(md).toContain(
      '|Jurisdiction|GATS (1994)|Permitted|Restrictions|Reporting Requirements|',
    );
    expect(md).toContain(
      '|Argentina|Y|Y|Prohibition on ownership of property that borders water.||',
    );
    expect(md).toContain(
      '|Australia|N|Y|Approval is needed from the Treasurer for land purchases.|Must report acquisitions. to the agency.|',
    );
    expect(md).toContain('|Belgium|N|Y|None.||');
    expect(md.match(/^\|/gm)).toHaveLength(5);
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
