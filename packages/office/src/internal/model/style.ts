/**
 * Fully resolved character style. Tri-state deltas exist only during
 * frontend resolution; by the time content reaches the model every toggle
 * has a definite value.
 */
export interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

export const PLAIN: Style = Object.freeze({
  bold: false,
  italic: false,
  strike: false,
  code: false,
});

export function stylesEqual(a: Style, b: Style): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code;
}
