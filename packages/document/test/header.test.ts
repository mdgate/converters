import { describe, expect, it } from 'vitest';
import { resolveHeaderRows } from '../src/header.js';
import { cellFromInlines, plain, tableFromRows } from '../src/model/index.js';

describe('resolveHeaderRows', () => {
  const detect = (rows: string[][]): number => {
    const cells = rows.map((r) => r.map((t) => cellFromInlines([plain(t)])));
    return resolveHeaderRows(tableFromRows(cells, 0, 'data'), 0);
  };

  it('detects header rows', () => {
    expect(
      detect([
        ['name', 'qty'],
        ['a', '1'],
        ['b', '2'],
      ]),
    ).toBe(1);
    expect(
      detect([
        ['36', '12', 'aka'],
        ['173', '57', 'aka'],
        ['306', '220', 'aka'],
      ]),
    ).toBe(0);
  });
});
