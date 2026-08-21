import { describe, expect, it } from 'vitest';
import { sampleKeynote, sampleKeynoteField2 } from '../../iwork-common/test/fixtures.js';
import { keynote, toMarkdown } from '../src/index.js';

describe('keynote', () => {
  it('sniffs synthetic keynote bytes', () => {
    const bytes = sampleKeynote();
    expect(keynote().sniff(bytes)).toBe(2);
    expect(keynote().sniff(new Uint8Array([1, 2, 3]), { path: 'deck.key' })).toBe(1);
  });

  it('converts slide title text to markdown', async () => {
    const md = await toMarkdown(sampleKeynote('Hello Keynote'), { path: 'deck.key' });
    expect(md).toContain('Hello Keynote');
  });

  it('converts slides listed on slideTree field 2', async () => {
    const md = await toMarkdown(sampleKeynoteField2('Slide From Field Two'), { path: 'deck.key' });
    expect(md).toContain('Slide From Field Two');
  });
});
