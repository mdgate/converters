import { describe, expect, it } from 'vitest';
import { decodeZ85, pdfMaps } from '../src/maps.js';

describe('embedded PDF maps', () => {
  it('decodes the Z85 spec vector', () => {
    const bytes = decodeZ85('HelloWorld', 0);
    expect([...bytes]).toEqual([0x86, 0x4f, 0xd2, 0x6f, 0xb5, 0x59, 0xf7, 0x5b]);
  });

  it('inflates the bundled tables', () => {
    const maps = pdfMaps();
    expect(maps.cjkFrom.length).toBeGreaterThan(1000);
    expect(maps.glyphListText.length).toBeGreaterThan(1000);
  });
});
