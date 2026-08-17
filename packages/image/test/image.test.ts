import { create } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { image } from '../src/index.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('image', () => {
  it('sniffs magic and extensions', () => {
    const converter = image(async () => 'x');
    expect(converter.id).toBe('image');
    expect(converter.sniff(PNG)).toBe(2);
    expect(converter.sniff(JPEG)).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.webp' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
  });

  it('converts a standalone image through the registered function', async () => {
    const convert = create([image(async ({ mime, page }) => `got ${mime} p${page ?? '-'}`)]);
    await expect(convert(PNG)).resolves.toBe('got image/png p-\n');
    await expect(convert(JPEG, { page: 3 })).resolves.toBe('got image/jpeg p3\n');
  });
});
