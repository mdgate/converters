/**
 * Legacy Word 97-2003 binary (.doc): OLE2 container, FIB, piece table with
 * `Prm`s, CHPX/PAPX runs over the STSH style chains, and PlfLst/PlfLfo.
 */

import { CompoundFile, getU16, getU32, MAX_ENTRY_BYTES, readOleStream } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type Block,
  type Document,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  markerIsOrdered,
  markerLabel,
  type Note,
  type NoteKind,
  PLAIN,
  type Style,
  stylesEqual,
} from '@mdgate/document';
import {
  AssetSink,
  buildEdgeTable,
  type CellProp,
  compositeLabel,
  emptyFieldFrame,
  type FieldFrame,
  fieldResult,
  firstBlip,
  flushList,
  type GridRow,
  type ListEntry,
  rebaseEmphasis,
  StyledRun,
} from '@mdgate/office-common';
import { debug, decode, isControl } from '@mdgate/utils';
import { LEVELS, type ListDef, type Lists, parse as parseLists, unknownListDef } from './lists.js';
import {
  applyChpx,
  applyPapSprms,
  chpxIstd,
  chpxPicLocation,
  clonePapDelta,
  cloneTap,
  emptyPapDelta,
  emptyTap,
  mergePap,
  type PapDelta,
  type Tap,
} from './sprm.js';
import { parse as parseStsh, type Stylesheet } from './stsh.js';

export function parse(bytes: Uint8Array): Document {
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw ConvertError.malformed(`not an OLE2 compound file: ${msg}`);
  }

  const wordDoc = readOleStream(ole, 'WordDocument');
  if (getU16(wordDoc, 0) !== 0xa5ec) {
    throw ConvertError.malformedPart('WordDocument', 'invalid FIB magic');
  }
  const flags = getU16(wordDoc, 0x0a) ?? 0;
  if ((flags & 0x0100) !== 0) throw ConvertError.encrypted();
  const [tableName, otherTable] =
    (flags & 0x0200) !== 0 ? (['1Table', '0Table'] as const) : (['0Table', '1Table'] as const);
  const table = tryOleStream(ole, tableName) ?? tryOleStream(ole, otherTable) ?? new Uint8Array();

  const ccpText = getU32(wordDoc, 0x4c) ?? 0;
  const ccpFtn = getU32(wordDoc, 0x50) ?? 0;
  const ccpHdd = getU32(wordDoc, 0x54) ?? 0;
  const ccpMcr = getU32(wordDoc, 0x58) ?? 0;
  const ccpAtn = getU32(wordDoc, 0x5c) ?? 0;
  const ccpEdn = getU32(wordDoc, 0x60) ?? 0;
  const fcClx = getU32(wordDoc, 0x1a2) ?? 0;
  const lcbClx = getU32(wordDoc, 0x1a6) ?? 0;

  const [pieces, prcs] =
    lcbClx > 0 ? parseClx(table, fcClx, lcbClx) : [legacySinglePiece(wordDoc), [] as Uint8Array[]];
  const totalCp = ccpText + ccpFtn + ccpHdd + ccpMcr + ccpAtn + ccpEdn;
  const lid =
    (flags & 0x4000) !== 0
      ? (nonzero(getU16(wordDoc, 0x3c)) ?? getU16(wordDoc, 0x06))
      : getU16(wordDoc, 0x06);
  const encoding = lidEncoding(lid ?? 0);
  const text = extractText(wordDoc, pieces, totalCp, encoding);

  const data = tryOleStream(ole, 'Data') ?? new Uint8Array();
  const chpxRuns = parseFkps(wordDoc, table, 0xfa, 'chpx', data);
  const papxRuns = parseFkps(wordDoc, table, 0x102, 'papx', data);
  const stylesheet = parseStsh(wordDoc, table);
  const listTables = parseLists(wordDoc, table);

  const noteRefs = new Map<number, string>();
  const noteRanges: Array<[number, number, string, NoteKind]> = [];
  const ftnBase = ccpText;
  const ednBase = ccpText + ccpFtn + ccpHdd + ccpMcr + ccpAtn;
  for (const [refOff, txtOff, base, prefix, kind] of [
    [0xaa, 0xb2, ftnBase, 'fn', 'footnote'] as const,
    [0x20a, 0x212, ednBase, 'en', 'endnote'] as const,
  ]) {
    const [refCps, nRefs] = parsePlc(wordDoc, table, refOff, 2);
    const [txtCps] = parsePlc(wordDoc, table, txtOff, 0);
    for (let i = 0; i < nRefs; i += 1) {
      noteRefs.set(text.indexOfCp(refCps[i]!), `${prefix}${i}`);
      if (i + 1 < txtCps.length) {
        const lo = text.indexOfCp(base + txtCps[i]!);
        const hi = text.indexOfCp(base + txtCps[i + 1]!);
        noteRanges.push([lo, hi, `${prefix}${i}`, kind]);
      }
    }
  }
  const mainEnd = text.indexOfCp(ccpText);

  const piecePrcs = pieces.map((p) => p.prmPrc);
  const assembler = new Assembler(
    text,
    new Runs(chpxRuns),
    new Runs(papxRuns),
    stylesheet,
    listTables,
    prcs,
    piecePrcs,
    noteRefs,
    data,
  );
  const blocks = assembler.buildBlocks(0, mainEnd);
  const notes: Note[] = [];
  for (const [lo0, hi0, id, kind] of noteRanges) {
    const lo = Math.min(lo0, assembler.text.chars.length);
    const hi = Math.min(hi0, assembler.text.chars.length);
    if (lo >= hi) continue;
    notes.push({ id, kind, blocks: assembler.buildBlocks(lo, hi) });
  }
  return { blocks, notes, assets: assembler.assets.assets };
}

