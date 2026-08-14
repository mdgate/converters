import type { Block } from './block.js';

/** The marker family a list level uses in the source document. */
export type MarkerKind =
  | 'bullet'
  | 'decimal'
  | 'lowerAlpha'
  | 'upperAlpha'
  | 'lowerRoman'
  | 'upperRoman';

export function markerIsOrdered(kind: MarkerKind): boolean {
  return kind !== 'bullet';
}

/**
 * The marker text for ordinal `n` (1-based), without trailing space:
 * `3.`, `c.`, `iv.`; bullets have no ordinal text.
 */
export function markerLabel(kind: MarkerKind, n: number): string {
  return kind === 'bullet' ? '-' : `${markerOrdinal(kind, n)}.`;
}

/** The bare ordinal text for `n` without punctuation: `3`, `c`, `iv`. */
export function markerOrdinal(kind: MarkerKind, n: number): string {
  switch (kind) {
    case 'bullet':
      return '-';
    case 'decimal':
      return String(n);
    case 'lowerAlpha':
      return alpha(n);
    case 'upperAlpha':
      return alpha(n).toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
  }
}

/** 1 -> `a`, 26 -> `z`, 27 -> `aa` (bijective base 26). */
function alpha(n: number): string {
  if (n === 0) return '0';
  const out: number[] = [];
  let x = n;
  while (x > 0) {
    x -= 1;
    out.push(97 + (x % 26));
    x = Math.floor(x / 26);
  }
  out.reverse();
  return String.fromCharCode(...out);
}

function roman(n: number): string {
  if (n === 0 || n > 3999) return String(n);
  const numerals: readonly [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let x = n;
  let out = '';
  for (const [value, numeral] of numerals) {
    while (x >= value) {
      out += numeral;
      x -= value;
    }
  }
  return out;
}

/**
 * A fully resolved list: numbering identity and marker resolution happen in
 * the frontends, which split runs whenever the list instance or marker kind
 * changes.
 */
export interface List {
  marker: MarkerKind;
  /** Ordinal of the first item, from the source's own numbering. */
  start: number;
  items: ListItem[];
}

export function listIsOrdered(list: List): boolean {
  return markerIsOrdered(list.marker);
}

/** One item of a list, which may hold nested blocks including further lists. */
export interface ListItem {
  blocks: Block[];
  /** Checkbox state; `undefined` when the item carries no checkbox. */
  checked: boolean | undefined;
  /**
   * Literal marker text that overrides the level marker when the source
   * number text cannot be reproduced from marker + position alone.
   */
  markerLabel: string | undefined;
}

export function emptyListItem(): ListItem {
  return { blocks: [], checked: undefined, markerLabel: undefined };
}
