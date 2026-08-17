/**
 * Word binary list tables: `PlfLst` (list definitions with per-level
 * formats) and `PlfLfo` (list format overrides referenced by `sprmPIlfo`).
 */

import { getU16, getU32 } from '@mdgate/containers';
import type { MarkerKind } from '@mdgate/document';
import { emptyNumberPattern, type NumberPattern, type NumberText } from '@mdgate/office-common';
import { isControl } from '@mdgate/utils';

export const LEVELS = 9;

export interface LevelDef {
  marker: MarkerKind | undefined;
  start: number;
  /**
   * Restart rule, as in WordprocessingML `lvlRestart`: `undefined` = restart
   * after any more significant level, `0` = never restart, `n` = restart
   * when a level with ilvl < n is used.
   */
  restart: number | undefined;
  /** Number text (`xst` with `rgbxchNums` placeholders and LVLF `fLegal`). */
  pattern: NumberPattern;
}

export function defaultLevelDef(): LevelDef {
  return {
    marker: 'bullet',
    start: 1,
    restart: undefined,
    pattern: emptyNumberPattern(),
  };
}

export interface ListDef {
  /** List identity: numbering state is keyed by this, not the ilfo. */
  lsid: number;
  levels: LevelDef[];
  /** LFOLVL start-at overrides; fire the first time this LFO numbers a level. */
  startOverride: Array<number | undefined>;
}

/** Fallback definition for an ilfo with no parsed list behind it. */
export function unknownListDef(ilfo: number): ListDef {
  return {
    lsid: (0xffffffff ^ ilfo) >>> 0,
    levels: Array.from({ length: LEVELS }, () => defaultLevelDef()),
    startOverride: Array.from({ length: LEVELS }, () => undefined),
  };
}

export class Lists {
  /** 1-based ilfo -> resolved definition. */
  private readonly byIlfo = new Map<number, ListDef>();

  get(ilfo: number): ListDef | undefined {
    return this.byIlfo.get(ilfo);
  }

  set(ilfo: number, def: ListDef): void {
    this.byIlfo.set(ilfo, def);
  }
}

/** FIB offsets (Word 97+): fcPlfLst/lcbPlfLst at 0x2E2, fcPlfLfo at 0x2EA. */
export function parse(wordDoc: Uint8Array, table: Uint8Array): Lists {
  const lstFc = getU32(wordDoc, 0x2e2) ?? 0;
  const lstLcb = getU32(wordDoc, 0x2e6) ?? 0;
  const lfoFc = getU32(wordDoc, 0x2ea) ?? 0;
  const lfoLcb = getU32(wordDoc, 0x2ee) ?? 0;

  const lists = new Lists();
  if (lstLcb === 0) return lists;
  const byLsid = parsePlfLst(table, lstFc, lstLcb);
  if (lfoFc + lfoLcb > table.length) return lists;
  parsePlfLfo(table.subarray(lfoFc, lfoFc + lfoLcb), byLsid, lists);
  return lists;
}

const LSTF_SIZE = 28;

function parsePlfLst(table: Uint8Array, fc: number, lcb: number): Map<number, LevelDef[]> {
  const out = new Map<number, LevelDef[]>();
  if (fc >= table.length) return out;
  const plf = table.subarray(fc);
  const count = getU16(plf, 0);
  if (count === undefined) return out;
  const lstfs: Array<[number, boolean]> = [];
  let pos = 2;
  for (let i = 0; i < count; i += 1) {
    if (pos + LSTF_SIZE > plf.length) return out;
    const record = plf.subarray(pos, pos + LSTF_SIZE);
    const lsid = getU32(record, 0);
    if (lsid === undefined) return out;
    const simple = (record[26]! & 0x01) !== 0;
    lstfs.push([lsid, simple]);
    pos += LSTF_SIZE;
  }
  pos = lcb;
  for (const [lsid, simple] of lstfs) {
    const nLevels = simple ? 1 : LEVELS;
    const levels = Array.from({ length: LEVELS }, () => defaultLevelDef());
    let failed = false;
    for (let slot = 0; slot < nLevels; slot += 1) {
      const parsed = parseLvl(plf, pos);
      if (parsed === undefined) {
        failed = true;
        break;
      }
      levels[slot] = parsed[0];
      pos = parsed[1];
    }
    if (failed) return out;
    if (simple) {
      const def = cloneLevel(levels[0]!);
      for (let i = 0; i < LEVELS; i += 1) levels[i] = cloneLevel(def);
    }
    out.set(lsid, levels);
  }
  return out;
}

function cloneLevel(level: LevelDef): LevelDef {
  return {
    marker: level.marker,
    start: level.start,
    restart: level.restart,
    pattern: {
      text: level.pattern.text.map((p) =>
        p.type === 'literal'
          ? { type: 'literal', text: p.text }
          : { type: 'level', level: p.level },
      ),
      legal: level.pattern.legal,
    },
  };
}

