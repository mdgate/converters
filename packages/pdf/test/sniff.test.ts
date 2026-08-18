import { describe, expect, it } from 'vitest';
import { pdf } from '../src/index.js';

describe('pdf converter', () => {
  it('sniffs %PDF magic, including after a short prefix', () => {
    const converter = pdf();
    expect(converter.sniff(Buffer.from('%PDF-1.7\n'))).toBe(2);
    const junk = Buffer.concat([Buffer.alloc(500, 32), Buffer.from('%PDF-1.4')]);
    expect(converter.sniff(junk)).toBe(2);
    expect(converter.sniff(Buffer.from('hello'), { path: 'notes.pdf' })).toBe(1);
    expect(converter.sniff(Buffer.from('hello'))).toBe(0);
  });
});
