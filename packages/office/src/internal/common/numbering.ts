import { type MarkerKind, markerLabel, markerOrdinal } from '../model/index.js';

/** One piece of a level's number text. */
export type NumberText = { type: 'literal'; text: string } | { type: 'level'; level: number };

/** A level's resolved number pattern. */
export interface NumberPattern {
  text: NumberText[];
  legal: boolean;
}

export function emptyNumberPattern(): NumberPattern {
  return { text: [], legal: false };
}

/** Parse WordprocessingML-style percent patterns (`%1`–`%9`). */
export function parsePercentPattern(text: string): NumberText[] {
  const out: NumberText[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]!;
    if (c === '%') {
      const next = chars[i + 1];
      const d = next !== undefined ? next.charCodeAt(0) - 48 : -1;
      if (d >= 1 && d <= 9) {
        i += 1;
        out.push({ type: 'level', level: d - 1 });
        continue;
      }
    }
    const last = out[out.length - 1];
    if (last?.type === 'literal') last.text += c;
    else out.push({ type: 'literal', text: c });
  }
  return out;
}

/**
 * Render a pattern against the current sequence values. `undefined` when the
 * result matches the default label produced from the own level's marker and value.
 */
export function compositeLabel(
  pattern: NumberPattern,
  ownMarker: MarkerKind,
  ownValue: number,
  levelMarker: (level: number) => MarkerKind,
  levelValue: (level: number) => number,
): string | undefined {
  if (pattern.text.length === 0) return undefined;
  let out = '';
  for (const piece of pattern.text) {
    if (piece.type === 'literal') {
      out += piece.text;
    } else {
      const kind = pattern.legal ? 'decimal' : levelMarker(piece.level);
      out += markerOrdinal(kind, levelValue(piece.level));
    }
  }
  return out === markerLabel(ownMarker, ownValue) ? undefined : out;
}
