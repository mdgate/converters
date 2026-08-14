//! WordprocessingML numbering: `numId -> w:num` (with level overrides) `->
//! abstractNum` (with `numStyleLink` indirection) `-> level`, plus the
//! document-order counters that produce each paragraph's effective number.

import {
  compositeLabel,
  emptyNumberPattern,
  type NumberPattern,
  parsePercentPattern,
} from '../../common/numbering.js';
import { ConvertError } from '../../error.js';
import { warn } from '../../log.js';
import { type MarkerKind, markerIsOrdered } from '../../model/index.js';
import { type Element, ns } from '../../package/xml.js';
import { onOff, parseUint } from './styles.js';

export const LEVELS = 9;

export interface LevelDef {
  /** `undefined` = suppressed numbering (`numFmt` of `none`). */
  marker: MarkerKind | undefined;
  start: number;
  /**
   * `w:lvlRestart`: `undefined` = restart when any shallower level appears,
   * `0` = never restart, `n` = restart when a level with `ilvl < n` appears.
   */
  restart: number | undefined;
  /** `w:lvlText` (with `w:isLgl`) as the shared pattern IR. */
  pattern: NumberPattern;
}

export function defaultLevel(): LevelDef {
  return {
    marker: 'bullet',
    start: 1,
    restart: undefined,
    pattern: emptyNumberPattern(),
  };
}

interface AbstractNum {
  levels: LevelDef[];
  /** Paragraph style each level binds to via `w:lvl > w:pStyle`. */
  pstyles: (string | undefined)[];
  numStyleLink: string | undefined;
}

export class Instance {
  readonly levels: LevelDef[];
  private readonly pstyles: (string | undefined)[];

  constructor(levels: LevelDef[], pstyles: (string | undefined)[]) {
    this.levels = levels;
    this.pstyles = pstyles;
  }

  /**
   * The level bound to a paragraph style through the abstract levels'
   * `w:pStyle` references.
   */
  styleLevel(styleId: string): number | undefined {
    const i = this.pstyles.indexOf(styleId);
    return i >= 0 ? i : undefined;
  }
}

export class Numbering {
  private readonly instances = new Map<number, Instance>();

  instance(numId: number): Instance | undefined {
    return this.instances.get(numId);
  }

  setInstance(numId: number, instance: Instance): void {
    this.instances.set(numId, instance);
  }
}

/**
 * `styleNumId` maps a numbering style id to the `numId` its own `numPr`
 * references (the `numStyleLink`/`styleLink` indirection contract).
 */
export function parseNumbering(
  root: Element,
  styleNumId: (styleId: string) => number | undefined,
): Numbering {
  const abstracts = new Map<string, AbstractNum>();
  for (const abs of root.findAll(ns.W, 'abstractNum')) {
    const id = abs.attr(ns.W, 'abstractNumId');
    if (id === undefined) continue;
    const levels = Array.from({ length: LEVELS }, () => defaultLevel());
    const pstyles: (string | undefined)[] = Array.from({ length: LEVELS }, () => undefined);
    for (const lvl of abs.findAll(ns.W, 'lvl')) {
      const ilvl = parseUint(lvl.attr(ns.W, 'ilvl') ?? '') ?? 0;
      if (ilvl < LEVELS) {
        levels[ilvl] = parseLevel(lvl);
        pstyles[ilvl] = levelPstyle(lvl);
      }
    }
    const numStyleLink = abs.find(ns.W, 'numStyleLink')?.attr(ns.W, 'val');
    abstracts.set(id, { levels, pstyles, numStyleLink });
  }

  const direct = new Map<number, { absId: string; numElem: Element }>();
  for (const num of root.findAll(ns.W, 'num')) {
    const numId = parseUint(num.attr(ns.W, 'numId') ?? '');
    const absId = num.find(ns.W, 'abstractNumId')?.attr(ns.W, 'val');
    if (numId === undefined || absId === undefined) continue;
    direct.set(numId, { absId, numElem: num });
  }

  const numbering = new Numbering();
  for (const [numId, { absId, numElem }] of direct) {
    const abs = resolveAbstract(absId, abstracts, direct, styleNumId);
    if (abs === undefined) {
      warn(`numbering instance ${numId} references unknown abstract ${JSON.stringify(absId)}`);
      continue;
    }
    const levels = cloneLevels(abs.levels);
    const pstyles = abs.pstyles.slice();
    for (const over of numElem.findAll(ns.W, 'lvlOverride')) {
      const ilvl = parseUint(over.attr(ns.W, 'ilvl') ?? '') ?? 0;
      if (ilvl >= LEVELS) continue;
      // A nested w:lvl replaces the level wholesale; startOverride is
      // applied last so it survives the replacement.
      const lvl = over.find(ns.W, 'lvl');
      if (lvl !== undefined) {
        levels[ilvl] = parseLevel(lvl);
        pstyles[ilvl] = levelPstyle(lvl);
      }
      const startRaw = over.find(ns.W, 'startOverride')?.attr(ns.W, 'val');
      const start = startRaw !== undefined ? parseStart(startRaw) : undefined;
      if (start !== undefined) {
        levels[ilvl]!.start = start;
      }
    }
    numbering.setInstance(numId, new Instance(levels, pstyles));
  }
  return numbering;
}

/**
 * Resolve an abstract definition, following `numStyleLink` indirection:
 * abstract -> numbering style -> that style's `numId` -> its abstract.
 */
