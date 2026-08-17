import { describe, expect, it } from 'vitest';
import { samplePages } from '../../iwork-common/test/fixtures.js';
import { pages, toMarkdown } from '../src/index.js';

describe('pages', () => {
  it('sniffs synthetic pages bytes', () => {
    const bytes = samplePages('Hello from Pages');
    expect(pages().sniff(bytes)).toBe(2);
    expect(pages().sniff(new Uint8Array([1, 2, 3]), { path: 'x.pages' })).toBe(1);
  });

  it('converts body text to markdown', async () => {
    const md = await toMarkdown(samplePages('Hello from Pages'), { path: 'note.pages' });
    expect(md).toContain('Hello from Pages');
  });
});