function nonzero(v: number | undefined): number | undefined {
  return v !== undefined && v !== 0 ? v : undefined;
}

function tryOleStream(ole: CompoundFile, name: string): Uint8Array | undefined {
  try {
    return readOleStream(ole, name);
  } catch (e) {
    if (e instanceof ConvertError && e.code === 'resourceLimit') throw e;
    return undefined;
  }
}

/** Read a PLC's CP array; n is the number of data elements. */
function parsePlc(
  wordDoc: Uint8Array,
  table: Uint8Array,
  fibOff: number,
  dataSize: number,
): [number[], number] {
  const fc = getU32(wordDoc, fibOff) ?? 0;
  const lcb = getU32(wordDoc, fibOff + 4) ?? 0;
  if (fc + lcb > table.length) return [[], 0];
  const plc = table.subarray(fc, fc + lcb);
  if (lcb < 8) return [[], 0];
  const n = dataSize === 0 ? Math.floor(lcb / 4) - 1 : Math.floor((lcb - 4) / (4 + dataSize));
  const cps: number[] = [];
  for (let i = 0; i <= n; i += 1) cps.push(getU32(plc, i * 4) ?? 0);
  return [cps, n];
}

interface Piece {
  cpStart: number;
  cpEnd: number;
  fc: number;
  compressed: boolean;
  prmPrc: number | undefined;
}

function parseClx(table: Uint8Array, fc: number, lcb: number): [Piece[], Uint8Array[]] {
  if (fc + lcb > table.length) throw ConvertError.malformed('Clx out of bounds');
  const clx = table.subarray(fc, fc + lcb);
  const prcs: Uint8Array[] = [];
  let pos = 0;
  for (;;) {
    if (pos >= clx.length) throw ConvertError.malformed('malformed Clx');
    const rest = clx.subarray(pos);
    const tag = rest[0];
    if (tag === 1) {
      const cb = getU16(rest, 1);
      if (cb === undefined) throw ConvertError.malformed('bad Prc');
      if (3 + cb <= rest.length) prcs.push(new Uint8Array(rest.subarray(3, 3 + cb)));
      pos += 3 + cb;
    } else if (tag === 2) {
      const lcbPlc = getU32(rest, 1);
      if (lcbPlc === undefined) throw ConvertError.malformed('bad Pcdt');
      if (5 + lcbPlc > rest.length) throw ConvertError.malformed('PlcPcd out of bounds');
      const plc = rest.subarray(5, 5 + lcbPlc);
      return [parsePlcPcd(plc, prcs), prcs];
    } else {
      throw ConvertError.malformed('malformed Clx');
    }
  }
}

function parsePlcPcd(plc: Uint8Array, prcs: Uint8Array[]): Piece[] {
  if (plc.length < 4 + 12) throw ConvertError.malformed('empty piece table');
  const n = Math.floor((plc.length - 4) / 12);
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i += 1) {
    const cpStart = getU32(plc, i * 4);
    const cpEnd = getU32(plc, (i + 1) * 4);
    if (cpStart === undefined || cpEnd === undefined) throw ConvertError.malformed('bad cp');
    const pcdOff = (n + 1) * 4 + i * 8;
    const fcRaw = getU32(plc, pcdOff + 2);
    if (fcRaw === undefined) throw ConvertError.malformed('bad pcd');
    const prm = getU16(plc, pcdOff + 6) ?? 0;
    const compressed = (fcRaw & 0x40000000) !== 0;
    let fc = fcRaw & 0x3fffffff;
    if (compressed) fc = Math.floor(fc / 2);
    let prmPrc: number | undefined;
    if ((prm & 1) !== 0) {
      const idx = prm >>> 1;
      prmPrc = idx < prcs.length ? idx : undefined;
    } else if (prm !== 0) {
      const grpprl = prm0Grpprl(prm);
      if (grpprl !== undefined) {
        prcs.push(grpprl);
        prmPrc = prcs.length - 1;
      } else {
        debug(`Prm0 sprm outside the converted model: 0x${prm.toString(16).padStart(4, '0')}`);
      }
    }
    pieces.push({ cpStart, cpEnd, fc, compressed, prmPrc });
  }
  return pieces;
}

