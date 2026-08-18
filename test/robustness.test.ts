/**
 * Deterministic mutation smoke test.
 * Conversions may fail; they must not hang or throw an untyped error.
 */

import { readFileSync } from 'node:fs';
import { ConvertError, toMarkdown } from '@mdgate/converters';
import { describe, expect, it } from 'vitest';
import { fixtureRel, listFixtures } from './corpus.js';

class Rng {
  private state: bigint;
  constructor(seed: bigint) {
    this.state = seed;
  }
  next(): bigint {
    let x = this.state;
    x ^= x >> 12n;
    x ^= x << 25n;
    x ^= x >> 27n;
    this.state = x & 0xffff_ffff_ffff_ffffn;
    return (this.state * 0x2545_f491_4f6c_dd1dn) & 0xffff_ffff_ffff_ffffn;
  }
}

describe('mutated fixtures never panic', () => {
  const files = listFixtures().filter((path) => !fixtureRel(path).startsWith('abuse/'));
  const rng = new Rng(0x5eed_1234_5678_9abcn);

  it('survives 25 mutations per non-abuse fixture', { timeout: 120_000 }, async () => {
    for (const path of files) {
      const original = readFileSync(path);
      if (original.length === 0) continue;
      for (let i = 0; i < 25; i += 1) {
        let bytes: Uint8Array = Buffer.from(original);
        const burst = 1 + Number(rng.next() % 8n);
        for (let j = 0; j < burst; j += 1) {
          const pos = Number(rng.next() % BigInt(bytes.length));
          bytes[pos] = Number(rng.next() & 0xffn);
        }
        if (rng.next() % 4n === 0n) {
          const cut = Math.max(1, Number(rng.next() % BigInt(bytes.length)));
          bytes = bytes.subarray(0, cut);
        }
        try {
          await toMarkdown(bytes, { path });
        } catch (err) {
          expect(err).toBeInstanceOf(ConvertError);
        }
      }
    }
  });
});
