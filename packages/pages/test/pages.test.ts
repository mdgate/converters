import { describe, expect, it } from 'vitest';
import { samplePages, zipStore } from '../../iwork-common/test/fixtures.js';
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

  it('sniffs and converts a pre-IWA index.xml package', async () => {
    const bytes = zipStore({
      'index.xml': new TextEncoder().encode(`<?xml version="1.0"?>
<sl:document xmlns:sl="http://developer.apple.com/namespaces/sl" xmlns:sf="http://developer.apple.com/namespaces/sf">
  <sf:p><sf:text>Hello from Pages 09</sf:text></sf:p>
</sl:document>`),
    });
    expect(pages().sniff(bytes, { path: 'note.pages' })).toBe(2);
    const md = await toMarkdown(bytes, { path: 'note.pages' });
    expect(md).toContain('Hello from Pages 09');
  });
});