/**
 * Decode a `Prm0` (compressed piece Prm): the 7-bit `isprm` selects a Sprm
 * per the [MS-DOC] Prm0 table, `val` is its one-byte operand.
 */
function prm0Grpprl(prm: number): Uint8Array | undefined {
  const isprm = (prm >>> 1) & 0x7f;
  const val = (prm >>> 8) & 0xff;
  let sprm: number;
  switch (isprm) {
    case 0x0c:
      sprm = 0x260a;
      break;
    case 0x18:
      sprm = 0x2416;
      break;
    case 0x19:
      sprm = 0x2417;
      break;
    case 0x55:
      sprm = 0x0835;
      break;
    case 0x56:
      sprm = 0x0836;
      break;
    case 0x57:
      sprm = 0x0837;
      break;
    case 0x78:
      sprm = 0x2640;
      break;
    default:
      return undefined;
  }
  return Uint8Array.of(sprm & 0xff, sprm >>> 8, val);
}

function legacySinglePiece(wordDoc: Uint8Array): Piece[] {
  const fcMin = getU32(wordDoc, 0x18) ?? 0;
  const fcMac = getU32(wordDoc, 0x1c) ?? 0;
  if (fcMac <= fcMin) return [];
  return [{ cpStart: 0, cpEnd: fcMac - fcMin, fc: fcMin, compressed: true, prmPrc: undefined }];
}

class TextStream {
  chars: string[] = [];
  fcs: number[] = [];
  cps: number[] = [];
  pieceOf: number[] = [];
  private n = 0;

  reserve(cap: number): void {
    this.chars = new Array(cap);
    this.fcs = new Array(cap);
    this.cps = new Array(cap);
    this.pieceOf = new Array(cap);
    this.n = 0;
  }

  push(char: string, fc: number, cp: number, pieceIdx: number): void {
    const i = this.n;
    this.chars[i] = char;
    this.fcs[i] = fc;
    this.cps[i] = cp;
    this.pieceOf[i] = pieceIdx;
    this.n = i + 1;
  }

  finish(): void {
    this.chars.length = this.n;
    this.fcs.length = this.n;
    this.cps.length = this.n;
    this.pieceOf.length = this.n;
  }

