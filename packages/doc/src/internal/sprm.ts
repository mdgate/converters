/**
 * Sprm (single property modifier) walking and application, per MS-DOC:
 * character toggles resolve against the style-chain base (0 = off, 1 = on,
 * 0x80 = style's value, 0x81 = style's value inverted).
 */

import { getU16, getU32 } from '@mdgate/containers';
import type { Style } from '@mdgate/document';

function sprmOperandLen(sprm: number, operand: Uint8Array): number {
  switch (sprm >>> 13) {
    case 0:
    case 1:
      return 1;
    case 2:
    case 4:
    case 5:
      return 2;
    case 3:
      return 4;
    case 7:
      return 3;
    default:
      if (sprm === 0xd608) {
        const n = getU16(operand, 0);
        return n === undefined ? 0 : n + 1;
      }
      return operand.length === 0 ? 0 : operand[0]! + 1;
  }
}

export function walkSprms(
  grpprl: Uint8Array,
  f: (sprm: number, operand: Uint8Array) => void,
): void {
  let pos = 0;
  while (pos + 2 <= grpprl.length) {
    const sprm = grpprl[pos]! | (grpprl[pos + 1]! << 8);
    pos += 2;
    const len = sprmOperandLen(sprm, grpprl.subarray(pos));
    if (pos + len > grpprl.length) break;
    f(sprm, grpprl.subarray(pos, pos + len));
    pos += len;
  }
}

/** Resolve a toggle operand against the style-chain base value. */
function toggle(operand: Uint8Array, base: boolean): boolean | undefined {
  switch (operand[0]) {
    case 0:
      return false;
    case 1:
      return true;
    case 0x80:
      return base;
    case 0x81:
      return !base;
    default:
      return undefined;
  }
}

/** The `sprmCIstd` character-style reference in a CHPX, if any. */
export function chpxIstd(grpprl: Uint8Array): number | undefined {
  let istd: number | undefined;
  walkSprms(grpprl, (sprm, operand) => {
    if (sprm === 0x4a30) istd = getU16(operand, 0);
  });
  return istd;
}

/**
 * The `sprmCPicLocation` Data-stream offset in a CHPX, if any: where an
 * inline picture's PICF + OfficeArt data begins.
 */
export function chpxPicLocation(grpprl: Uint8Array): number | undefined {
  let location: number | undefined;
  walkSprms(grpprl, (sprm, operand) => {
    if (sprm === 0x6a03) location = getU32(operand, 0);
  });
  return location;
}

/**
 * Apply a CHPX grpprl over `current`, resolving toggle operands against the
 * style chain's value (`styleBase`), per the published algorithm.
 */
export function applyChpx(grpprl: Uint8Array, current: Style, styleBase: Style): Style {
  if (grpprl.length === 0) return current;
  const style: Style = { ...current };
  walkSprms(grpprl, (sprm, operand) => {
    switch (sprm) {
      case 0x0835: {
        const v = toggle(operand, styleBase.bold);
        if (v !== undefined) style.bold = v;
        break;
      }
      case 0x0836: {
        const v = toggle(operand, styleBase.italic);
        if (v !== undefined) style.italic = v;
        break;
      }
      case 0x0837: {
        const v = toggle(operand, styleBase.strike);
        if (v !== undefined) style.strike = v;
        break;
      }
      default:
        break;
    }
  });
  return style;
}

/** A row's table properties from `sprmTDefTable` and companion table sprms. */
export interface Tap {
  /** Cell boundary positions in twips (`rgdxaCenter`), one more than cells. */
  boundaries: number[];
  cells: TapCell[];
  /** `sprmTTableHeader`: the row repeats as a header row. */
  header: boolean;
}

/** Merge flags of one cell (TC80 `tcgrf` / `sprmTVertMerge`). */
export interface TapCell {
  horzFirst: boolean;
  horzCont: boolean;
  vertRestart: boolean;
  vertCont: boolean;
}

export function emptyTap(): Tap {
  return { boundaries: [], cells: [], header: false };
}

export function emptyTapCell(): TapCell {
  return { horzFirst: false, horzCont: false, vertRestart: false, vertCont: false };
}

export function cloneTap(tap: Tap): Tap {
  return {
    boundaries: tap.boundaries.slice(),
    cells: tap.cells.map((c) => ({ ...c })),
    header: tap.header,
  };
}

/**
 * Paragraph properties a PAPX (or style PAPX) contributes.
 *
 * `outline` is a nested option: `undefined` unset, `null` explicitly not a
 * heading (`sprmPOutLvl` ≥ 9), otherwise the 1-based outline level.
 */
export interface PapDelta {
  inTable: boolean | undefined;
  ttp: boolean | undefined;
  outline: number | null | undefined;
  ilfo: number | undefined;
  ilvl: number | undefined;
  /** `sprmPItap` table depth (1 = a regular table). */
  itap: number | undefined;
  innerCell: boolean | undefined;
  innerTtp: boolean | undefined;
  /** Row properties, present on TTP marks. */
  tap: Tap | undefined;
}

export function emptyPapDelta(): PapDelta {
  return {
    inTable: undefined,
    ttp: undefined,
    outline: undefined,
    ilfo: undefined,
    ilvl: undefined,
    itap: undefined,
    innerCell: undefined,
    innerTtp: undefined,
    tap: undefined,
  };
}

