import { describe, expect, it } from 'vitest';
import { toMarkdownFromPdf } from '../src/pdf.js';
import { cmapFromTrueType, parseTrueTypeCmaps } from '../src/truetype.js';

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function concat(parts: number[][]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Minimal sfnt whose only table is `cmap`. */
function wrapCmap(cmap: Uint8Array): Uint8Array {
  const header = [0x00, 0x01, 0x00, 0x00, ...u16(1), ...u16(16), ...u16(0), ...u16(0)];
  const recOff = header.length;
  const cmapOff = recOff + 16;
  const rec = [...[0x63, 0x6d, 0x61, 0x70], ...u32(0), ...u32(cmapOff), ...u32(cmap.length)];
  return concat([header, rec, [...cmap]]);
}

function format4Unicode(): number[] {
  // Segments: U+4EAC→GID 2, U+5317→GID 1, terminator U+FFFF.
  const segs = [
    { start: 0x4eac, end: 0x4eac, delta: (2 - 0x4eac) & 0xffff },
    { start: 0x5317, end: 0x5317, delta: (1 - 0x5317) & 0xffff },
    { start: 0xffff, end: 0xffff, delta: 1 },
  ];
  const segCount = segs.length;
  const body: number[] = [];
  body.push(...u16(4), ...u16(0), ...u16(0)); // length patched below
  body.push(...u16(segCount * 2), ...u16(4), ...u16(1), ...u16(2));
  for (const s of segs) body.push(...u16(s.end));
  body.push(...u16(0));
  for (const s of segs) body.push(...u16(s.start));
  for (const s of segs) body.push(...u16(s.delta));
  for (let i = 0; i < segCount; i += 1) body.push(...u16(0));
  const length = body.length;
  body[2] = (length >> 8) & 0xff;
  body[3] = length & 0xff;
  return body;
}

function format6MacRoman(): number[] {
  // codes 0x21, 0x22 → GID 1, 2
  return [...u16(6), ...u16(14), ...u16(0), ...u16(0x21), ...u16(2), ...u16(1), ...u16(2)];
}

function cmapBoth(): Uint8Array {
  const recSize = 4 + 2 * 8;
  const f4 = format4Unicode();
  const f6 = format6MacRoman();
  const off4 = recSize;
  const off6 = recSize + f4.length;
  const header = [
    ...u16(0),
    ...u16(2),
    ...u16(3),
    ...u16(1),
    ...u32(off4),
    ...u16(1),
    ...u16(0),
    ...u32(off6),
  ];
  return concat([header, f4, f6]);
}

describe('TrueType cmap', () => {
  it('reverses Unicode cmap to GID→汉字 for CID fonts', () => {
    const font = wrapCmap(cmapBoth());
    const cid = cmapFromTrueType(font, 'cid');
    expect(cid?.get(1)).toBe('北');
    expect(cid?.get(2)).toBe('京');
  });

  it('maps Mac Roman byte codes through GID→Unicode for simple fonts', () => {
    const font = wrapCmap(cmapBoth());
    const simple = cmapFromTrueType(font, 'simple');
    expect(simple?.get(0x21)).toBe('北');
    expect(simple?.get(0x22)).toBe('京');
  });

  it('parses TTC by reading the first face', () => {
    const face = wrapCmap(cmapBoth());
    const shifted = new Uint8Array(face);
    // Table offsets in a TTC are from the start of the file.
    const cmapOff = 16 + 28;
    shifted[20] = (cmapOff >>> 24) & 0xff;
    shifted[21] = (cmapOff >>> 16) & 0xff;
    shifted[22] = (cmapOff >>> 8) & 0xff;
    shifted[23] = cmapOff & 0xff;
    const ttc = concat([
      [0x74, 0x74, 0x63, 0x66, 0x00, 0x01, 0x00, 0x00, ...u32(1), ...u32(16)],
      [...shifted],
    ]);
    const parsed = parseTrueTypeCmaps(ttc);
    expect(parsed?.gidToUnicode.get(1)).toBe('北');
  });
});

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function identityHPdfFromTtf(font: Uint8Array): Uint8Array {
  const hex = toHex(font);
  const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
<00010002> Tj
ET
`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /TestSans /Encoding /Identity-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestSans /FontDescriptor 7 0 R /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>\nendobj\n',
    '7 0 obj\n<< /Type /FontDescriptor /FontName /TestSans /Flags 4 /FontBBox [0 0 500 700] /ItalicAngle 0 /Ascent 700 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 8 0 R >>\nendobj\n',
    `8 0 obj\n<< /Length ${hex.length} /Length1 ${font.length} /Filter /ASCIIHexDecode >>\nstream\n${hex}\nendstream\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 9\n0000000000 65535 f \n`;
  for (let i = 1; i <= 8; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('TrueType cmap PDF fallback', () => {
  it('decodes Identity-H text from FontFile2 when ToUnicode is absent', () => {
    const md = toMarkdownFromPdf(identityHPdfFromTtf(wrapCmap(cmapBoth())));
    expect(md).toContain('北京');
  });
});