  /** First char index at or after the given CP (`chars.length` when past end). */
  indexOfCp(cp: number): number {
    let lo = 0;
    let hi = this.cps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cps[mid]! < cp) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

type DocEncoding =
  | 'cp932'
  | 'cp949'
  | 'big5'
  | 'gbk'
  | 'windows-1256'
  | 'windows-1251'
  | 'windows-1250'
  | 'windows-1253'
  | 'windows-1255'
  | 'windows-874'
  | 'windows-1254'
  | 'windows-1257'
  | 'windows-1258'
  | 'windows-1252';

function lidEncoding(lid: number): DocEncoding {
  switch (lid & 0x03ff) {
    case 0x11:
      return 'cp932';
    case 0x12:
      return 'cp949';
    case 0x04:
      return lid === 0x0404 || lid === 0x0c04 || lid === 0x1404 || lid === 0x7c04 ? 'big5' : 'gbk';
    case 0x01:
    case 0x20:
    case 0x29:
      return 'windows-1256';
    case 0x02:
    case 0x19:
    case 0x22:
    case 0x23:
      return 'windows-1251';
    case 0x05:
    case 0x0e:
    case 0x15:
    case 0x18:
    case 0x1a:
    case 0x1b:
    case 0x24:
      return 'windows-1250';
    case 0x08:
      return 'windows-1253';
    case 0x0d:
      return 'windows-1255';
    case 0x1e:
      return 'windows-874';
    case 0x1f:
    case 0x2c:
      return 'windows-1254';
    case 0x25:
    case 0x26:
    case 0x27:
      return 'windows-1257';
    case 0x2a:
      return 'windows-1258';
    default:
      return 'windows-1252';
  }
}

function isLeadByte(enc: DocEncoding, b: number): boolean {
  if (enc === 'cp932') return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
  if (enc === 'gbk' || enc === 'big5' || enc === 'cp949') return b >= 0x81 && b <= 0xfe;
  return false;
}

function decodeAnsi(bytes: Uint8Array, encoding: DocEncoding): string {
  return decode(bytes, encoding);
}

function isDbcs(encoding: DocEncoding): boolean {
  return encoding === 'cp932' || encoding === 'gbk' || encoding === 'big5' || encoding === 'cp949';
}

/** Fallback: one iconv call per Word CP, matching the published byte-accurate path. */
function extractCompressedPerSeq(
  text: TextStream,
  bytes: Uint8Array,
  pieceFc: number,
  pieceIdx: number,
  encoding: DocEncoding,
  startCp: number,
): number {
  let cp = startCp;
  let i = 0;
  while (i < bytes.length) {
    const seq = isLeadByte(encoding, bytes[i]!) && i + 1 < bytes.length ? 2 : 1;
    const s = decodeAnsi(bytes.subarray(i, i + seq), encoding);
    for (const c of s) text.push(c, pieceFc + i, cp, pieceIdx);
    cp += seq;
    i += seq;
  }
  return cp;
}

function extractText(
  wordDoc: Uint8Array,
  pieces: readonly Piece[],
  totalCp: number,
  encoding: DocEncoding,
): TextStream {
  const text = new TextStream();
  text.reserve(totalCp);
  let cp = 0;
  const dbcs = isDbcs(encoding);
  for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx += 1) {
    if (cp >= totalCp) break;
    const piece = pieces[pieceIdx]!;
    const len = Math.min(Math.max(piece.cpEnd - piece.cpStart, 0), totalCp - cp);
    if (piece.compressed) {
      if (piece.fc + len > wordDoc.length) continue;
      const bytes = wordDoc.subarray(piece.fc, piece.fc + len);
      if (!dbcs) {
        const s = decodeAnsi(bytes, encoding);
        if (s.length !== bytes.length) {
          cp = extractCompressedPerSeq(text, bytes, piece.fc, pieceIdx, encoding, cp);
          continue;
        }
        for (let i = 0; i < s.length; i += 1) {
          text.push(s[i]!, piece.fc + i, cp, pieceIdx);
          cp += 1;
        }
      } else {
        const seqOff: number[] = [];
        const seqLen: number[] = [];
        let i = 0;
        while (i < bytes.length) {
          const seq = isLeadByte(encoding, bytes[i]!) && i + 1 < bytes.length ? 2 : 1;
          seqOff.push(i);
          seqLen.push(seq);
          i += seq;
        }
        const s = decodeAnsi(bytes, encoding);
        if (s.length !== seqOff.length) {
          cp = extractCompressedPerSeq(text, bytes, piece.fc, pieceIdx, encoding, cp);
          continue;
        }
        for (let k = 0; k < seqOff.length; k += 1) {
          text.push(s[k]!, piece.fc + seqOff[k]!, cp, pieceIdx);
          cp += seqLen[k]!;
        }
      }
    } else {
      const byteLen = len * 2;
      if (byteLen > Number.MAX_SAFE_INTEGER) continue;
      if (piece.fc + byteLen > wordDoc.length) continue;
      const bytes = wordDoc.subarray(piece.fc, piece.fc + byteLen);
      const nUnits = bytes.length >> 1;
      let unitIdx = 0;
      while (unitIdx < nUnits) {
        const u = bytes[unitIdx * 2]! | (bytes[unitIdx * 2 + 1]! << 8);
        let char: string;
        let units = 1;
        if (u >= 0xd800 && u <= 0xdbff) {
          if (unitIdx + 1 < nUnits) {
            const u2 = bytes[(unitIdx + 1) * 2]! | (bytes[(unitIdx + 1) * 2 + 1]! << 8);
            if (u2 >= 0xdc00 && u2 <= 0xdfff) {
              char = String.fromCodePoint(0x10000 + ((u - 0xd800) << 10) + (u2 - 0xdc00));
              units = 2;
            } else {
              char = '\uFFFD';
            }
          } else {
            char = '\uFFFD';
          }
        } else if (u >= 0xdc00 && u <= 0xdfff) {
          char = '\uFFFD';
        } else {
          char = String.fromCharCode(u);
        }
        text.push(char, piece.fc + unitIdx * 2, cp, pieceIdx);
        unitIdx += units;
        cp += units;
      }
    }
  }
  text.finish();
  return text;
}

type FkpKind = 'chpx' | 'papx';

interface RunProps {
  chpx: Uint8Array;
  istd: number;
  pap: PapDelta;
  /** Cached `sprmCIstd` from `chpx`, if any. */
  chpxIstd: number | undefined;
}

const EMPTY_CHPX = new Uint8Array();
const NO_FC = 0x100000000;

function emptyRunProps(): RunProps {
  return { chpx: EMPTY_CHPX, istd: 0, pap: emptyPapDelta(), chpxIstd: undefined };
}

interface Run {
  fcStart: number;
  fcEnd: number;
  props: RunProps;
}

class Runs {
  private readonly runs: Run[];

  constructor(runs: Run[]) {
    this.runs = runs.slice().sort((a, b) => a.fcStart - b.fcStart);
  }

  lookup(fc: number): RunProps | undefined {
    return this.lookupRun(fc)?.props;
  }

  lookupRun(fc: number): Run | undefined {
    let lo = 0;
    let hi = this.runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.runs[mid]!.fcStart <= fc) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return undefined;
    const run = this.runs[lo - 1]!;
    return fc < run.fcEnd ? run : undefined;
  }

  /** First run start strictly after `fc`, or a sentinel past any Word FC. */
  nextStart(fc: number): number {
    let lo = 0;
    let hi = this.runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.runs[mid]!.fcStart <= fc) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.runs.length ? this.runs[lo]!.fcStart : NO_FC;
  }
}

