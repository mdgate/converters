/**
 * Full STSH (style sheet) parsing per MS-DOC: STD records with their
 * `istdBase` inheritance chains and UPX formatting payloads.
 */

import { getU16, getU32 } from '@mdgate/containers';
import { PLAIN, type Style } from '@mdgate/document';
import { type BlockStyle, fromStyleName } from '@mdgate/office-common';
import { warn } from '@mdgate/utils';
import {
  applyPapSprms,
  applyStyleChpx,
  clonePapDelta,
  emptyPapDelta,
  mergePap,
  type PapDelta,
} from './sprm.js';

const ISTD_NIL = 0x0fff;

export interface ResolvedStyle {
  chp: Style;
  pap: PapDelta;
  heading: number | undefined;
  block: BlockStyle | undefined;
}

export function emptyResolvedStyle(): ResolvedStyle {
  return {
    chp: { ...PLAIN },
    pap: emptyPapDelta(),
    heading: undefined,
    block: undefined,
  };
}

function cloneResolved(style: ResolvedStyle): ResolvedStyle {
  return {
    chp: { ...style.chp },
    pap: clonePapDelta(style.pap),
    heading: style.heading,
    block: style.block,
  };
}

export class Stylesheet {
  private readonly resolved = new Map<number, ResolvedStyle>();
  private readonly default = emptyResolvedStyle();

  get(istd: number): ResolvedStyle {
    return this.resolved.get(istd) ?? this.default;
  }

  set(istd: number, style: ResolvedStyle): void {
    this.resolved.set(istd, style);
  }
}

interface Std {
  sti: number;
  istdBase: number;
  block: BlockStyle | undefined;
  upxPapx: Uint8Array;
  upxChpx: Uint8Array;
  isParagraph: boolean;
}

export function parse(wordDoc: Uint8Array, table: Uint8Array): Stylesheet {
  const fc = getU32(wordDoc, 0xa2);
  const lcb = getU32(wordDoc, 0xa6);
  if (fc === undefined || lcb === undefined) return new Stylesheet();
  if (fc + lcb > table.length) return new Stylesheet();
  const stsh = table.subarray(fc, fc + lcb);
  const cbStshi = getU16(stsh, 0);
  const cstd = getU16(stsh, 2);
  const cbStdBase = getU16(stsh, 4);
  if (cbStshi === undefined || cstd === undefined || cbStdBase === undefined) {
    return new Stylesheet();
  }

  const stds = new Map<number, Std>();
  let pos = 2 + cbStshi;
  for (let istd = 0; istd < cstd; istd += 1) {
    const cbStd = getU16(stsh, pos);
    if (cbStd === undefined) break;
    pos += 2;
    if (cbStd === 0) continue;
    if (pos + cbStd > stsh.length) break;
    const record = stsh.subarray(pos, pos + cbStd);
    pos += cbStd;
    const std = parseStd(record, cbStdBase);
    if (std !== undefined) stds.set(istd, std);
  }

  const sheet = new Stylesheet();
  const memo = new Map<number, ResolvedStyle>();
  for (const istd of stds.keys()) {
    sheet.set(istd, resolve(istd, stds, memo));
  }
  return sheet;
}

function parseStd(record: Uint8Array, cbStdBase: number): Std | undefined {
  const first = getU16(record, 0);
  if (first === undefined) return undefined;
  const sti = first & 0x0fff;
  const second = getU16(record, 2);
  if (second === undefined) return undefined;
  const sgc = second & 0x000f;
  const istdBase = (second >> 4) & 0x0fff;
  const cupxRaw = getU16(record, 4);
  const cupx = cupxRaw === undefined ? 0 : cupxRaw & 0x000f;

  const nameOff = Math.max(cbStdBase, 10);
  const nameLen = getU16(record, nameOff);
  if (nameLen === undefined) return undefined;
  const nameBytes = nameLen * 2;
  const nameUnits: number[] = [];
  const nameStart = nameOff + 2;
  if (nameStart + nameBytes <= record.length) {
    for (let i = 0; i < nameBytes; i += 2) {
      nameUnits.push(record[nameStart + i]! | (record[nameStart + i + 1]! << 8));
    }
  }
  const name = fromUtf16Lossy(nameUnits);
  let upxPos = nameOff + 4 + nameBytes;
  if (!Number.isSafeInteger(upxPos)) return undefined;

  const upx: Uint8Array[] = [];
  for (let i = 0; i < cupx; i += 1) {
    if (upxPos % 2 === 1) upxPos += 1;
    const cb = getU16(record, upxPos);
    if (cb === undefined) return undefined;
    if (upxPos + 2 + cb > record.length) return undefined;
    upx.push(record.subarray(upxPos + 2, upxPos + 2 + cb));
    upxPos += 2 + cb;
  }

  const isParagraph = sgc === 1;
  const upxPapx = isParagraph
    ? upx[0] !== undefined
      ? new Uint8Array(upx[0])
      : new Uint8Array()
    : new Uint8Array();
  const upxChpx = isParagraph
    ? upx[1] !== undefined
      ? new Uint8Array(upx[1])
      : new Uint8Array()
    : upx[0] !== undefined
      ? new Uint8Array(upx[0])
      : new Uint8Array();
  return {
    sti,
    istdBase,
    block: fromStyleName(name),
    upxPapx,
    upxChpx,
    isParagraph,
  };
}

/**
 * Resolve one style's `istdBase` chain, memoized across styles. Cycles are
 * cut by a visited set and resolve from their acyclic prefix.
 */
function resolve(
  istd: number,
  stds: Map<number, Std>,
  memo: Map<number, ResolvedStyle>,
): ResolvedStyle {
  const hit = memo.get(istd);
  if (hit !== undefined) return cloneResolved(hit);
  const chain: number[] = [];
  const visiting = new Set<number>();
  let base = emptyResolvedStyle();
  let cursor: number | undefined = istd;
  while (cursor !== undefined) {
    const cached = memo.get(cursor);
    if (cached !== undefined) {
      base = cloneResolved(cached);
      break;
    }
    if (visiting.has(cursor)) {
      warn(`style istdBase cycle at istd ${cursor}`);
      break;
    }
    visiting.add(cursor);
    const std = stds.get(cursor);
    if (std === undefined) break;
    chain.push(cursor);
    cursor = std.istdBase !== ISTD_NIL && std.istdBase !== cursor ? std.istdBase : undefined;
  }
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const cur = chain[i]!;
    const std = stds.get(cur)!;
    if (std.isParagraph && std.upxPapx.length >= 2) {
      const delta = emptyPapDelta();
      applyPapSprms(std.upxPapx.subarray(2), new Uint8Array(), delta);
      base.pap = mergePap(base.pap, delta);
    }
    base.chp = applyStyleChpx(std.upxChpx, base.chp);
    if (std.sti >= 1 && std.sti <= 9) base.heading = std.sti;
    base.block = std.block ?? base.block;
    memo.set(cur, cloneResolved(base));
  }
  return base;
}

function fromUtf16Lossy(units: number[]): string {
  let out = '';
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i]!;
    if (u >= 0xd800 && u <= 0xdbff && i + 1 < units.length) {
      const u2 = units[i + 1]!;
      if (u2 >= 0xdc00 && u2 <= 0xdfff) {
        out += String.fromCharCode(u, u2);
        i += 1;
        continue;
      }
    }
    if (u >= 0xd800 && u <= 0xdfff) out += '\uFFFD';
    else out += String.fromCharCode(u);
  }
  return out;
}
