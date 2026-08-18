import { describe, expect, it } from 'vitest';
import {
  encodingCmap,
  inferAdobeOrdering,
  parseEmbeddedCmap,
  uniKind,
} from '../src/encoding-cmap.js';
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

function type0Pdf(opts: { encoding: string; shownHex: string; ordering?: string }): Uint8Array {
  const content = `BT
/F1 12 Tf
1 0 0 1 20 50 Tm
<${opts.shownHex}> Tj
ET
`;
  const ordering = opts.ordering ?? 'GB1';
  return buildPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /CJKSans /Encoding /${opts.encoding} /DescendantFonts [6 0 R] >>\nendobj\n`,
    `6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /CJKSans /CIDSystemInfo << /Registry (Adobe) /Ordering (${ordering}) /Supplement 0 >> /DW 1000 >>\nendobj\n`,
  ]);
}

describe('predefined Encoding CMaps', () => {
  it('maps GBK-EUC-H bytes D6D0 to CID 4559', () => {
    const cmap = encodingCmap('GBK-EUC-H');
    expect(cmap).toBeDefined();
    const got = cmap!.decode(new Uint8Array([0xd6, 0xd0]), 0);
    expect(got).toEqual({ code: 0xd6d0, cid: 4559, size: 2 });
  });

  it('extracts 中 from GBK-EUC-H without ToUnicode', () => {
    const md = toMarkdownFromPdf(type0Pdf({ encoding: 'GBK-EUC-H', shownHex: 'd6d0' }));
    expect(md).toContain('中');
  });

  it('extracts 中 from ETen-B5-H and 90ms-RKSJ-H', () => {
    expect(
      toMarkdownFromPdf(type0Pdf({ encoding: 'ETen-B5-H', shownHex: 'a4a4', ordering: 'CNS1' })),
    ).toContain('中');
    expect(
      toMarkdownFromPdf(
        type0Pdf({ encoding: '90ms-RKSJ-H', shownHex: '9286', ordering: 'Japan1' }),
      ),
    ).toContain('中');
  });

  it('extracts 中 from UniGB-UTF16-H as Unicode passthrough', () => {
    expect(uniKind('UniGB-UTF16-H')).toBe('utf16');
    const md = toMarkdownFromPdf(
      type0Pdf({ encoding: 'UniGB-UTF16-H', shownHex: '4e2d', ordering: 'GB1' }),
    );
    expect(md).toContain('中');
  });

  it('extracts 中 from UniGB-UTF8-H', () => {
    expect(uniKind('/UniGB-UTF8-V')).toBe('utf8');
    const md = toMarkdownFromPdf(
      type0Pdf({ encoding: 'UniGB-UTF8-H', shownHex: 'e4b8ad', ordering: 'GB1' }),
    );
    expect(md).toContain('中');
  });

  it('parses an embedded CMap that usecmaps GBK-EUC-H', () => {
    const cmap = parseEmbeddedCmap(`/GBK-EUC-H usecmap
/CMapName /Custom-GBK def
`);
    expect(cmap).toBeDefined();
    const got = cmap!.decode(new Uint8Array([0xd6, 0xd0]), 0);
    expect(got?.cid).toBe(4559);
  });

  it('infers Adobe ordering from Encoding names', () => {
    expect(inferAdobeOrdering('GBK-EUC-H')).toBe('GB1');
    expect(inferAdobeOrdering('/ETen-B5-H')).toBe('CNS1');
    expect(inferAdobeOrdering('90ms-RKSJ-H')).toBe('Japan1');
    expect(inferAdobeOrdering('KSCms-UHC-H')).toBe('Korea1');
    expect(inferAdobeOrdering('UniAKR-UTF16-H')).toBe('KR');
  });

  it('still decodes mixed 1-byte / 2-byte GBK ASCII + Han', () => {
    // 0x41 = 'A' (CID 814+0? <21><7e> 814 → 0x41 is 'A' CID 814+(0x41-0x21)=846)
    // then D6D0 = 中
    const md = toMarkdownFromPdf(type0Pdf({ encoding: 'GBK-EUC-H', shownHex: '41d6d0' }));
    expect(md).toContain('中');
  });
});