function parseFkps(
  wordDoc: Uint8Array,
  table: Uint8Array,
  fibOff: number,
  kind: FkpKind,
  data: Uint8Array,
): Run[] {
  const runs: Run[] = [];
  const fc = getU32(wordDoc, fibOff) ?? 0;
  const lcb = getU32(wordDoc, fibOff + 4) ?? 0;
  if (fc + lcb > table.length) return runs;
  const plc = table.subarray(fc, fc + lcb);
  if (plc.length < 8) return runs;
  const n = Math.floor((plc.length - 4) / 8);
  for (let i = 0; i < n; i += 1) {
    const pnRaw = getU32(plc, (n + 1) * 4 + i * 4);
    if (pnRaw === undefined) continue;
    const pn = pnRaw & 0x3fffff;
    const pageOff = pn * 512;
    if (pageOff + 512 > wordDoc.length) continue;
    parseFkpPage(wordDoc.subarray(pageOff, pageOff + 512), kind, data, runs);
  }
  return runs;
}

function parseFkpPage(page: Uint8Array, kind: FkpKind, data: Uint8Array, runs: Run[]): void {
  const count = page[511] ?? 0;
  if (count === 0) return;
  const entrySize = kind === 'papx' ? 13 : 1;
  for (let k = 0; k < count; k += 1) {
    const fcStart = getU32(page, k * 4);
    const fcEnd = getU32(page, (k + 1) * 4);
    if (fcStart === undefined || fcEnd === undefined) continue;
    const bOffsetPos = (count + 1) * 4 + k * entrySize;
    const bOffset = page[bOffsetPos];
    if (bOffset === undefined) continue;
    const props = emptyRunProps();
    if (bOffset !== 0) {
      const off = bOffset * 2;
      if (kind === 'chpx') {
        const cb = page[off];
        if (cb !== undefined && off + 1 + cb <= page.length) {
          props.chpx = page.subarray(off + 1, off + 1 + cb);
          props.chpxIstd = chpxIstd(props.chpx);
        }
      } else {
        const cb = page[off];
        if (cb !== undefined) {
          let start: number;
          let len: number;
          if (cb === 0) {
            const cb2 = page[off + 1] ?? 0;
            start = off + 2;
            len = cb2 * 2;
          } else {
            start = off + 1;
            len = cb * 2 - 1;
          }
          if (start + len <= page.length && len >= 2) {
            const grpprl = page.subarray(start, start + len);
            props.istd = grpprl[0]! | (grpprl[1]! << 8);
            applyPapSprms(grpprl.subarray(2), data, props.pap);
          }
        }
      }
    }
    runs.push({ fcStart, fcEnd, props });
  }
}

class Counters {
  private readonly state = new Map<number, { values: number[]; started: boolean[] }>();
  private readonly overridden = new Set<string>();

  next(ilfo: number, list: ListDef, level0: number): [number, string | undefined] {
    const level = Math.min(level0, LEVELS - 1);
    const def = list.levels[level] ?? {
      marker: 'bullet',
      start: 1,
      restart: undefined,
      pattern: { text: [], legal: false },
    };
    const firstUse = !this.overridden.has(`${ilfo},${level}`);
    this.overridden.add(`${ilfo},${level}`);
    let slot = this.state.get(list.lsid);
    if (slot === undefined) {
      slot = {
        values: Array.from({ length: LEVELS }, () => 0),
        started: Array.from({ length: LEVELS }, () => false),
      };
      this.state.set(list.lsid, slot);
    }
    const { values, started } = slot;
    const over = list.startOverride[level];
    let value: number;
    if (over !== undefined && firstUse) value = over;
    else if (started[level]) value = values[level]! + 1;
    else value = def.start;
    values[level] = value;
    started[level] = true;
    for (let deeper = level + 1; deeper < list.levels.length && deeper < LEVELS; deeper += 1) {
      const deeperDef = list.levels[deeper]!;
      const triggered = deeperDef.restart === undefined || level < deeperDef.restart;
      if (triggered) started[deeper] = false;
    }
    return [value, renderCompositeLabel(list, values, started, level)];
  }
}

function renderCompositeLabel(
  list: ListDef,
  values: readonly number[],
  started: readonly boolean[],
  level: number,
): string | undefined {
  const def = list.levels[level];
  if (def === undefined || def.marker === undefined) return undefined;
  const marker = def.marker;
  return compositeLabel(
    def.pattern,
    marker,
    values[level]!,
    (l) => {
      const m = list.levels[Math.min(l, LEVELS - 1)]?.marker;
      return m ?? 'decimal';
    },
    (l) => {
      const idx = Math.min(l, LEVELS - 1);
      return started[idx] ? values[idx]! : (list.levels[idx]?.start ?? 1);
    },
  );
}

interface EffectivePap {
  istd: number;
  effective: PapDelta;
}

class ParaBuilder {
  inlines: Inline[] = [];
  fields: FieldFrame[] = [];
  text = '';
  style: Style = { ...PLAIN };

