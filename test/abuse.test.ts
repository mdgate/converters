import { readFileSync } from 'node:fs';
import { ConvertError, toMarkdown } from '@mdgate/converters';
import { describe, expect, it } from 'vitest';
import { fixtureRel, listFixtures } from './corpus.js';

const abuse = listFixtures().filter((path) => fixtureRel(path).startsWith('abuse/'));

describe('abuse fixtures hard-fail', () => {
  it('has the transplanted abuse set', () => {
    expect(abuse).toHaveLength(8);
  });

  for (const path of abuse) {
    it(`${fixtureRel(path)} throws resourceLimit`, async () => {
      try {
        await toMarkdown(readFileSync(path), { path });
        throw new Error('expected resourceLimit');
      } catch (err) {
        expect(err).toBeInstanceOf(ConvertError);
        expect((err as ConvertError).code).toBe('resourceLimit');
      }
    });
  }
});
