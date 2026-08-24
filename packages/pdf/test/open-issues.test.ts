import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { pdf } from '../src/converter.js';
import { md5, rc4 } from '../src/crypto.js';
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

function helloPdf(): Uint8Array {
  return buildPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 1 0 0 1 20 50 Tm (Hello) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]);
}

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

function u16be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 8) & 255, n & 255);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const PAD = Uint8Array.of(
  0x28,
  0xbf,
  0x4e,
  0x5e,
  0x4e,
  0x75,
  0x8a,
  0x41,
  0x64,
  0x00,
  0x4e,
  0x56,
  0xff,
  0xfa,
  0x01,
  0x08,
  0x2e,
  0x2e,
  0x00,
  0xb6,
  0xd0,
  0x68,
  0x3e,
  0x80,
  0x2f,
  0x0c,
  0xa9,
  0xfe,
  0x64,
  0x53,
  0x69,
  0x7a,
);

function hexOf(data: Uint8Array): string {
  return [...data].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fileKeyR4(o: Uint8Array, p: number, id: Uint8Array): Uint8Array {
  const n = 16;
  const buf = new Uint8Array(32 + 32 + 4 + id.length);
  buf.set(PAD);
  buf.set(o.subarray(0, 32), 32);
  const u = p >>> 0;
  buf[64] = u & 255;
  buf[65] = (u >>> 8) & 255;
  buf[66] = (u >>> 16) & 255;
  buf[67] = (u >>> 24) & 255;
  buf.set(id, 68);
  let hash = md5(buf);
  const slice = new Uint8Array(n);
  for (let i = 0; i < 50; i += 1) {
    slice.set(hash.subarray(0, n));
    hash = md5(slice);
  }
  return hash.subarray(0, n);
}

function computeUR4(key: Uint8Array, id: Uint8Array): Uint8Array {
  const hash = md5(concat([PAD, id]));
  let out = rc4(key, hash);
  const xorKey = new Uint8Array(key.length);
  for (let i = 1; i <= 19; i += 1) {
    for (let j = 0; j < key.length; j += 1) xorKey[j] = key[j]! ^ i;
    out = rc4(xorKey, out);
  }
  const u = new Uint8Array(32);
  u.set(out.subarray(0, 16));
  u.set(PAD.subarray(0, 16), 16);
  return u;
}

function encryptRc4Stream(
  fileKey: Uint8Array,
  num: number,
  gen: number,
  data: Uint8Array,
): Uint8Array {
  const buf = new Uint8Array(fileKey.length + 5);
  buf.set(fileKey);
  const at = fileKey.length;
  buf[at] = num & 255;
  buf[at + 1] = (num >>> 8) & 255;
  buf[at + 2] = (num >>> 16) & 255;
  buf[at + 3] = gen & 255;
  buf[at + 4] = (gen >>> 8) & 255;
  return rc4(md5(buf).subarray(0, Math.min(fileKey.length + 5, 16)), data);
}

function concatParts(parts: Array<string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  return concat(parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p)));
}

