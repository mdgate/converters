import { describe, expect, it } from 'vitest';
import { doc } from '../src/index.js';

const enc = new TextEncoder();

describe('doc', () => {
  it('does not claim Graphviz .dot by path', () => {
    const converter = doc();
    expect(converter.id).toBe('doc');
    expect(converter.sniff(enc.encode('digraph { a -> b; }'), { path: 'g.dot' })).toBe(0);
    expect(converter.sniff(enc.encode('// c\ngraph { a -- b; }'), { path: 'g.dot' })).toBe(0);
    expect(
      converter.sniff(enc.encode('/* c */\ndigraph tika {\n  a -> b;\n}\n'), {
        path: 'testGRAPHVIZdc.dot',
      }),
    ).toBe(0);
    expect(converter.sniff(enc.encode('x'), { path: 'letter.doc' })).toBe(1);
    expect(converter.sniff(enc.encode('{\\rtf1'), { path: 'letter.doc' })).toBe(0);
    expect(converter.sniff(enc.encode('x'), { path: 'letter.dot' })).toBe(0);
  });
});
