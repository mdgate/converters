import { describe, expect, it } from 'vitest';
import {
  buildIwa,
  decodeMessage,
  detectIWorkKind,
  openIWork,
  parseIwa,
  snappyDecode,
  snappyEncodeLiterals,
  TYPE,
} from '../src/index.js';
import { sampleKeynote, sampleNumbers, samplePages, zipStore } from './fixtures.js';

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
  it('reads objects from a pages Document.iwa inside the zip via detect path', () => {
    const iwa = buildIwa([
      { id: 1, type: TYPE.TP_DOCUMENT, payload: new Uint8Array([0x08, 0x01]) },
    ]);
    const objects = parseIwa(iwa);
    expect(objects).toHaveLength(1);
    expect(objects[0]!.id).toBe(1);
    expect(objects[0]!.type).toBe(TYPE.TP_DOCUMENT);
  });

  it('joins snappy chunks so ArchiveInfo can span the 64KiB block boundary', () => {
    const first = buildIwa([
      { id: 1, type: TYPE.TP_DOCUMENT, payload: new Uint8Array([0x08, 0x01]) },
    ]);
    const second = buildIwa([
      { id: 10, type: TYPE.TSWP_STORAGE, payload: new Uint8Array([0x08, 0x00]) },
    ]);
    const a = snappyDecode(first.subarray(4));
    const b = snappyDecode(second.subarray(4));
    const plain = new Uint8Array(a.length + b.length);
    plain.set(a, 0);
    plain.set(b, a.length);
    // Split inside the second ArchiveInfo so a per-chunk parser would throw.
    const cut = a.length + 2;
    const multi = concatChunks([plain.subarray(0, cut), plain.subarray(cut)]);
    const objects = parseIwa(multi);
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ id: 1, type: TYPE.TP_DOCUMENT });
    expect(objects[1]).toMatchObject({ id: 10, type: TYPE.TSWP_STORAGE });
  });
});

describe('protobuf varint', () => {
  it('accepts a 10-byte 64-bit varint and keeps reading the next field', () => {
    // field 6 wire 0 (tag 48) + 10-byte varint, then field 1 = 1.
    const bytes = Uint8Array.from([
      0x30, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x08, 0x01,
    ]);
    const fields = decodeMessage(bytes);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.field).toBe(6);
    expect(fields[0]!.value.kind).toBe('varint');
    expect(fields[1]).toEqual({ field: 1, value: { kind: 'varint', value: 1 } });
  });
});

describe('openIWork', () => {
  it('skips an unreadable sibling IWA and still classifies the document', () => {
    const archive = openIWork(
      zipStore({
        'Index/Document.iwa': sampleDocumentIwa(),
        // Valid snappy chunk whose payload is not an IWA object stream.
        'Index/CalculationEngine.iwa': wrapChunk(snappyEncodeLiterals(new Uint8Array([0xff]))),
      }),
    );
    expect(archive.kind).toBe('pages');
    expect(archive.objects.get(1)?.type).toBe(TYPE.TP_DOCUMENT);
  });
});

function sampleDocumentIwa(): Uint8Array {
  return buildIwa([{ id: 1, type: TYPE.TP_DOCUMENT, payload: new Uint8Array([0x08, 0x01]) }]);
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  const chunks = parts.map((part) => wrapChunk(snappyEncodeLiterals(part)));
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function wrapChunk(compressed: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + compressed.length);
  out[0] = 0;
  out[1] = compressed.length & 0xff;
  out[2] = (compressed.length >> 8) & 0xff;
  out[3] = (compressed.length >> 16) & 0xff;
  out.set(compressed, 4);
  return out;
}
