import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { MAX_EXPANSION } from '../src/limits.js';
import {
  cellFromInlines,
  cellSpanning,
  emptyCell,
  GridBuilder,
  markerLabel,
  plain,
} from '../src/model/index.js';

function textCell(t: string) {
  return cellFromInlines([plain(t)]);
}

function widths(table: { grid: unknown[][] }): number[] {
  return table.grid.map((r) => r.length);
}

describe('MarkerKind labels', () => {
  it('covers the marker kinds', () => {
    expect(markerLabel('decimal', 7)).toBe('7.');
    expect(markerLabel('lowerAlpha', 3)).toBe('c.');
    expect(markerLabel('lowerAlpha', 27)).toBe('aa.');
    expect(markerLabel('upperAlpha', 2)).toBe('B.');
    expect(markerLabel('lowerRoman', 4)).toBe('iv.');
    expect(markerLabel('lowerRoman', 1994)).toBe('mcmxciv.');
    expect(markerLabel('upperRoman', 9)).toBe('IX.');
  });
});

describe('GridBuilder', () => {
  it('covers col-span positions', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(cellSpanning([], 2, 1));
    b.place(textCell('end'));
    const t = b.finish('data');
    expect(widths(t)).toEqual([3]);
    expect(t.grid[0]![1]).toMatchObject({ type: 'covered', originRow: 0, originCol: 0 });
  });

  it('skips the next-row position of a row-span', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(cellSpanning([], 1, 2));
    b.place(textCell('b1'));
    b.nextRow();
    b.place(textCell('b2'));
    const t = b.finish('data');
    expect(widths(t)).toEqual([2, 2]);
    expect(t.grid[1]![0]).toMatchObject({ type: 'covered', originRow: 0, originCol: 0 });
    expect(t.grid[1]![1]?.type).toBe('origin');
  });

  it('consumes an explicit covered cell', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(cellSpanning([], 2, 1));
    expect(b.covered()).toBe(true);
    b.place(textCell('end'));
    expect(widths(b.finish('data'))).toEqual([3]);
  });

  it('turns a stray covered marker into an empty cell', () => {
    const b = new GridBuilder();
    b.nextRow();
    expect(b.covered()).toBe(false);
    b.place(textCell('x'));
    expect(widths(b.finish('data'))).toEqual([2]);
  });

  it('hits the expansion budget before expanding a huge span', () => {
    const b = new GridBuilder();
    b.nextRow();
    try {
      b.place(cellSpanning([], 0xffffffff, 0xffffffff));
      throw new Error('expected resourceLimit');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('resourceLimit');
      expect((err as ConvertError).limit).toBe('max_expansion');
    }
  });

  it('hits the expansion budget on accumulated spans', () => {
    const b = new GridBuilder();
    b.expansion = BigInt(MAX_EXPANSION) - 10n;
    b.nextRow();
    b.place(cellSpanning([], 3, 3));
    try {
      b.place(cellSpanning([], 2, 2));
      throw new Error('expected resourceLimit');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('resourceLimit');
    }
  });

  it('trims trailing empty rows', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(textCell('x'));
    b.nextRow();
    b.place(emptyCell());
    expect(widths(b.finish('data'))).toEqual([1]);
  });
});