  flushText(): void {
    if (this.text.length === 0) return;
    const text = this.text;
    this.text = '';
    const inline: Inline = { type: 'text', text, style: { ...this.style } };
    const f = this.fields[this.fields.length - 1];
    if (f !== undefined && !f.inResult) f.instr += inlinesToPlainText([inline]);
    else if (f !== undefined) f.inlines.push(inline);
    else this.inlines.push(inline);
  }

  pushChar(c: string, style: Style): void {
    if (style !== this.style) {
      if (!stylesEqual(style, this.style)) this.flushText();
      this.style = style;
    }
    this.text += c;
  }

  pushInline(inline: Inline): void {
    this.flushText();
    const f = this.fields[this.fields.length - 1];
    if (f !== undefined && !f.inResult) return;
    if (f !== undefined) f.inlines.push(inline);
    else this.inlines.push(inline);
  }

  fieldBegin(): void {
    this.flushText();
    this.fields.push(emptyFieldFrame());
  }

  fieldSeparate(): void {
    this.flushText();
    const f = this.fields[this.fields.length - 1];
    if (f !== undefined) f.inResult = true;
  }

  fieldEnd(): void {
    this.flushText();
    const frame = this.fields.pop();
    if (frame === undefined) return;
    for (const inline of fieldResult(frame.instr, frame.inlines)) {
      const f = this.fields[this.fields.length - 1];
      if (f !== undefined && !f.inResult) continue;
      if (f !== undefined) f.inlines.push(inline);
      else this.inlines.push(inline);
    }
  }

  finish(): Inline[] {
    this.flushText();
    while (this.fields.length > 0) this.fieldEnd();
    return this.inlines;
  }
}

class Assembler {
  readonly text: TextStream;
  private readonly chpx: Runs;
  private readonly papx: Runs;
  private readonly stylesheet: Stylesheet;
  private readonly lists: Lists;
  private readonly prcs: Uint8Array[];
  private readonly piecePrcs: Array<number | undefined>;
  private readonly noteRefs: Map<number, string>;
  private readonly counters = new Counters();
  private readonly data: Uint8Array;
  readonly assets = new AssetSink();
  private lastStyleFcStart = -1;
  private lastStyleFcEnd = -1;
  private lastStylePiece = -2;
  private lastCharStyle: Style = { ...PLAIN };

  constructor(
    text: TextStream,
    chpx: Runs,
    papx: Runs,
    stylesheet: Stylesheet,
    lists: Lists,
    prcs: Uint8Array[],
    piecePrcs: Array<number | undefined>,
    noteRefs: Map<number, string>,
    data: Uint8Array,
  ) {
    this.text = text;
    this.chpx = chpx;
    this.papx = papx;
    this.stylesheet = stylesheet;
    this.lists = lists;
    this.prcs = prcs;
    this.piecePrcs = piecePrcs;
    this.noteRefs = noteRefs;
    this.data = data;
  }

  buildBlocks(lo: number, hi: number): Block[] {
    const blocks: Block[] = [];
    const listRun: ListEntry[] = [];
    const styled = new StyledRun();
    let cellBlocks: Block[] = [];
    const cellStyled = new StyledRun();
    let row: Block[][] = [];
    const tableRows: DocRow[] = [];
    let para = new ParaBuilder();

    let i = lo;
    const limit = Math.min(hi, this.text.chars.length);
    while (i < limit) {
      const c = this.text.chars[i]!;
      const fc = this.text.fcs[i]!;
      const noteId = this.noteRefs.get(i);
      if (noteId !== undefined) {
        para.pushInline({ type: 'noteRef', id: noteId });
        i += 1;
        continue;
      }
      if (c === '\r' || c === '\u0007' || c === '\u000c' || c === '\u000e') {
        const pap = this.effectivePap(fc, i);
        const inlines = para.finish();
        para = new ParaBuilder();
        const isCellMark = c === '\u0007';
        if (pap.effective.inTable === true || isCellMark) {
          styled.flush(blocks);
          flushList(blocks, listRun);
          const inner =
            (pap.effective.itap ?? 1) > 1 ||
            pap.effective.innerCell === true ||
            pap.effective.innerTtp === true;
          if (inner) {
            this.emitCellParagraph(pap, inlines, cellBlocks, cellStyled);
          } else if (isCellMark && pap.effective.ttp === true) {
            cellStyled.flush(cellBlocks);
            if (row.length > 0) {
              tableRows.push({
                cells: row,
                tap: pap.effective.tap === undefined ? undefined : cloneTap(pap.effective.tap),
              });
              row = [];
            }
          } else if (isCellMark) {
            this.emitCellParagraph(pap, inlines, cellBlocks, cellStyled);
            cellStyled.flush(cellBlocks);
            row.push(cellBlocks);
            cellBlocks = [];
          } else {
            this.emitCellParagraph(pap, inlines, cellBlocks, cellStyled);
          }
        } else {
          flushTable(blocks, tableRows, row, cellBlocks);
          row = [];
          cellBlocks = [];
          this.emitParagraph(pap, inlines, blocks, listRun, styled);
        }
      } else if (c === '\u000b') {
        para.pushInline({ type: 'lineBreak' });
      } else if (c === '\u0013') {
        para.fieldBegin();
      } else if (c === '\u0014') {
        para.fieldSeparate();
      } else if (c === '\u0015') {
        para.fieldEnd();
      } else if (c === '\t') {
        para.pushChar(' ', this.charStyle(fc, i));
      } else if (c === '\u001e') {
        para.pushChar('-', this.charStyle(fc, i));
      } else if (c === '\u0001') {
        const image = this.pictureAt(fc);
        if (image !== undefined) para.pushInline(image);
      } else if (c === '\u0002' || c === '\u0005' || c === '\u0008' || c === '\u001f') {
        // skipped specials
      } else if (isControl(c)) {
        // other controls
      } else {
        para.pushChar(c, this.charStyle(fc, i));
      }
      i += 1;
    }
    const inlines = para.finish();
    cellStyled.flush(cellBlocks);
    flushTable(blocks, tableRows, row, cellBlocks);
    if (!inlinesAreEmpty(inlines)) {
      styled.flush(blocks);
      flushList(blocks, listRun);
      blocks.push({ type: 'paragraph', inlines });
    }
    styled.flush(blocks);
    flushList(blocks, listRun);
    return blocks;
  }

