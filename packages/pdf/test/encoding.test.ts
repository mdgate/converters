import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';

function simpleTextPdf(opts: {
  baseFont: string;
  shown: string;
  flags?: number;
  toUnicode?: string;
  extraShown?: { font: string; shown: string; baseFont: string; flags?: number };
}): Uint8Array {
  const flags = opts.flags ?? 32;
  const extra = opts.extraShown;
  const extraTf = extra ? `\n/F2 12 Tf\n1 0 0 1 20 30 Tm (${extra.shown}) Tj` : '';
  const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(${opts.shown}) Tj${extraTf}
ET
`;

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  ];

  const fontRes = extra ? '/F1 5 0 R /F2 7 0 R' : '/F1 5 0 R';
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << ${fontRes} >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
  );

  const tuRef = opts.toUnicode ? ' /ToUnicode 6 0 R' : '';
  objects.push(
    `5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /${opts.baseFont} /FontDescriptor 8 0 R /FirstChar 33 /LastChar 126 /Widths [${Array(94).fill(500).join(' ')}]${tuRef} >>\nendobj\n`,
  );

  if (opts.toUnicode) {
    objects.push(
      `6 0 obj\n<< /Length ${opts.toUnicode.length} >>\nstream\n${opts.toUnicode}endstream\nendobj\n`,
    );
  } else {
    objects.push('6 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n');
  }

  if (extra) {
    objects.push(
      `7 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /${extra.baseFont} /FontDescriptor 9 0 R /FirstChar 33 /LastChar 126 /Widths [${Array(94).fill(1000).join(' ')}] >>\nendobj\n`,
    );
  } else {
    objects.push('7 0 obj\n<< >>\nendobj\n');
  }

  objects.push(
    `8 0 obj\n<< /Type /FontDescriptor /FontName /${opts.baseFont} /Flags ${flags} /FontBBox [0 -200 1000 900] >>\nendobj\n`,
  );
  objects.push(
    `9 0 obj\n<< /Type /FontDescriptor /FontName /${extra?.baseFont ?? opts.baseFont} /Flags ${extra?.flags ?? 4} /FontBBox [0 -200 1000 900] >>\nendobj\n`,
  );

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

const fiveCharToUnicode = `%!PS-Adobe-3.0 Resource-CMap
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
5 beginbfrange
<21><21><6625>
<22><22><590f>
<23><23><79cb>
<24><24><51ac>
<25><25><96e8>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;

describe('PDF encoding diagnostics', () => {
  it('still extracts Helvetica without ToUnicode', () => {
    const md = toMarkdownFromPdf(
      simpleTextPdf({ baseFont: 'Helvetica', shown: 'Hello World', flags: 32 }),
    );
    expect(md).toContain('Hello World');
  });

  it('throws when a CJK font has no Unicode mapping', () => {
    const bytes = simpleTextPdf({
      baseFont: 'AAAAAK+FangSong',
      shown: '!"#$%&\'*+,-.',
      flags: 4,
    });
    try {
      toMarkdownFromPdf(bytes);
      throw new Error('expected ConvertError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('unsupported');
      expect((err as ConvertError).message).toContain('PDF text is not decodable');
      expect((err as ConvertError).message).toMatch(/\d+ of \d+ character codes/);
    }
  });

  it('throws when undecodable codes outnumber mapped ones', () => {
    const bytes = simpleTextPdf({
      baseFont: 'AAAAAG+SimSun',
      shown: '!"#$%',
      flags: 4,
      toUnicode: fiveCharToUnicode,
      extraShown: {
        font: 'F2',
        shown: '!"#$%&\'*+,-./01',
        baseFont: 'AAAAAK+FangSong',
        flags: 4,
      },
    });
    expect(() => toMarkdownFromPdf(bytes)).toThrow(/PDF text is not decodable/);
  });

  it('keeps mostly-mapped text when only a few codes are unmapped', () => {
    const bytes = simpleTextPdf({
      baseFont: 'Helvetica',
      shown: 'Hello World this is mapped text',
      flags: 32,
      extraShown: {
        font: 'F2',
        shown: '!@#',
        baseFont: 'AAAAAK+FangSong',
        flags: 4,
      },
    });
    expect(toMarkdownFromPdf(bytes)).toContain('Hello World');
  });

  it('keeps ToUnicode CJK text as a success', () => {
    const md = toMarkdownFromPdf(
      simpleTextPdf({
        baseFont: 'AAAAAG+SimSun',
        shown: '!"#$%',
        flags: 4,
        toUnicode: fiveCharToUnicode,
      }),
    );
    expect(md).toContain('春夏秋冬雨');
  });
});