/** One LVL: LVLF header, then PAPX and CHPX grpprls, then the number text. */
function parseLvl(plf: Uint8Array, pos: number): [LevelDef, number] | undefined {
  const LVLF_SIZE = 28;
  if (pos >= plf.length) return undefined;
  const record = plf.subarray(pos);
  if (record.length < LVLF_SIZE) return undefined;
  const header = record.subarray(0, LVLF_SIZE);
  const start = getU32(header, 0);
  if (start === undefined) return undefined;
  const nfc = header[4]!;
  const flags = header[5]!;
  const legal = (flags & 0x04) !== 0;
  const noRestart = (flags & 0x08) !== 0;
  const placeholderOffsets: number[] = [];
  for (let i = 6; i < 15; i += 1) {
    const b = header[i]!;
    if (b === 0) break;
    placeholderOffsets.push(b);
  }
  const restartLim = header[26]!;
  const cbPapx = header[25]!;
  const cbChpx = header[24]!;
  let next = LVLF_SIZE + cbPapx + cbChpx;
  const xchCount = getU16(record, next);
  if (xchCount === undefined) return undefined;
  next += 2;
  const marker = markerForNfc(nfc);
  const text: NumberText[] = [];
  if (marker !== undefined && marker !== 'bullet') {
    for (let i = 0; i < xchCount; i += 1) {
      const unit = i * 2 + next;
      const ch = getU16(record, unit);
      if (ch === undefined) return undefined;
      if (ch <= 0x08 && placeholderOffsets.includes(i + 1)) {
        text.push({ type: 'level', level: ch });
      } else {
        const c = fromU16Char(ch);
        if (c === undefined || isControl(c)) continue;
        const last = text[text.length - 1];
        if (last?.type === 'literal') last.text += c;
        else text.push({ type: 'literal', text: c });
      }
    }
  }
  next += xchCount * 2;
  const restart = noRestart ? restartLim : undefined;
  return [{ marker, start, restart, pattern: { text, legal } }, pos + next];
}

function fromU16Char(ch: number): string | undefined {
  if (ch >= 0xd800 && ch <= 0xdfff) return undefined;
  return String.fromCharCode(ch);
}

const LFO_SIZE = 16;

function parsePlfLfo(plf: Uint8Array, byLsid: Map<number, LevelDef[]>, lists: Lists): void {
  const count = getU32(plf, 0);
  if (count === undefined) return;
  const lfos: Array<[number, number]> = [];
  let pos = 4;
  for (let i = 0; i < count; i += 1) {
    if (pos + LFO_SIZE > plf.length) return;
    const record = plf.subarray(pos, pos + LFO_SIZE);
    const lsid = getU32(record, 0);
    if (lsid === undefined) return;
    const clfolvl = record[12]!;
    lfos.push([lsid, clfolvl]);
    pos += LFO_SIZE;
  }
  for (let i = 0; i < lfos.length; i += 1) {
    const [lsid, clfolvl] = lfos[i]!;
    const ilfo = i + 1;
    const levels = byLsid.get(lsid);
    const def: ListDef =
      levels !== undefined
        ? {
            lsid,
            levels: levels.map(cloneLevel),
            startOverride: Array.from({ length: LEVELS }, () => undefined),
          }
        : unknownListDef(ilfo);
    for (let n = 0; n < clfolvl; n += 1) {
      if (pos + 8 > plf.length) break;
      const overrideRecord = plf.subarray(pos, pos + 8);
      const startAt = getU32(overrideRecord, 0);
      if (startAt === undefined) break;
      const bits = overrideRecord[4]!;
      const ilvl = bits & 0x0f;
      const fStartAt = (bits & 0x10) !== 0;
      const fFormatting = (bits & 0x20) !== 0;
      pos += 8;
      if (fFormatting) {
        const parsed = parseLvl(plf, pos);
        if (parsed === undefined) break;
        const [lvlDef, next] = parsed;
        if (ilvl < LEVELS) {
          if (fStartAt) def.startOverride[ilvl] = lvlDef.start;
          def.levels[ilvl] = lvlDef;
        }
        pos = next;
      } else if (fStartAt && ilvl < LEVELS) {
        def.levels[ilvl]!.start = startAt;
        def.startOverride[ilvl] = startAt;
      }
    }
    lists.set(ilfo, def);
  }
}

/** MS-OSHARED numbering format codes. */
function markerForNfc(nfc: number): MarkerKind | undefined {
  switch (nfc) {
    case 0:
      return 'decimal';
    case 1:
      return 'upperRoman';
    case 2:
      return 'lowerRoman';
    case 3:
      return 'upperAlpha';
    case 4:
      return 'lowerAlpha';
    case 23:
      return 'bullet';
    case 0xff:
      return undefined;
    default:
      return 'decimal';
  }
}