  private charStyle(fc: number, charIndex: number): Style {
    const pieceIdx = this.text.pieceOf[charIndex] ?? -1;
    if (
      pieceIdx === this.lastStylePiece &&
      fc >= this.lastStyleFcStart &&
      fc < this.lastStyleFcEnd
    ) {
      return this.lastCharStyle;
    }
    const papRun = this.papx.lookupRun(fc);
    const chpRun = this.chpx.lookupRun(fc);
    let lo = 0;
    let hi = NO_FC;
    if (papRun !== undefined) {
      if (papRun.fcStart > lo) lo = papRun.fcStart;
      if (papRun.fcEnd < hi) hi = papRun.fcEnd;
    } else {
      const next = this.papx.nextStart(fc);
      if (next < hi) hi = next;
    }
    if (chpRun !== undefined) {
      if (chpRun.fcStart > lo) lo = chpRun.fcStart;
      if (chpRun.fcEnd < hi) hi = chpRun.fcEnd;
    } else {
      const next = this.chpx.nextStart(fc);
      if (next < hi) hi = next;
    }
    this.lastStyleFcStart = lo;
    this.lastStyleFcEnd = hi > lo ? hi : fc + 1;
    this.lastStylePiece = pieceIdx;
    const paraIstd = papRun?.props.istd ?? 0;
    const chp = chpRun?.props;
    const chpx = chp?.chpx ?? EMPTY_CHPX;
    const istd = chp?.chpxIstd ?? paraIstd;
    const base = this.stylesheet.get(istd).chp;
    const piecePrc = pieceIdx >= 0 ? this.piecePrm(pieceIdx) : undefined;
    let style = chpx.length === 0 ? base : applyChpx(chpx, base, base);
    if (piecePrc !== undefined) style = applyChpx(piecePrc, style, base);
    this.lastCharStyle = style;
    return style;
  }

  private piecePrm(pieceIdx: number): Uint8Array | undefined {
    const prcIdx = this.piecePrcs[pieceIdx];
    if (prcIdx === undefined) return undefined;
    return this.prcs[prcIdx];
  }

  private effectivePap(fc: number, charIndex: number): EffectivePap {
    const looked = this.papx.lookup(fc);
    const istd = looked?.istd ?? 0;
    const papxDelta = looked === undefined ? emptyPapDelta() : clonePapDelta(looked.pap);
    const style = this.stylesheet.get(istd);
    let effective = mergePap(clonePapDelta(style.pap), papxDelta);
    const pieceIdx = this.text.pieceOf[charIndex];
    if (pieceIdx !== undefined) {
      const prm = this.piecePrm(pieceIdx);
      if (prm !== undefined) {
        const prmDelta = emptyPapDelta();
        applyPapSprms(prm, EMPTY_CHPX, prmDelta);
        effective = mergePap(effective, prmDelta);
      }
    }
    return { istd, effective };
  }

