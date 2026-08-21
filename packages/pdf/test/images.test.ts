import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { describe, expect, it } from 'vitest';
import { xObjectToImage } from '../src/images.js';
import { pdf } from '../src/index.js';
import { toMarkdownFromPdf } from '../src/pdf.js';

const JPEG_A = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0x01]);
const JPEG_B = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0x02]);

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

function buildPdf(objects: Array<string | Uint8Array>): Uint8Array {
  const chunks: Array<string | Uint8Array> = ['%PDF-1.4\n'];
  const offsets = [0];
  let size = '%PDF-1.4\n'.length;
  for (const obj of objects) {
    offsets.push(size);
    chunks.push(obj);
    size += typeof obj === 'string' ? new TextEncoder().encode(obj).length : obj.length;
  }
  const xrefAt = size;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  chunks.push(
    `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
  return concatParts(chunks);
}

function imageObj(num: number, bytes: Uint8Array, filter = '/DCTDecode'): Uint8Array {
  return concatParts([
    `${num} 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${bytes.length} >>\nstream\n`,
    bytes,
    '\nendstream\nendobj\n',
  ]);
}

function jpegPdf(opts: {
  drawTwice?: boolean;
  secondImage?: boolean;
  withText?: boolean;
}): Uint8Array {
  const draws = opts.drawTwice
    ? 'q 40 0 0 40 10 40 cm /Im1 Do Q\nq 40 0 0 40 60 40 cm /Im1 Do Q\n'
    : 'q 80 0 0 80 20 20 cm /Im1 Do Q\n';
  const extraDraw = opts.secondImage ? 'q 40 0 0 40 20 80 cm /Im2 Do Q\n' : '';
  const text = opts.withText ? 'BT /F1 12 Tf 1 0 0 1 20 100 Tm (Hello) Tj ET\n' : '';
  const content = `${text}${draws}${extraDraw}`;
  const xobjs = opts.secondImage ? '/Im1 6 0 R /Im2 7 0 R' : '/Im1 6 0 R';
  const objects: Array<string | Uint8Array> = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << ${xobjs} >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    imageObj(6, JPEG_A),
  ];
  if (opts.secondImage) objects.push(imageObj(7, JPEG_B));
  return buildPdf(objects);
}

function rawRgbPdf(): Uint8Array {
  const pixels = Uint8Array.of(255, 0, 0);
  const content = 'q 10 0 0 10 5 5 cm /Im1 Do Q\n';
  return buildPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 40] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    concatParts([
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`,
      pixels,
      '\nendstream\nendobj\n',
    ]),
  ]);
}

describe('pdf image handoff', () => {
  it('does not convert images when image is not registered', async () => {
    expect(toMarkdownFromPdf(jpegPdf({}))).toBe('');
    const md = toMarkdownFromPdf(jpegPdf({ withText: true }));
    expect(md).toContain('Hello');
    expect(md).not.toContain('IMG');
    const convert = create([pdf()]);
    await expect(convert(jpegPdf({}))).resolves.toBe('');
    await expect(convert(jpegPdf({ withText: true }))).resolves.toContain('Hello');
  });

  it('sends each distinct image through image and skips duplicates', async () => {
    const seen: Array<{ mime: string; bytes: number[] }> = [];
    const convert = create([
      pdf(),
      image(async ({ bytes, mime }) => {
        seen.push({ mime, bytes: [...bytes] });
        return `IMG-${bytes[bytes.length - 1]}`;
      }),
    ]);

    const once = await convert(jpegPdf({}));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ mime: 'image/jpeg', bytes: [...JPEG_A] });
    expect(once).toContain('IMG-1');

    seen.length = 0;
    const twice = await convert(jpegPdf({ drawTwice: true }));
    expect(seen).toHaveLength(1);
    expect(twice.match(/IMG-1/g)).toHaveLength(1);

    seen.length = 0;
    const two = await convert(jpegPdf({ secondImage: true }));
    expect(seen).toHaveLength(2);
    expect(two).toContain('IMG-1');
    expect(two).toContain('IMG-2');
  });

  it('keeps extracted text and inserts converted images', async () => {
    const convert = create([pdf(), image(async () => 'PICTURE')]);
    const md = await convert(jpegPdf({ withText: true }));
    expect(md).toContain('Hello');
    expect(md).toContain('PICTURE');
  });

  it('encodes unfiltered RGB images as PNG and routes them through the pool', async () => {
    const convert = create([
      pdf(),
      image(async ({ bytes, mime }) => {
        expect(mime).toBe('image/png');
        expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return 'RED';
      }),
    ]);
    const md = await convert(rawRgbPdf());
    expect(md).toContain('RED');
  });
});

describe('xObjectToImage', () => {
  it('passes DCT streams through as JPEG', () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0x00, 0xd9);
    const out = xObjectToImage({
      width: 1,
      height: 1,
      colorSpace: '/DeviceRGB',
      bitsPerComponent: 8,
      filters: ['/DCTDecode'],
      data: jpeg,
    });
    expect(out).toEqual({ bytes: jpeg, mime: 'image/jpeg' });
  });

  it('extracts text drawn only through a Form XObject', () => {
    const formContent = 'BT /F1 12 Tf 1 0 0 1 20 50 Tm (Form Hello) Tj ET\n';
    const pageContent = '/Fm1 Do\n';
    const md = toMarkdownFromPdf(
      buildPdf([
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Contents 4 0 R /Resources << /XObject << /Fm1 6 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 200 140] /Resources << /Font << /F1 5 0 R >> >> /Length ${formContent.length} >>\nstream\n${formContent}endstream\nendobj\n`,
      ]),
    );
    expect(md).toContain('Form Hello');
  });

  it('skips filters we cannot decode', () => {
    expect(
      xObjectToImage({
        width: 10,
        height: 10,
        colorSpace: '/DeviceGray',
        bitsPerComponent: 1,
        filters: ['/CCITTFaxDecode'],
        data: new Uint8Array(20),
      }),
    ).toBeUndefined();
  });
});
