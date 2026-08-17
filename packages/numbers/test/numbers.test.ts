import { describe, expect, it } from 'vitest';
import { sampleNumbers } from '../../iwork-common/test/fixtures.js';
import { numbers, toMarkdown } from '../src/index.js';

describe('numbers', () => {
  it('sniffs synthetic numbers bytes', () => {
    const bytes = sampleNumbers();
    expect(numbers().sniff(bytes)).toBe(2);
    expect(numbers().sniff(new Uint8Array([1, 2, 3]), { path: 'x.numbers' })).toBe(1);
  });

  it('converts sheet tables to markdown', async () => {
    const md = await toMarkdown(sampleNumbers(), { path: 'book.numbers' });
    expect(md).toContain('Name');
    expect(md).toContain('Ada');
  });
});
