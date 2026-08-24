import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { InflateLimitError, inflateGzip, inflateRaw, inflateZlib } from '../src/index.js';

function eq(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual).toEqual(expected);
}

describe('inflate', () => {
  it('inflates raw DEFLATE', () => {
    const src = new TextEncoder().encode('hello '.repeat(20));
    const raw = zlib.deflateRawSync(src);
    eq(inflateRaw(raw, 10_000), src);
  });

  it('inflates zlib-wrapped DEFLATE', () => {
    const src = new TextEncoder().encode('hello '.repeat(20));
    const wrapped = zlib.deflateSync(src);
    eq(inflateZlib(wrapped, 10_000), src);
  });

  it('inflates gzip-wrapped DEFLATE', () => {
    const src = new TextEncoder().encode('hello '.repeat(20));
    eq(inflateGzip(zlib.gzipSync(src), 10_000), src);
  });

  it('matches node:zlib across levels and stored blocks', () => {
    const samples = [
      new Uint8Array([1, 2, 3, 4, 5]),
      new TextEncoder().encode('a'),
      new TextEncoder().encode('hello world '.repeat(200)),
      new Uint8Array(4096).fill(65),
      new Uint8Array(1024).map((_, i) => i & 0xff),
    ];
    for (const src of samples) {
      for (const level of [0, 1, 6, 9] as const) {
        eq(inflateRaw(zlib.deflateRawSync(src, { level }), src.length + 16), src);
        eq(inflateZlib(zlib.deflateSync(src, { level }), src.length + 16), src);
        eq(inflateGzip(zlib.gzipSync(src, { level }), src.length + 16), src);
      }
    }
  });

  it('throws InflateLimitError when output exceeds maxOut', () => {
    const src = new Uint8Array(10_000).fill(65);
    const raw = zlib.deflateRawSync(src);
    expect(() => inflateRaw(raw, 100)).toThrow(InflateLimitError);
  });

  it('allows output that is exactly maxOut', () => {
    const src = new TextEncoder().encode('abcd');
    const raw = zlib.deflateRawSync(src);
    eq(inflateRaw(raw, src.length), src);
  });

  it('returns empty for empty input', () => {
    expect(inflateRaw(new Uint8Array(), 16)).toEqual(new Uint8Array());
    expect(inflateZlib(new Uint8Array(), 16)).toEqual(new Uint8Array());
    expect(inflateGzip(new Uint8Array(), 16)).toEqual(new Uint8Array());
  });

  it('rejects corrupt input', () => {
    expect(() => inflateRaw(Uint8Array.of(0x00, 0x01, 0x02, 0x03), 1024)).toThrow();
    expect(() => inflateZlib(Uint8Array.of(0x78, 0x01), 1024)).toThrow();
    expect(() => inflateGzip(Uint8Array.of(0x1f, 0x8b, 0x08), 1024)).toThrow();
  });

  it('can ignore a bad zlib Adler32', () => {
    const src = new TextEncoder().encode('hello world');
    const wrapped = new Uint8Array(zlib.deflateSync(src));
    wrapped[wrapped.length - 1] ^= 0xff;
    expect(() => inflateZlib(wrapped, 1024)).toThrow();
    eq(inflateZlib(wrapped, 1024, 'optional'), src);
  });
});
