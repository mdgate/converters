import { describe, expect, it } from 'vitest';
import { normalizeCjkText, remapCjkCodePoint } from '../src/cjk.js';
import { pdfMaps } from '../src/maps.js';

describe('official CJK lookalike remapping', () => {
  it('ships the complete official table (1000+ mappings)', () => {
    expect(pdfMaps().cjkFrom.length).toBeGreaterThan(1000);
  });

  it('covers the full EquivalentUnifiedIdeograph set, not a case list', () => {
    expect(remapCjkCodePoint(0x2f17)).toBe(0x5341); // ⼗ → 十
    expect(remapCjkCodePoint(0x2f8f)).toBe(0x884c); // ⾏ → 行
    expect(remapCjkCodePoint(0x2ea0)).toBe(0x6c11); // ⺠ → 民
    expect(remapCjkCodePoint(0x2ed8)).toBe(0x9752); // ⻘ → 青
    expect(remapCjkCodePoint(0x2ed3)).toBe(0x957f); // ⻓ → 长
    expect(remapCjkCodePoint(0x2ed4)).toBe(0x95e8); // ⻔ → 门
    expect(remapCjkCodePoint(0x31d0)).toBe(0x4e00); // CJK stroke H → 一
    expect(remapCjkCodePoint(0x31cf)).toBe(0x4e40); // CJK stroke N
  });

  it('NFKC-maps CJK compatibility ideographs', () => {
    expect(remapCjkCodePoint(0xf90a)).not.toBe(0xf90a);
    expect(String.fromCodePoint(remapCjkCodePoint(0xf90a)).normalize('NFC').length).toBe(1);
  });

  it('does not invent simplified/traditional conversions', () => {
    expect(remapCjkCodePoint(0x9580)).toBe(0x9580); // 門 stays 門
    expect(remapCjkCodePoint(0x95e8)).toBe(0x95e8); // 门 stays 门
  });

  it('leaves ordinary Han and ASCII untouched', () => {
    expect(normalizeCjkText('汉字测试 ABC 2026')).toBe('汉字测试 ABC 2026');
  });

  it('maps a mixed radical string in one pass', () => {
    expect(normalizeCjkText('⼗⾏⽂⽹⼈⼉⽴⾼⿎⺠⻘')).toBe('十行文网人儿立高鼓民青');
  });
});
