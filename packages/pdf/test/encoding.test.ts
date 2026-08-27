import { describe, expect, it } from 'vitest';
import { glyphNameToUnicode } from '../src/encodings.js';
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

  it('returns markdown when a CJK font has no Unicode mapping', () => {
    const bytes = simpleTextPdf({
      baseFont: 'AAAAAK+FangSong',
      shown: '!"#$%&\'*+,-.',
      flags: 4,
    });
    expect(typeof toMarkdownFromPdf(bytes)).toBe('string');
  });

  it('keeps mapped text when undecodable codes outnumber mapped ones', () => {
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
    expect(typeof toMarkdownFromPdf(bytes)).toBe('string');
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

  it('maps Kangxi and CJK-supplement radicals to unified ideographs', () => {
    // ⼗ U+2F17, ⾏ U+2F8F, ⺠ U+2EA0, ⻘ U+2ED8 → 十行民青
    const toUnicode = `%!PS-Adobe-3.0 Resource-CMap
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
4 beginbfrange
<21><21><2f17>
<22><22><2f8f>
<23><23><2ea0>
<24><24><2ed8>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
    const md = toMarkdownFromPdf(
      simpleTextPdf({
        baseFont: 'AAAAAG+SimSun',
        shown: '!"#$',
        flags: 4,
        toUnicode,
      }),
    );
    expect(md).toContain('十行民青');
    expect(md).not.toContain('⼗');
    expect(md).not.toContain('⾏');
    expect(md).not.toContain('⺠');
    expect(md).not.toContain('⻘');
  });

  it('decodes WinAnsiEncoding including the euro and curly quotes', () => {
    const md = toMarkdownFromPdf(
      simpleTextPdf({
        baseFont: 'Helvetica',
        shown: 'Hello \\200 \\221quoted\\222',
        flags: 32,
      }),
    );
    expect(md).toContain('Hello');
    expect(md).toContain('€');
    expect(md).toContain('‘quoted’');
  });

  it('applies Encoding Differences via the Adobe Glyph List', () => {
    const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(\x27ok\x60) Tj
ET
`;
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 6 0 R >>\nendobj\n',
      '6 0 obj\n<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [39 /trademark 96 /Euro] >>\nendobj\n',
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
    const md = toMarkdownFromPdf(new TextEncoder().encode(body));
    expect(md).toContain('™ok€');
  });
});

describe('glyph name mapping', () => {
  it('expands ligature names and presentation forms', () => {
    expect(glyphNameToUnicode('fi')).toBe('fi');
    expect(glyphNameToUnicode('/f_i')).toBe('fi');
    expect(glyphNameToUnicode('f_l')).toBe('fl');
    expect(glyphNameToUnicode('f_f_i')).toBe('ffi');
    expect(glyphNameToUnicode('T_h')).toBe('Th');
  });

  it('maps oldstyle, small-cap, and uniXXXX suffixes', () => {
    expect(glyphNameToUnicode('eight.oldstyle')).toBe('8');
    expect(glyphNameToUnicode('t.sc')).toBe('T');
    expect(glyphNameToUnicode('a.smcp')).toBe('A');
    expect(glyphNameToUnicode('Y.c2sc')).toBe('Y');
    expect(glyphNameToUnicode('uni00A0')).toBe('\u00a0');
    expect(glyphNameToUnicode('one.SP')).toBe('1');
  });
});

describe('custom encoding ligatures and word spaces', () => {
  function differencesPdf(shown: string, diffs: string): Uint8Array {
    const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
(${shown}) Tj
ET
`;
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 6 0 R >>\nendobj\n',
      `6 0 obj\n<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${diffs} >>\nendobj\n`,
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

  it('decodes f_i and T_h Differences names', () => {
    const md = toMarkdownFromPdf(differencesPdf('\x01eld \x02e other', '[1 /f_i /T_h]'));
    expect(md).toContain('field');
    expect(md).toContain('The other');
  });

  it('keeps a nbsp as a word space', () => {
    const md = toMarkdownFromPdf(differencesPdf('a\x1fyoung', '[31 /uni00A0]'));
    expect(md).toContain('a young');
    expect(md).not.toContain('ayoung');
  });
});
