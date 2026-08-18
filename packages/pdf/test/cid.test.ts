import { describe, expect, it } from 'vitest';
import { adobeCidToUnicode } from '../src/adobe-cid.js';
import { toMarkdownFromPdf } from '../src/pdf.js';

/** Minimal Type0 / Identity-H PDF: 2-byte CIDs 0001/0002 → 北/京. */
function identityHPdf(): Uint8Array {
  const toUnicode = `%!PS-Adobe-3.0 Resource-CMap
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
2 beginbfchar
<0001> <5317>
<0002> <4eac>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;

  const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
<00010002> Tj
ET
`;

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /TestSans /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [1 2 500] >>\nendobj\n',
    `7 0 obj\n<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}endstream\nendobj\n`,
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 8\n0000000000 65535 f \n`;
  for (let i = 1; i <= 7; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

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

/** Identity-H, no ToUnicode, Adobe-GB1 ROS. CID 0x03E6 is 佰 in Adobe-GB1-UCS2. */
function adobeGb1Pdf(cidHex = '03e6', toUnicode?: string): Uint8Array {
  const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
<${cidHex}> Tj
ET
`;
  const tuRef = toUnicode ? ' /ToUnicode 7 0 R' : '';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /GBSans /Encoding /Identity-H /DescendantFonts [6 0 R]${tuRef} >>\nendobj\n`,
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GBSans /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 >>\nendobj\n',
  ];
  if (toUnicode) {
    objects.push(
      `7 0 obj\n<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}endstream\nendobj\n`,
    );
  }
  return buildPdf(objects);
}

describe('CID / Identity-H text', () => {
  it('decodes 2-byte ToUnicode CIDs instead of Latin-1 garbage', () => {
    const md = toMarkdownFromPdf(identityHPdf());
    expect(md).toContain('北京');
    expect(md).not.toContain('\u0001');
  });

  it('uses the official Adobe-GB1-UCS2 table when ToUnicode is missing', () => {
    const md = toMarkdownFromPdf(adobeGb1Pdf());
    expect(md).toContain('佰');
  });

  it('lets ToUnicode win over the Adobe collection table', () => {
    const toUnicode = `%!PS-Adobe-3.0 Resource-CMap
begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfchar
<03e6> <4e2d>
endbfchar
endcmap
`;
    const md = toMarkdownFromPdf(adobeGb1Pdf('03e6', toUnicode));
    expect(md).toContain('中');
    expect(md).not.toContain('佰');
  });

  it('loads every Adobe collection, not only GB1', () => {
    expect(adobeCidToUnicode('GB1', 0x03e6)).toBe('佰');
    expect(adobeCidToUnicode('CNS1', 1000)?.length).toBeGreaterThan(0);
    expect(adobeCidToUnicode('Japan1', 1000)?.length).toBeGreaterThan(0);
    expect(adobeCidToUnicode('Korea1', 1000)?.length).toBeGreaterThan(0);
    expect(adobeCidToUnicode('KR', 1000)?.length).toBeGreaterThan(0);
    expect(adobeCidToUnicode('GB1', 999999)).toBeUndefined();
  });
});
