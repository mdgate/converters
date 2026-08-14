/**
 * `StyleTextPropAtom` and `TxMasterStyleAtom` parsing: paragraph and
 * character formatting runs keyed by text range, per MS-PPT's
 * TextPFException / TextCFException layouts. Parsing is defensive - a
 * malformed exception aborts styling for that atom (logged), never the text.
 */

import { getU16, getU32 } from '../../common/binary.js';
import { debug } from '../../log.js';

export interface ParaProps {
  count: number;
  depth: number;
  /** From bulletFlags' fHasBullet, when present. */
  bullet: boolean | undefined;
}

/**
 * Character-run exception: each property is tri-state — `undefined` inherits
 * the master's per-level default.
 */
export interface CharProps {
  count: number;
  bold: boolean | undefined;
  italic: boolean | undefined;
}

/** One indent level's defaults from a `TxMasterStyleAtom`, tri-state. */
export interface MasterLevel {
  bullet: boolean | undefined;
  bold: boolean | undefined;
  italic: boolean | undefined;
}

export interface StyleRuns {
  paragraphs: ParaProps[];
  chars: CharProps[];
}

export function emptyStyleRuns(): StyleRuns {
  return { paragraphs: [], chars: [] };
}

export function emptyMasterLevel(): MasterLevel {
  return { bullet: undefined, bold: undefined, italic: undefined };
}

/** Parse a `StyleTextPropAtom` body for text of `textLen` characters. */
export function parseStyleText(body: Uint8Array, textLen: number): StyleRuns {
  const runs = emptyStyleRuns();
  let pos = 0;
  // Paragraph runs cover textLen + 1 (the implicit final paragraph mark).
  let covered = 0;
  while (covered <= textLen) {
    const count = getU32(body, pos);
    if (count === undefined) break;
    const depth = getU16(body, pos + 4);
    if (depth === undefined) break;
    pos += 6;
    const pf = parsePfException(body, pos);
    if (pf === undefined) {
      debug('unparseable paragraph style run; keeping styling parsed so far');
      return runs;
    }
    pos = pf.next;
    runs.paragraphs.push({ count, depth, bullet: pf.bullet });
    covered += count;
    if (count === 0) break;
  }
  covered = 0;
  while (covered <= textLen) {
    const count = getU32(body, pos);
    if (count === undefined) break;
    pos += 4;
    const cf = parseCfException(body, pos);
    if (cf === undefined) {
      debug('unparseable character style run; dropping remaining styling');
      break;
    }
    pos = cf.next;
    runs.chars.push({ count, bold: cf.bold, italic: cf.italic });
    covered += count;
    if (count === 0) break;
  }
  return runs;
}

/**
 * TextPFException: mask + fields in mask-bit order. Returns the bullet
 * state (if the mask carried bulletFlags) and the next offset.
 */
function parsePfException(
  body: Uint8Array,
  start: number,
): { bullet: boolean | undefined; next: number } | undefined {
  let pos = start;
  const mask = getU32(body, pos);
  if (mask === undefined) return undefined;
  pos += 4;
  let bullet: boolean | undefined;
  // masks.bulletFlags: any of hasBullet/bulletHasFont/bulletHasColor/
  // bulletHasSize present -> a 16-bit bulletFlags field. The fHasBullet
  // value is specified only when masks.hasBullet itself is set.
  if ((mask & 0x000f) !== 0) {
    const flags = getU16(body, pos);
    if (flags === undefined) return undefined;
    if ((mask & 0x0001) !== 0) bullet = (flags & 0x0001) !== 0;
    pos += 2;
  }
  if ((mask & 0x0080) !== 0) pos += 2; // bulletChar
  if ((mask & 0x0010) !== 0) pos += 2; // bulletFontRef
  if ((mask & 0x0040) !== 0) pos += 2; // bulletSize
  if ((mask & 0x0020) !== 0) pos += 4; // bulletColor
  if ((mask & 0x0800) !== 0) pos += 2; // textAlignment
  if ((mask & 0x1000) !== 0) pos += 2; // lineSpacing
  if ((mask & 0x2000) !== 0) pos += 2; // spaceBefore
  if ((mask & 0x4000) !== 0) pos += 2; // spaceAfter
  if ((mask & 0x0100) !== 0) pos += 2; // leftMargin
  if ((mask & 0x0400) !== 0) pos += 2; // indent
  if ((mask & 0x8000) !== 0) pos += 2; // defaultTabSize
  if ((mask & 0x0010_0000) !== 0) {
    // tabStops: count-prefixed array of 4-byte stops.
    const count = getU16(body, pos);
    if (count === undefined) return undefined;
    pos += 2 + count * 4;
  }
  if ((mask & 0x0001_0000) !== 0) pos += 2; // fontAlign
  // charWrap/wordWrap/overflow share one wrapFlags field.
  if ((mask & 0x000e_0000) !== 0) pos += 2;
  if ((mask & 0x0020_0000) !== 0) pos += 2; // textDirection
  if (pos > body.length) return undefined;
  return { bullet, next: pos };
}

/** Tri-state character style bits from a TextCFException. */
interface CfStyle {
  bold: boolean | undefined;
  italic: boolean | undefined;
  next: number;
}

/**
 * TextCFException: mask (+ optional style bitfield) + sized fields. Each
 * style bit is specified only when its own mask bit is set (per-bit
 * tri-state); strike-through is not in the 97-2003 style bits.
 */
function parseCfException(body: Uint8Array, start: number): CfStyle | undefined {
  let pos = start;
  const mask = getU32(body, pos);
  if (mask === undefined) return undefined;
  pos += 4;
  let bold: boolean | undefined;
  let italic: boolean | undefined;
  if ((mask & 0xffff) !== 0) {
    const style = getU16(body, pos);
    if (style === undefined) return undefined;
    if ((mask & 0x0001) !== 0) bold = (style & 0x0001) !== 0;
    if ((mask & 0x0002) !== 0) italic = (style & 0x0002) !== 0;
    pos += 2;
  }
  if ((mask & 0x0001_0000) !== 0) pos += 2; // fontRef
  if ((mask & 0x0020_0000) !== 0) pos += 2; // oldEAFontRef
  if ((mask & 0x0040_0000) !== 0) pos += 2; // ansiFontRef
  if ((mask & 0x0080_0000) !== 0) pos += 2; // symbolFontRef
  if ((mask & 0x0002_0000) !== 0) pos += 2; // size
  if ((mask & 0x0004_0000) !== 0) pos += 4; // color
  if ((mask & 0x0008_0000) !== 0) pos += 2; // position
  if (pos > body.length) return undefined;
  return { bold, italic, next: pos };
}

/** A `TxMasterStyleAtom`: per-indent-level tri-state defaults (index = depth). */
export function parseMasterStyle(body: Uint8Array, instance: number): MasterLevel[] {
  const levels = getU16(body, 0);
  if (levels === undefined) return [];
  let pos = 2;
  const out: MasterLevel[] = [];
  const n = Math.min(levels, 10);
  for (let i = 0; i < n; i += 1) {
    // Levels for body-family text types carry a leading depth field in
    // format version >= 9 atoms; instances >= 5 always do.
    if (instance >= 5) pos += 2;
    const pf = parsePfException(body, pos);
    if (pf === undefined) break;
    pos = pf.next;
    const cf = parseCfException(body, pos);
    if (cf === undefined) break;
    pos = cf.next;
    out.push({ bullet: pf.bullet, bold: cf.bold, italic: cf.italic });
  }
  return out;
}
