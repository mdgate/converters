import { ConvertError, create } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { image, svg, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const GIF87 = enc.encode('GIF87a');
const GIF89 = enc.encode('GIF89a');
const BMP = enc.encode('BM');
const TIFF_LE = new Uint8Array([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]);
const HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
]);
const HEIF = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
]);
const MIF1 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0x00, 0x00, 0x00, 0x00,
]);
const SVG_HI = enc.encode('<svg><text>Hi</text></svg>');
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe('image', () => {
  it('sniffs magic and extensions', () => {
    const converter = image(async () => 'x');
    expect(converter.id).toBe('image');
    expect(converter.sniff(PNG)).toBe(2);
    expect(converter.sniff(JPEG)).toBe(2);
    expect(converter.sniff(GIF87)).toBe(2);
    expect(converter.sniff(GIF89)).toBe(2);
    expect(converter.sniff(BMP)).toBe(2);
    expect(converter.sniff(TIFF_LE)).toBe(2);
    expect(converter.sniff(TIFF_BE)).toBe(2);
    expect(converter.sniff(HEIC)).toBe(2);
    expect(converter.sniff(HEIF)).toBe(2);
    expect(converter.sniff(MIF1)).toBe(2);
    expect(converter.sniff(SVG_HI)).toBe(2);
    expect(converter.sniff(enc.encode('<?xml version="1.0"?><svg></svg>'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.webp' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.gif' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.tif' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.heic' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.bmp' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.svg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
  });

  it('converts a standalone image through the registered function', async () => {
    const convert = create([image(async ({ mime, page }) => `got ${mime} p${page ?? '-'}`)]);
    await expect(convert(PNG)).resolves.toBe('got image/png p-\n');
    await expect(convert(JPEG, { page: 3 })).resolves.toBe('got image/jpeg p3\n');
    await expect(convert(GIF89)).resolves.toBe('got image/gif p-\n');
  });

  it('converts svg locally without the vision callback', async () => {
    let called = 0;
    const convert = create([
      image(async () => {
        called += 1;
        throw new Error('vision should not run for svg');
      }),
    ]);
    await expect(convert(SVG_HI)).resolves.toBe('Hi\n');
    expect(called).toBe(0);
  });

  it('refuses a PDF/office file', async () => {
    const converter = image(async () => 'x');
    await expect(converter.convert(enc.encode('%PDF-1.7\n'))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(converter.convert(OLE, { path: 'scan.png' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });
});

describe('svg', () => {
  it('sniffs magic and extensions', () => {
    const converter = svg();
    expect(converter.id).toBe('svg');
    expect(converter.sniff(SVG_HI)).toBe(3);
    expect(converter.sniff(enc.encode('<?xml version="1.0"?><svg></svg>'))).toBe(3);
    expect(converter.sniff(new Uint8Array([1]), { path: 'icon.svg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(PNG)).toBe(0);
  });

  it('converts a tiny svg with text', async () => {
    await expect(toMarkdown(SVG_HI)).resolves.toBe('Hi\n');
  });

  it('extracts title and desc, and notes a bare svg', async () => {
    await expect(
      toMarkdown(enc.encode('<svg><title>Logo</title><desc>Mark</desc></svg>')),
    ).resolves.toBe('# Logo\n\nMark\n');
    await expect(toMarkdown(enc.encode('<svg></svg>'))).resolves.toBe('This is an SVG image.\n');
  });

  it('refuses a PDF/office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.svg' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => svg().convert(OLE)).toThrow(ConvertError);
  });
});
