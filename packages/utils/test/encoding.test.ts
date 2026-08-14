import { describe, expect, it } from 'vitest';
import { decode, encodingExists } from '../src/index.js';

describe('encodingExists', () => {
  it('accepts office labels', () => {
    for (const name of [
      'cp437',
      'windows-1252',
      'windows-1250',
      'iso-8859-1',
      'gbk',
      'shiftjis',
      'cp932',
      'big5',
      'utf8',
      'utf16-le',
    ]) {
      expect(encodingExists(name), name).toBe(true);
    }
  });

  it('rejects unknown labels', () => {
    expect(encodingExists('not-an-encoding')).toBe(false);
    expect(encodingExists('')).toBe(false);
  });
});

describe('decode', () => {
  it('decodes windows-1252 including 0x80–0x9F', () => {
    expect(decode(Uint8Array.of(0x80, 0x41), 'windows-1252')).toBe('\u20acA');
    expect(decode(Uint8Array.of(0x81), 'windows-1252')).toBe('\uFFFD');
  });

  it('decodes cp437 ZIP names', () => {
    expect(decode(Uint8Array.of(0xe1, 0x82), 'cp437')).toBe('ßé');
  });

  it('decodes iso-8859-1 as Latin-1, not windows-1252', () => {
    expect(decode(Uint8Array.of(0x80), 'iso-8859-1')).toBe('\u0080');
  });

  it('maps high ascii bytes to U+FFFD', () => {
    expect(decode(Uint8Array.of(0x80), 'ascii')).toBe('\uFFFD');
  });

  it('decodes GBK and Shift-JIS', () => {
    expect(decode(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4), 'gbk')).toBe('中文');
    expect(decode(Uint8Array.of(0x93, 0xfa, 0x96, 0x7b), 'shiftjis')).toBe('日本');
    expect(decode(Uint8Array.of(0x93, 0xfa, 0x96, 0x7b), 'cp932')).toBe('日本');
  });

  it('accepts common aliases', () => {
    expect(decode(Uint8Array.of(0xe9), 'latin1')).toBe('é');
    expect(decode(Uint8Array.of(0x41, 0x00), 'utf16-le')).toBe('A');
  });

  it('returns empty string for empty input', () => {
    expect(decode(new Uint8Array(), 'windows-1252')).toBe('');
  });
});
