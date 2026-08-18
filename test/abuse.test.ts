import { readFileSync } from 'node:fs';
import { toMarkdown } from '@mdgate/converters';
import { describe, expect, it } from 'vitest';
import { fixtureRel, listFixtures } from './corpus.js';

const abuse = listFixtures().filter((path) => fixtureRel(path).startsWith('abuse/'));
const byRel = Object.fromEntries(abuse.map((path) => [fixtureRel(path), path]));

describe('abuse fixtures convert', () => {
  it('has the transplanted abuse set', () => {
    expect(abuse).toHaveLength(8);
  });

  for (const path of abuse) {
    it(`${fixtureRel(path)} converts instead of refusing`, { timeout: 120_000 }, async () => {
      const markdown = await toMarkdown(readFileSync(path), { path });
      expect(markdown.length).toBeGreaterThan(0);
    });
  }

  it('keeps written table text from huge repeat and span files', { timeout: 120_000 }, async () => {
    const hugerepeat = await toMarkdown(readFileSync(byRel['abuse/hugerepeat--errors.ods']!), {
      path: byRel['abuse/hugerepeat--errors.ods'],
    });
    expect(hugerepeat).toContain('x');

    const hugespan = await toMarkdown(readFileSync(byRel['abuse/hugespan--errors.ods']!), {
      path: byRel['abuse/hugespan--errors.ods'],
    });
    expect(hugespan).toContain('x');

    const hugespanPptx = await toMarkdown(readFileSync(byRel['abuse/hugespan--errors.pptx']!), {
      path: byRel['abuse/hugespan--errors.pptx'],
    });
    expect(hugespanPptx).toContain('x');

    const emptyrow = await toMarkdown(readFileSync(byRel['abuse/emptyrowrepeat--errors.ods']!), {
      path: byRel['abuse/emptyrowrepeat--errors.ods'],
    });
    expect(emptyrow).toContain('tail');
  });

  it('keeps written text from zip and image bombs', { timeout: 120_000 }, async () => {
    const zipbomb = await toMarkdown(readFileSync(byRel['abuse/zipbomb--errors.docx']!), {
      path: byRel['abuse/zipbomb--errors.docx'],
    });
    expect(zipbomb).toContain('A');

    const imagebomb = await toMarkdown(readFileSync(byRel['abuse/imagebomb--errors.docx']!), {
      path: byRel['abuse/imagebomb--errors.docx'],
    });
    expect(imagebomb).toContain('before the image');
  });

  it('keeps written text from deep xml and ppt nest files', { timeout: 120_000 }, async () => {
    const deepxml = await toMarkdown(readFileSync(byRel['abuse/deepxml--errors.docx']!), {
      path: byRel['abuse/deepxml--errors.docx'],
    });
    expect(deepxml).toContain('deep');

    const deepnest = await toMarkdown(readFileSync(byRel['abuse/deepnest--errors.ppt']!), {
      path: byRel['abuse/deepnest--errors.ppt'],
    });
    expect(deepnest.length).toBeGreaterThan(0);
  });
});