function resolveAbstract(
  absId: string,
  abstracts: Map<string, AbstractNum>,
  direct: Map<number, { absId: string; numElem: Element }>,
  styleNumId: (styleId: string) => number | undefined,
): AbstractNum | undefined {
  const seen: string[] = [];
  let current = absId;
  for (;;) {
    if (seen.includes(current)) {
      throw ConvertError.malformed(`numbering indirection cycle at ${JSON.stringify(current)}`);
    }
    seen.push(current);
    const abs = abstracts.get(current);
    if (abs === undefined) return undefined;
    if (abs.numStyleLink === undefined) return abs;
    const numId = styleNumId(abs.numStyleLink);
    const linked = numId !== undefined ? direct.get(numId)?.absId : undefined;
    if (linked === undefined) return abs;
    current = linked;
  }
}

/** The paragraph style a `w:lvl` binds to (`w:pStyle`). */
function levelPstyle(lvl: Element): string | undefined {
  return lvl.find(ns.W, 'pStyle')?.attr(ns.W, 'val');
}

/**
 * `ST_DecimalNumber` is `xsd:int`; values are clamped to the non-negative
 * range so untrusted starting values can never overflow counters.
 */
function parseStart(v: string): number | undefined {
  if (!/^[+-]?\d+$/.test(v)) return undefined;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    return undefined;
  }
  const i64Min = -9223372036854775808n;
  const i64Max = 9223372036854775807n;
  if (n < i64Min || n > i64Max) return undefined;
  const i32Max = 2147483647n;
  if (n < 0n) return 0;
  if (n > i32Max) return 2147483647;
  return Number(n);
}

function parseLevel(lvl: Element): LevelDef {
  const fmt = lvl.find(ns.W, 'numFmt')?.attr(ns.W, 'val') ?? 'bullet';
  let marker: MarkerKind | undefined;
  switch (fmt) {
    case 'none':
      marker = undefined;
      break;
    case 'bullet':
      marker = 'bullet';
      break;
    case 'lowerLetter':
      marker = 'lowerAlpha';
      break;
    case 'upperLetter':
      marker = 'upperAlpha';
      break;
    case 'lowerRoman':
      marker = 'lowerRoman';
      break;
    case 'upperRoman':
      marker = 'upperRoman';
      break;
    default:
      marker = 'decimal';
      break;
  }
  const startRaw = lvl.find(ns.W, 'start')?.attr(ns.W, 'val');
  const start = startRaw !== undefined ? (parseStart(startRaw) ?? 1) : 1;
  const restartRaw = lvl.find(ns.W, 'lvlRestart')?.attr(ns.W, 'val');
  const restart = restartRaw !== undefined ? parseU32(restartRaw) : undefined;
  // The number text pattern applies to ordered levels; bullet lvlText is
  // the glyph itself, not a pattern.
  const text =
    marker !== undefined && markerIsOrdered(marker)
      ? parsePercentPattern(lvl.find(ns.W, 'lvlText')?.attr(ns.W, 'val') ?? '')
      : [];
  const legal = onOff(lvl, 'isLgl') === true;
  return { marker, start, restart, pattern: { text, legal } };
}

function parseU32(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    return undefined;
  }
  if (n > 0xffffffffn) return undefined;
  return Number(n);
}

function cloneLevels(levels: LevelDef[]): LevelDef[] {
  return levels.map((l) => ({
    marker: l.marker,
    start: l.start,
    restart: l.restart,
    pattern: { text: l.pattern.text.slice(), legal: l.pattern.legal },
  }));
}

/**
 * Document-order numbering state: one counter array per instance, shared
 * across interruptions so continuation works, with `lvlRestart` semantics.
 */
export class Counters {
  private readonly state = new Map<number, InstanceState>();

  /**
   * Advance the counter for a paragraph at (`numId`, `ilvl`) and return
   * its effective number plus, when the level's number text is not
   * reproducible from the marker kind alone, the composite label.
   */
  next(
    numId: number,
    ilvl: number,
    instance: Instance,
  ): { value: number; label: string | undefined } {
    const level = Math.min(ilvl, LEVELS - 1);
    let state = this.state.get(numId);
    if (state === undefined) {
      state = newInstanceState();
      this.state.set(numId, state);
    }
    const def = instance.levels[level]!;
    if (!state.initialized[level] || state.restartPending[level]) {
      state.value[level] = def.start;
      state.initialized[level] = true;
      state.restartPending[level] = false;
    } else {
      state.value[level] = saturatingAdd1(state.value[level]!);
    }
    // Using level `ilvl` schedules restarts for deeper levels according
    // to their lvlRestart settings.
    for (let deeper = level + 1; deeper < LEVELS; deeper += 1) {
      const levelDef = instance.levels[deeper]!;
      const triggered =
        levelDef.restart === undefined
          ? true
          : levelDef.restart === 0
            ? false
            : level < levelDef.restart;
      if (triggered) state.restartPending[deeper] = true;
    }
    const value = state.value[level]!;
    const label =
      def.marker !== undefined
        ? compositeLabel(
            def.pattern,
            def.marker,
            value,
            (l) => instance.levels[Math.min(l, LEVELS - 1)]!.marker ?? 'decimal',
            (l) => {
              const i = Math.min(l, LEVELS - 1);
              if (state.initialized[i] && !state.restartPending[i]) return state.value[i]!;
              return instance.levels[i]!.start;
            },
          )
        : undefined;
    return { value, label };
  }
}

interface InstanceState {
  value: number[];
  initialized: boolean[];
  restartPending: boolean[];
}

function newInstanceState(): InstanceState {
  return {
    value: Array.from({ length: LEVELS }, () => 0),
    initialized: Array.from({ length: LEVELS }, () => false),
    restartPending: Array.from({ length: LEVELS }, () => false),
  };
}

function saturatingAdd1(n: number): number {
  return n >= Number.MAX_SAFE_INTEGER ? n : n + 1;
}