function buildEncryptedXrefContentPdf(): Uint8Array {
  const id = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const owner = Uint8Array.from({ length: 32 }, (_, i) => i);
  const p = -4;
  const key = fileKeyR4(owner, p, id);
  const user = computeUR4(key, id);
  const pageContent = new TextEncoder().encode('BT /F1 12 Tf 1 0 0 1 20 50 Tm (Hello) Tj ET\n');
  const encContent = encryptRc4Stream(key, 4, 0, pageContent);

  const chunks: Array<string | Uint8Array> = [];
  let size = 0;
  const offsets = new Map<number, number>();
  const add = (part: string | Uint8Array, num?: number): void => {
    if (num !== undefined) offsets.set(num, size);
    chunks.push(part);
    size += typeof part === 'string' ? part.length : part.length;
  };

  add('%PDF-1.5\n');
  add(
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /ID [<${hexOf(id)}> <${hexOf(id)}>] >>\nendobj\n`,
    1,
  );
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 2);
  add(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    3,
  );
  add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n', 5);
  add(
    `6 0 obj
<< /Filter /Standard /V 4 /R 4 /Length 128 /P ${p}
   /O <${hexOf(owner)}>
   /U <${hexOf(user)}>
   /CF << /StdCF << /AuthEvent /DocOpen /CFM /V2 /Length 16 >> >>
   /StmF /StdCF /StrF /Identity >>
endobj
`,
    6,
  );
  add('X');
  add(`4 0 obj\n<< /Length ${encContent.length} >>\nstream\n`, 4);
  add(encContent);
  add('\nendstream\nendobj\n');

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
  write(1, 1, offsets.get(1) ?? 0, 0);
  write(2, 1, offsets.get(2) ?? 0, 0);
  write(3, 1, offsets.get(3) ?? 0, 0);
  write(4, 1, offsets.get(4) ?? 0, 0);
  write(5, 1, offsets.get(5) ?? 0, 0);
  write(6, 1, offsets.get(6) ?? 0, 0);
  const encTable = encryptRc4Stream(key, 7, 0, table);
  const xrefAt = size;
  add(
    `7 0 obj\n<< /Type /XRef /Size ${count} /W [1 2 1] /Root 1 0 R /Encrypt 6 0 R /ID [<${hexOf(id)}> <${hexOf(id)}>] /Index [0 ${count}] /Length ${encTable.length} >>\nstream\n`,
    7,
  );
  add(encTable);
  add('\nendstream\nendobj\n');
  add(
    `trailer\n<< /Size ${count} /Root 1 0 R /Encrypt 6 0 R /ID [<${hexOf(id)}> <${hexOf(id)}>] >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
  return concatParts(chunks);
}

describe('open issue fixtures', () => {
  it('returns malformed for a cyclic /Pages tree instead of overflowing', () => {
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 >>\nendobj\n',
    ]);
    expect(() => toMarkdownFromPdf(bytes)).toThrowError(ConvertError);
    try {
      toMarkdownFromPdf(bytes);
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('malformed');
    }
  });

  it('unwraps an AppleSingle data fork that holds a PDF', () => {
    const inner = helloPdf();
    const header = concat([
      u32be(0x00051600),
      u32be(0x00020000),
      new Uint8Array(16),
      u16be(1),
      u32be(1),
      u32be(26 + 12),
      u32be(inner.length),
    ]);
    const wrapped = concat([header, inner]);
    expect(toMarkdownFromPdf(wrapped)).toContain('Hello');
    expect(pdf().sniff(wrapped, { path: 'testAppleSingleFile.pdf' })).toBe(2);
  });

  it('uses the full stream when /Length is too short', () => {
    const content = `BT
/F1 12 Tf
1 0 0 1 20 80 Tm
(Hello) Tj
0 -20 Td
(World) Tj
ET
`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length 20 >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ]);
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('Hello');
    expect(md).toContain('World');
  });

  it('reads Type0 Encoding /V JIS bytes', () => {
    const content = `BT /F2 12 Tf 1 0 0 1 20 50 Tm ($"$$$&$\\($*) Tj ET\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F2 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      `5 0 obj
<< /Type /Font /Subtype /Type0 /BaseFont /Ryumin-Light-V /Encoding /V
   /DescendantFonts [6 0 R] >>
endobj
`,
      `6 0 obj
<< /Type /Font /Subtype /CIDFontType0
   /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 1 >> >>
endobj
`,
    ]);
    expect(toMarkdownFromPdf(bytes)).toContain('あいうえお');
  });

  it('decodes GBK bytes on a WinAnsi CJK-named simple font', () => {
    const content = `BT /F1 12 Tf 1 0 0 1 20 50 Tm <d6d0cec4> Tj ET\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /SimSun_GB2312 /Encoding /WinAnsiEncoding /FirstChar 0 /LastChar 255 >>\nendobj\n',
    ]);
    expect(toMarkdownFromPdf(bytes)).toContain('中文');
  });

  it('prefers ToUnicode over legacy GBK on a CJK-named simple font', () => {
    const toUnicode = `%!PS-Adobe-3.0 Resource-CMap
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfchar
<d6d0> <65e5>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
    const content = `BT /F1 12 Tf 1 0 0 1 20 50 Tm <d6d0> Tj ET\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      `5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /SimSun /Encoding /WinAnsiEncoding /FirstChar 0 /LastChar 255 /ToUnicode 6 0 R >>\nendobj\n`,
      `6 0 obj\n<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}endstream\nendobj\n`,
    ]);
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('日');
    expect(md).not.toContain('中');
  });

  it('does not decode Japanese-named simple fonts as GBK', () => {
    const content = `BT /F1 12 Tf 1 0 0 1 20 50 Tm <d6d0cec4> Tj ET\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /MS-Gothic /Encoding /WinAnsiEncoding /FirstChar 0 /LastChar 255 >>\nendobj\n',
    ]);
    expect(toMarkdownFromPdf(bytes)).not.toContain('中文');
  });

  it('emits widget and popup annotation values', () => {
    const content = 'BT /F1 12 Tf 1 0 0 1 20 80 Tm (Label) Tj ET\n';
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] >> >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Annots [6 0 R 7 0 R] /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      '6 0 obj\n<< /Type /Annot /Subtype /Widget /T (Check) /V (Yes) /Rect [20 20 80 40] >>\nendobj\n',
      '7 0 obj\n<< /Type /Annot /Subtype /Text /Contents (this is the note) /Rect [20 50 80 70] >>\nendobj\n',
    ]);
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('Label');
    expect(md).toContain('Yes');
    expect(md).toContain('this is the note');
    expect(md.match(/Yes/g)?.length).toBe(1);
  });

  it('emits each AcroForm field once across pages and form XObjects', () => {
    const formContent = 'q Q\n';
    const pageContent = `BT /F1 12 Tf 1 0 0 1 20 80 Tm (Label) Tj ET\n/Fm1 Do\n`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [7 0 R] >> >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n',
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R /Annots [7 0 R] /Resources << /Font << /F1 8 0 R >> /XObject << /Fm1 6 0 R >> >> >>\nendobj\n`,
      `4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R /Resources << /Font << /F1 8 0 R >> /XObject << /Fm1 6 0 R >> >> >>\nendobj\n`,
      `5 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${formContent.length} >>\nstream\n${formContent}endstream\nendobj\n`,
      '7 0 obj\n<< /Type /Annot /Subtype /Widget /T (Check) /V (UniqueYes) /Rect [20 20 80 40] >>\nendobj\n',
      '8 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ]);
    const md = toMarkdownFromPdf(bytes);
    expect(md).toContain('Label');
    expect(md).toContain('UniqueYes');
    expect(md.match(/UniqueYes/g)?.length).toBe(1);
  });

  it('reads PDF 2.0 UTF-8 annotation text', () => {
    const thai = new TextEncoder().encode('ไฮไลต์ข้อความ');
    const contents = `<${[...thai].map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Annots [4 0 R] >>\nendobj\n`,
      `4 0 obj\n<< /Type /Annot /Subtype /Highlight /Contents ${contents} /Rect [10 10 80 40] >>\nendobj\n`,
    ]);
    expect(toMarkdownFromPdf(bytes)).toContain('ไฮไลต์ข้อความ');
  });

  it('sniffs XFDF and emits field names', () => {
    const xfdf = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">
  <fields>
    <field name="CheckBox1"></field>
  </fields>
</xfdf>
`);
    expect(pdf().sniff(xfdf, { path: 'testXFDF.xfdf' })).toBe(2);
    expect(toMarkdownFromPdf(xfdf)).toContain('CheckBox1');
  });

  it('ignores /Encrypt when streams use the Identity filter', () => {
    const bytes = buildPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 1 0 0 1 20 50 Tm (Hello) Tj ET\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `6 0 obj
<< /Filter /Standard /V 5 /R 6 /Length 256 /P -4
   /O <000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f>
   /U <000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f>
   /CF << /StdCF << /AuthEvent /EFOpen /CFM /AESV3 /Length 32 >> >>
   /StmF /Identity /StrF /Identity >>
endobj
`,
    ]);
    const withEnc = new TextEncoder().encode(
      new TextDecoder('latin1')
        .decode(bytes)
        .replace(
          '/Root 1 0 R >>',
          '/Root 1 0 R /Encrypt 6 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] >>',
        ),
    );
    expect(toMarkdownFromPdf(withEnc)).toContain('Hello');
  });

  it('decrypts xref-loaded streams after the first encryption pass', () => {
    expect(toMarkdownFromPdf(buildEncryptedXrefContentPdf())).toContain('Hello');
  });
});
