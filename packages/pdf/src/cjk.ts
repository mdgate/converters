/**
 * Official lookalike → unified-ideograph remapping for PDF text.
 *
 * This is not a hand-picked case list. The table is generated from:
 *   - Unicode EquivalentUnifiedIdeograph (radicals + CJK strokes)
 *   - NFKC on CJK Compatibility Ideographs / Supplement / Forms
 *
 * Applied to every decoded character (ToUnicode, font cmap, Adobe CID,
 * standard encodings). Traditional/simplified pairs (門/门) are left
 * alone — those are language variants, not lookalikes.
 */

import { pdfMaps } from './maps.js';

export function remapCjkCodePoint(cp: number): number {
  const from = pdfMaps().cjkFrom;
  let lo = 0;
  let hi = from.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const key = from[mid]!;
    if (key === cp) return pdfMaps().cjkTo[mid]!;
    if (key < cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return cp;
}

export function normalizeCjkText(text: string): string {
  let out = '';
  let changed = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const mapped = remapCjkCodePoint(cp);
    if (mapped === cp) {
      out += ch;
      continue;
    }
    changed = true;
    out += String.fromCodePoint(mapped);
  }
  return changed ? out : text;
}
