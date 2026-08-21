import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { mobi, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

describe('mobi', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = mobi();
    expect(converter.id).toBe('mobi');
    const book = buildUncompressedMobi(SAMPLE_HTML, 'Tiny Book');
    expect(converter.sniff(book)).toBe(2);
    expect(converter.sniff(buildPalmDoc('Hello from PalmDOC.\n'))).toBe(2);
    expect(
      converter.sniff(
        buildUncompressedMobi(SAMPLE_HTML, 'Tiny Book', { type: 'DATA', creator: 'TEST' }),
      ),
    ).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'book.mobi' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Book.AZW3' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'doc.azw' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'old.prc' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(enc.encode('<html><body>hi</body></html>'))).toBe(0);
  });

  it('parses Gutenberg-style tag soup with unquoted attributes', async () => {
    const html = [
      '<html><head><title>Alice</title></head><body>',
      '<h1>Down the Rabbit-Hole</h1>',
      '<p>Alice was beginning to get very tired</p>',
      '<a filepos=000012345>of sitting by her sister</a>',
      '</body></html>',
    ].join('');
    const bytes = buildUncompressedMobi(html, "Alice's Adventures in Wonderland");
    const md = await toMarkdown(bytes);
    expect(md).toContain('Down the Rabbit-Hole');
    expect(md).toContain('Alice was beginning to get very tired');
    expect(md).toContain('of sitting by her sister');
  });

  it('converts a synthetic uncompressed MOBI with XHTML', async () => {
    const bytes = buildUncompressedMobi(SAMPLE_HTML, 'Tiny Book');
    await expect(toMarkdown(bytes)).resolves.toBe(
      '# Tiny Book\n\n# Chapter 1\n\nThis is a *tiny* MOBI.\n',
    );
  });

  it('converts PalmDOC LZ77 text', async () => {
    const text = 'Hello from PalmDOC.\n\nSecond paragraph.';
    const bytes = buildPalmDoc(text, { compress: true, name: 'Palm Note' });
    await expect(toMarkdown(bytes)).resolves.toBe(
      '# Palm Note\n\nHello from PalmDOC.\n\nSecond paragraph.\n',
    );
  });

  it('refuses encrypted MOBI', () => {
    const bytes = buildUncompressedMobi(SAMPLE_HTML, 'Secret', { encryption: 2 });
    expect(() => mobi().convert(bytes)).toThrow(ConvertError);
    try {
      mobi().convert(bytes);
    } catch (e) {
      expect(e).toMatchObject({ name: 'ConvertError', code: 'encrypted' });
    }
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.mobi' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => mobi().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => mobi().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
    expect(() =>
      mobi().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
  });
});

const SAMPLE_HTML = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<html xmlns="http://www.w3.org/1999/xhtml">',
  '<head><title>Tiny Book</title></head>',
  '<body>',
  '<h1>Chapter 1</h1>',
  '<p>This is a <i>tiny</i> MOBI.</p>',
  '</body></html>',
].join('');

function buildUncompressedMobi(
  html: string,
  title: string,
  opts: { encryption?: number; type?: string; creator?: string } = {},
): Uint8Array {
  const text = enc.encode(html);
  const rec0 = buildMobiRecord0({
    compression: 1,
    textLength: text.length,
    recordCount: 1,
    encryption: opts.encryption ?? 0,
    title,
  });
  return buildPalmDb({
    type: opts.type ?? 'BOOK',
    creator: opts.creator ?? 'MOBI',
    name: title,
    records: [rec0, text],
  });
}

function buildPalmDoc(text: string, opts: { compress?: boolean; name?: string } = {}): Uint8Array {
  const raw = enc.encode(text);
  const payload = opts.compress === true ? palmdocCompress(raw) : raw;
  const rec0 = new Uint8Array(16);
  writeU16(rec0, 0, opts.compress === true ? 2 : 1);
  writeU32(rec0, 4, raw.length);
  writeU16(rec0, 8, 1);
  writeU16(rec0, 10, 4096);
  return buildPalmDb({
    type: 'TEXt',
    creator: 'REAd',
    name: opts.name ?? 'Palm Note',
    records: [rec0, payload],
  });
}