  private emitParagraph(
    pap: EffectivePap,
    inlines: Inline[],
    blocks: Block[],
    listRun: ListEntry[],
    styled: StyledRun,
  ): void {
    const style = this.stylesheet.get(pap.istd);
    if (style.block !== undefined) {
      flushList(blocks, listRun);
      styled.push(style.block, inlines, blocks);
      return;
    }
    if (inlinesAreEmpty(inlines)) {
      styled.flush(blocks);
      flushList(blocks, listRun);
      return;
    }
    const heading = style.heading ?? pap.effective.outline ?? undefined;
    if (heading !== undefined) {
      styled.flush(blocks);
      flushList(blocks, listRun);
      const content = inlines;
      rebaseEmphasis(content, style.chp);
      const label = this.headingLabel(pap);
      if (label !== undefined) {
        content.unshift({ type: 'text', text: label, style: { ...PLAIN } });
      }
      blocks.push({ type: 'heading', level: heading, anchor: undefined, content });
      return;
    }
    const ilfo = pap.effective.ilfo ?? 0;
    if (ilfo !== 0 && ilfo !== 0xf801) {
      const ilvl = pap.effective.ilvl ?? 0;
      const list = this.lists.get(ilfo) ?? unknownListDef(ilfo);
      const def = list.levels[Math.min(ilvl, LEVELS - 1)];
      const marker = def?.marker;
      if (marker !== undefined) {
        let number = 0;
        let label: string | undefined;
        if (markerIsOrdered(marker)) {
          [number, label] = this.counters.next(ilfo, list, ilvl);
        }
        styled.flush(blocks);
        listRun.push({
          level: ilvl,
          key: { instance: list.lsid, marker },
          number,
          label,
          blocks: [{ type: 'paragraph', inlines }],
        });
        return;
      }
    }
    styled.flush(blocks);
    flushList(blocks, listRun);
    blocks.push({ type: 'paragraph', inlines });
  }

  private emitCellParagraph(
    pap: EffectivePap,
    inlines: Inline[],
    blocks: Block[],
    styled: StyledRun,
  ): void {
    const block = this.stylesheet.get(pap.istd).block;
    if (block !== undefined) {
      styled.push(block, inlines, blocks);
    } else {
      styled.flush(blocks);
      if (!inlinesAreEmpty(inlines)) blocks.push({ type: 'paragraph', inlines });
    }
  }

  private pictureAt(fc: number): Inline | undefined {
    const offset =
      this.chpx.lookup(fc) !== undefined ? chpxPicLocation(this.chpx.lookup(fc)!.chpx) : undefined;
    if (offset === undefined) return undefined;
    const lcb = getU32(this.data, offset);
    if (lcb === undefined) return undefined;
    const cbHeader = getU16(this.data, offset + 4);
    if (cbHeader === undefined) return undefined;
    if (offset + lcb > this.data.length) {
      debug('picture data out of bounds in the Data stream');
      return undefined;
    }
    const picf = this.data.subarray(offset, offset + lcb);
    const art = picf.subarray(Math.min(cbHeader, picf.length));
    const blip = firstBlip(art, MAX_ENTRY_BYTES);
    if (blip === undefined) {
      debug('skipping picture with no supported blip payload');
      return undefined;
    }
    const part = `data/pic${offset}.${blip.extension}`;
    const id = this.assets.add(blip.mediaType, part, blip.bytes);
    return { type: 'image', alt: '', source: { type: 'asset', id } };
  }

  private headingLabel(pap: EffectivePap): string | undefined {
    const ilfo = pap.effective.ilfo ?? 0;
    if (ilfo === 0 || ilfo === 0xf801) return undefined;
    const ilvl = pap.effective.ilvl ?? 0;
    const list = this.lists.get(ilfo);
    if (list === undefined) return undefined;
    const def = list.levels[Math.min(ilvl, LEVELS - 1)];
    if (def === undefined || def.marker === undefined) return undefined;
    const marker = def.marker;
    if (!markerIsOrdered(marker)) return undefined;
    const [number, label] = this.counters.next(ilfo, list, ilvl);
    return `${label ?? markerLabel(marker, number)} `;
  }
}

interface DocRow {
  cells: Block[][];
  tap: Tap | undefined;
}

function flushTable(
  blocks: Block[],
  tableRows: DocRow[],
  row: Block[][],
  cellBlocks: Block[],
): void {
  if (cellBlocks.length > 0) row.push(cellBlocks.splice(0, cellBlocks.length));
  if (row.length > 0) {
    tableRows.push({ cells: row.splice(0, row.length), tap: undefined });
  }
  if (tableRows.length === 0) return;
  const rows = tableRows.splice(0, tableRows.length).map(docRowToGridRow);
  const block = buildEdgeTable(rows);
  if (block !== undefined) blocks.push(block);
}

function docRowToGridRow(row: DocRow): GridRow {
  const header = row.tap?.header === true;
  const tap = row.tap ?? emptyTap();
  const cells: Array<[Block[], CellProp]> = row.cells.map((blocks, k) => {
    const tc = tap.cells[k] ?? {
      horzFirst: false,
      horzCont: false,
      vertRestart: false,
      vertCont: false,
    };
    const right = tap.boundaries[k + 1] ?? (k + 1) * 1000;
    const prop: CellProp = {
      mergeFirst: tc.horzFirst,
      mergeCont: tc.horzCont,
      vmergeFirst: tc.vertRestart,
      vmergeCont: tc.vertCont,
      right,
    };
    return [blocks, prop];
  });
  return { cells, header };
}
