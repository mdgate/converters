import { describe, expect, it } from 'vitest';
import { type Converter, create } from '../src/index.js';

function stub(id: string, score: number, markdown: string): Converter {
  return {
    id,
    sniff: () => score,
    convert: () => ({ markdown }),
  };
}

describe('create', () => {
  it('throws unsupported when nothing sniffs the input', async () => {
    const convert = create([]);
    await expect(convert(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });

  it('picks the highest sniff score and keeps the first on a tie', async () => {
    const convert = create([stub('a', 2, 'A'), stub('b', 3, 'B'), stub('c', 3, 'C')]);
    await expect(convert(new Uint8Array([0]))).resolves.toBe('B');
  });

  it('rejects non-byte input', async () => {
    const convert = create([stub('any', 1, 'ok')]);
    await expect(convert('notes.csv' as unknown as Uint8Array)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });

  it('passes the path hint to sniff', async () => {
    const convert = create([
      {
        id: 'csv',
        sniff(_bytes, hint) {
          return hint?.path?.endsWith('.csv') ? 1 : 0;
        },
        convert: () => ({ markdown: 'csv' }),
      },
    ]);
    await expect(convert(new TextEncoder().encode('a,b\n'), { path: 'notes.csv' })).resolves.toBe(
      'csv',
    );
  });

  it('lets a converter send leftover bytes back through the same pool', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    const seen: string[] = [];
    const convert = create([
      {
        id: 'outer',
        sniff: (bytes) => (bytes[0] === 1 ? 2 : 0),
        async convert(_bytes, options) {
          const inner = await options!.convert!(jpeg, { path: 'x.jpg' });
          return { markdown: `outer+${inner}` };
        },
      },
      {
        id: 'inner',
        sniff: (bytes) => (bytes[0] === 0xff ? 2 : 0),
        convert() {
          seen.push('inner');
          return { markdown: 'leaf' };
        },
      },
    ]);
    await expect(convert(new Uint8Array([1]))).resolves.toBe('outer+leaf');
    expect(seen).toEqual(['inner']);
  });

  it('stops nested conversion after one hop', async () => {
    const convert = create([
      {
        id: 'loop',
        sniff: () => 2,
        async convert(bytes, options) {
          const next = new Uint8Array(bytes);
          next[0] = (next[0] ?? 0) + 1;
          return { markdown: await options!.convert!(next) };
        },
      },
    ]);
    await expect(convert(new Uint8Array([0]))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });
});
