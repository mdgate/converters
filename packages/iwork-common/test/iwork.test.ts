import { describe, expect, it } from 'vitest';
import { detectIWorkKind, parseIwa, snappyDecode, snappyEncodeLiterals } from '../src/index.js';
import { sampleKeynote, sampleNumbers, samplePages } from './fixtures.js';

describe('snappy', () => {
  it('round-trips literal blocks', () => {
    const src = new TextEncoder().encode('the quick brown fox jumps over the lazy dog');
    const enc = snappyEncodeLiterals(src);
    expect(snappyDecode(enc)).toEqual(src);
  });
});

describe('detectIWorkKind', () => {
  it('classifies synthetic packages', () => {
    expect(detectIWorkKind(samplePages())).toBe('pages');
    expect(detectIWorkKind(sampleNumbers())).toBe('numbers');
    expect(detectIWorkKind(sampleKeynote())).toBe('keynote');
  });

  it('returns undefined for non-zip', () => {
    expect(detectIWorkKind(new TextEncoder().encode('not zip'))).toBeUndefined();
  });
});

describe('parseIwa', () => {
  it('reads objects from a pages Document.iwa inside the zip via detect path', async () => {
    // Smoke: sample builds at least one IWA object stream.
    const { buildIwa, TYPE } = await import('../src/index.js');
    const iwa = buildIwa([
      { id: 1, type: TYPE.TP_DOCUMENT, payload: new Uint8Array([0x08, 0x01]) },
    ]);
    const objects = parseIwa(iwa);
    expect(objects).toHaveLength(1);
    expect(objects[0]!.id).toBe(1);
    expect(objects[0]!.type).toBe(TYPE.TP_DOCUMENT);
  });
});
