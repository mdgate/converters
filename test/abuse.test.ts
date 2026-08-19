import { readFileSync } from 'node:fs';
import { toMarkdown } from '@mdgate/converters';
import { describe, expect, it } from 'vitest';
import { fixtureRel, listFixtures } from './corpus.js';

const abuse = listFixtures().filter((path) => fixtureRel(path).startsWith('abuse/'));

const written: Record<string, string> = {
  'abuse/hugerepeat--errors.ods': 'x',
  'abuse/hugespan--errors.ods': 'x',
  'abuse/hugespan--errors.pptx': 'x',
  'abuse/emptyrowrepeat--errors.ods': 'tail',
  'abuse/zipbomb--errors.docx': 'A',
  'abuse/imagebomb--errors.docx': 'before the image',
  'abuse/deepxml--errors.docx': 'deep',
};

describe('abuse fixtures convert', () => {
  it('has the transplanted abuse set', () => {
    expect(abuse).toHaveLength(8);
  });

  for (const path of abuse) {
    it(`${fixtureRel(path)} converts instead of refusing`, { timeout: 120_000 }, async () => {
      const markdown = await toMarkdown(readFileSync(path), { path });
      expect(markdown.length).toBeGreaterThan(0);
      const needle = written[fixtureRel(path)];
      if (needle !== undefined) expect(markdown).toContain(needle);
    });
  }
});
