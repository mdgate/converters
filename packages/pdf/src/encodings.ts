/** PDF standard encodings (ISO 32000 Annex D) and Encoding Differences. */

import { PDF_ENCODINGS } from './generated/encodings-data.js';
import { pdfMaps } from './maps.js';

let glyphList: Map<string, string> | undefined;

function loadGlyphList(): Map<string, string> {
  if (glyphList) return glyphList;
  const text = pdfMaps().glyphListText;
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const name = line.slice(0, tab);
    let ch = '';
    for (const hex of line.slice(tab + 1).split(' ')) {
      if (hex.length > 0) ch += String.fromCodePoint(Number.parseInt(hex, 16));
    }
    if (name.length > 0 && ch.length > 0) map.set(name, ch);
  }
  glyphList = map;
  return map;
}

const LATIN_LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
};

function expandLatinLigatures(text: string): string {
  let out = '';
  for (const ch of text) out += LATIN_LIGATURES[ch] ?? ch;
  return out;
}

function mapUniComponent(part: string): string | undefined {
  if (part.startsWith('uni') && part.length > 3 && (part.length - 3) % 4 === 0) {
    if (![...part.slice(3)].every((c) => /[0-9A-Fa-f]/.test(c))) return undefined;
    let out = '';
    for (let i = 3; i < part.length; i += 4) {
      const cp = Number.parseInt(part.slice(i, i + 4), 16);
      if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
      out += String.fromCharCode(cp);
    }
    return out;
  }
  if (/^u[0-9A-Fa-f]{4,6}$/.test(part)) {
    const cp = Number.parseInt(part.slice(1), 16);
    if (cp <= 0xd7ff || (cp >= 0xe000 && cp <= 0x10ffff)) return String.fromCodePoint(cp);
  }
  return undefined;
}

function mapAglComponent(part: string, agl: Map<string, string>): string | undefined {
  if (part.length === 0) return undefined;
  const direct = agl.get(part);
  if (direct !== undefined) return direct;
  return mapUniComponent(part);
}

/**
 * Adobe Glyph List name mapping: drop a period suffix, split on `_`, then
 * look up each piece (AGL, `uniXXXX`, `uXXXX`). Small-cap suffixes map to
 * uppercase so `t.sc` / `a.smcp` match the printed letter.
 */
export function glyphNameToUnicode(name: string): string | undefined {
  const bare = name.startsWith('/') ? name.slice(1) : name;
  if (bare.length === 0) return undefined;
  const agl = loadGlyphList();
  const direct = agl.get(bare);
  if (direct !== undefined) return expandLatinLigatures(direct);
  const small = /\.(?:sc|smcp|c2sc|small)(?:\.|$)/i.test(bare);
  const base = bare.split('.')[0]!;
  if (base.length === 0) return undefined;
  let out = '';
  for (const part of base.split('_')) {
    const ch = mapAglComponent(part, agl);
    if (ch !== undefined) out += ch;
  }
  if (out.length === 0) return undefined;
  const expanded = expandLatinLigatures(out);
  if (small && expanded === expanded.toLowerCase()) return expanded.toUpperCase();
  return expanded;
}

export function encodingTable(name: string): string | undefined {
  const bare = name.startsWith('/') ? name.slice(1) : name;
  if (bare === 'Identity-H' || bare === 'Identity-V') return undefined;
  return PDF_ENCODINGS[bare];
}

/** Fill `cmap` from a named base encoding. Existing keys are kept. */
export function applyNamedEncoding(cmap: Map<number, string>, encodingName: string): void {
  const table = encodingTable(encodingName);
  if (!table) return;
  for (let code = 0; code < 256; code += 1) {
    if (cmap.has(code)) continue;
    const ch = table[code]!;
    if (ch && ch !== '\0') cmap.set(code, ch);
  }
}

/**
 * PDF `/Differences` array: numbers set the next code, names assign glyphs.
 * `[39 /quotesingle 96 /grave]`
 */
export function applyDifferences(cmap: Map<number, string>, diffs: unknown[]): void {
  let code = 0;
  for (const item of diffs) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      code = Math.trunc(item);
      continue;
    }
    if (typeof item === 'string') {
      const ch = glyphNameToUnicode(item);
      if (ch !== undefined) cmap.set(code, ch);
      code += 1;
    }
  }
}