export function clonePapDelta(pap: PapDelta): PapDelta {
  return {
    inTable: pap.inTable,
    ttp: pap.ttp,
    outline: pap.outline,
    ilfo: pap.ilfo,
    ilvl: pap.ilvl,
    itap: pap.itap,
    innerCell: pap.innerCell,
    innerTtp: pap.innerTtp,
    tap: pap.tap === undefined ? undefined : cloneTap(pap.tap),
  };
}

export function mergePap(base: PapDelta, over: PapDelta): PapDelta {
  return {
    inTable: over.inTable ?? base.inTable,
    ttp: over.ttp ?? base.ttp,
    outline: over.outline !== undefined ? over.outline : base.outline,
    ilfo: over.ilfo ?? base.ilfo,
    ilvl: over.ilvl ?? base.ilvl,
    itap: over.itap ?? base.itap,
    innerCell: over.innerCell ?? base.innerCell,
    innerTtp: over.innerTtp ?? base.innerTtp,
    tap: over.tap ?? base.tap,
  };
}

function asI16(u: number): number {
  return (u << 16) >> 16;
}

function asI32(u: number): number {
  return u | 0;
}

function saturatingAddI32(a: number, b: number): number {
  const s = a + b;
  if (s > 0x7fffffff) return 0x7fffffff;
  if (s < -0x80000000) return -0x80000000;
  return s | 0;
}

export function applyPapSprms(grpprl: Uint8Array, data: Uint8Array, delta: PapDelta): void {
  walkSprms(grpprl, (sprm, operand) => {
    switch (sprm) {
      case 0x2416:
        delta.inTable = operand.length > 0 && operand[0] !== 0;
        break;
      case 0x2417:
        delta.ttp = operand.length > 0 && operand[0] !== 0;
        break;
      case 0x6646: {
        const off = getU32(operand, 0);
        if (off === undefined) break;
        const cb = getU16(data, off);
        if (cb === undefined) break;
        if (off + 2 + cb > data.length) break;
        applyPapSprms(data.subarray(off + 2, off + 2 + cb), new Uint8Array(), delta);
        break;
      }
      case 0x2640: {
        const v = operand[0];
        if (v !== undefined) delta.outline = v < 9 ? v + 1 : null;
        break;
      }
      case 0x260a:
        delta.ilvl = operand[0];
        break;
      case 0x460b:
        delta.ilfo = getU16(operand, 0);
        break;
      case 0x6649: {
        const v = getU32(operand, 0);
        if (v !== undefined) delta.itap = asI32(v);
        break;
      }
      case 0x664a: {
        const d = getU32(operand, 0);
        if (d !== undefined) {
          delta.itap = saturatingAddI32(delta.itap ?? 0, asI32(d));
        }
        break;
      }
      case 0x244b:
        delta.innerCell = operand.length > 0 && operand[0] !== 0;
        break;
      case 0x244c:
        delta.innerTtp = operand.length > 0 && operand[0] !== 0;
        break;
      case 0xd608: {
        const tap = parseTdefTable(operand);
        if (tap !== undefined) {
          const header = delta.tap?.header === true;
          delta.tap = { ...tap, header };
        }
        break;
      }
      case 0x3404: {
        const on = operand.length > 0 && operand[0] !== 0;
        if (delta.tap !== undefined) {
          delta.tap.header = on;
        } else if (on) {
          delta.tap = { ...emptyTap(), header: true };
        }
        break;
      }
      case 0xd62b: {
        const itc = operand[1];
        const flag = operand[2];
        if (itc === undefined || flag === undefined || delta.tap === undefined) break;
        const cell = delta.tap.cells[itc];
        if (cell === undefined) break;
        cell.vertCont = flag === 0x01;
        cell.vertRestart = flag === 0x03;
        break;
      }
      default:
        break;
    }
  });
}

const TC80_SIZE = 20;

/** Parse a `TDefTableOperand`: cb, NumberOfColumns, `rgdxaCenter`, TC80s. */
function parseTdefTable(operand: Uint8Array): Tap | undefined {
  const columns = operand[2];
  if (columns === undefined || columns > 63) return undefined;
  const boundaries: number[] = [];
  for (let i = 0; i <= columns; i += 1) {
    const b = getU16(operand, 3 + i * 2);
    if (b === undefined) return undefined;
    boundaries.push(asI16(b));
  }
  const cells: TapCell[] = [];
  for (let i = 0; i < columns; i += 1) cells.push(emptyTapCell());
  const tcBase = 3 + (columns + 1) * 2;
  for (let i = 0; i < cells.length; i += 1) {
    const tcgrf = getU16(operand, tcBase + i * TC80_SIZE);
    if (tcgrf === undefined) break;
    const cell = cells[i]!;
    const horz = tcgrf & 0x3;
    cell.horzCont = horz === 1;
    cell.horzFirst = horz >= 2;
    const vert = (tcgrf >> 5) & 0x3;
    cell.vertCont = vert === 1;
    cell.vertRestart = vert === 3;
  }
  return { boundaries, cells, header: false };
}

/** A CHPX grpprl as a character-style definition layer over `parent`. */
export function applyStyleChpx(grpprl: Uint8Array, parent: Style): Style {
  return applyChpx(grpprl, parent, parent);
}
