/** PDF standard encodings (ISO 32000 Annex D) and Encoding Differences. */

import { inflateZlib } from '@mdgate/utils';
import { PDF_ENCODINGS } from './generated/encodings-data.js';
import { GLYPHLIST_ZLIB } from './generated/glyphlist-data.js';

let glyphList: Map<string, string> | undefined;

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function loadGlyphList(): Map<string, string> {
  if (glyphList) return glyphList;
  const raw = inflateZlib(decodeBase64(GLYPHLIST_ZLIB), 1 << 20);
  let text = '';
  for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i]!);
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

export function glyphNameToUnicode(name: string): string | undefined {
  const bare = name.startsWith('/') ? name.slice(1) : name;
  return loadGlyphList().get(bare);
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