function buildMobiRecord0(opts: {
  compression: number;
  textLength: number;
  recordCount: number;
  encryption: number;
  title: string;
}): Uint8Array {
  const headerLen = 0xe8;
  const titleBytes = enc.encode(opts.title);
  const nameOff = 16 + headerLen;
  const rec0 = new Uint8Array(nameOff + titleBytes.length + 2);
  writeU16(rec0, 0, opts.compression);
  writeU32(rec0, 4, opts.textLength);
  writeU16(rec0, 8, opts.recordCount);
  writeU16(rec0, 10, 4096);
  writeU16(rec0, 12, opts.encryption);
  writeAscii(rec0, 16, 'MOBI');
  writeU32(rec0, 20, headerLen);
  writeU32(rec0, 24, 2);
  writeU32(rec0, 28, 65001);
  writeU32(rec0, 32, 1);
  writeU32(rec0, 36, 6);
  for (let o = 40; o < 80; o += 4) writeU32(rec0, o, 0xffffffff);
  writeU32(rec0, 80, 1 + opts.recordCount);
  writeU32(rec0, 84, nameOff);
  writeU32(rec0, 88, titleBytes.length);
  writeU32(rec0, 108, 0xffffffff);
  writeU32(rec0, 168, 0xffffffff);
  writeU32(rec0, 172, 0xffffffff);
  writeU16(rec0, 192, 1);
  writeU16(rec0, 194, opts.recordCount);
  rec0.set(titleBytes, nameOff);
  return rec0;
}

function buildPalmDb(opts: {
  type: string;
  creator: string;
  name: string;
  records: Uint8Array[];
}): Uint8Array {
  const n = opts.records.length;
  const headerSize = 78 + n * 8 + 2;
  const offsets: number[] = [];
  let off = headerSize;
  for (const rec of opts.records) {
    offsets.push(off);
    off += rec.length;
  }
  const out = new Uint8Array(off);
  const name = enc.encode(opts.name.slice(0, 31));
  out.set(name, 0);
  writeAscii(out, 60, opts.type);
  writeAscii(out, 64, opts.creator);
  writeU16(out, 76, n);
  for (let i = 0; i < n; i += 1) {
    writeU32(out, 78 + i * 8, offsets[i]!);
    out[78 + i * 8 + 7] = i & 0xff;
  }
  for (let i = 0; i < n; i += 1) out.set(opts.records[i]!, offsets[i]!);
  return out;
}

function palmdocCompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    if (i > 10 && data.length - i > 2) {
      let bestN = 0;
      let bestDist = 0;
      const maxN = Math.min(10, data.length - i);
      for (let n = maxN; n >= 3; n -= 1) {
        const start = Math.max(0, i - 2047);
        for (let d = i - 1; d >= start; d -= 1) {
          let k = 0;
          while (k < n && data[d + k] === data[i + k]) k += 1;
          if (k === n) {
            bestN = n;
            bestDist = i - d;
            break;
          }
        }
        if (bestN > 0) break;
      }
      if (bestN >= 3) {
        const code = 0x8000 + ((bestDist << 3) & 0x3ff8) + (bestN - 3);
        out.push(code >> 8, code & 0xff);
        i += bestN;
        continue;
      }
    }
    const ch = data[i]!;
    if (ch === 0x20 && i + 1 < data.length) {
      const next = data[i + 1]!;
      if (next >= 0x40 && next < 0x80) {
        out.push(next ^ 0x80);
        i += 2;
        continue;
      }
    }
    if (ch === 0 || (ch > 8 && ch < 0x80)) {
      out.push(ch);
      i += 1;
      continue;
    }
    const seq: number[] = [ch];
    i += 1;
    while (i < data.length && seq.length < 8) {
      const b = data[i]!;
      if (b === 0 || (b > 8 && b < 0x80)) break;
      seq.push(b);
      i += 1;
    }
    out.push(seq.length, ...seq);
  }
  return Uint8Array.from(out);
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
}
