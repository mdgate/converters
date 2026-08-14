/** ODF style resolution: text/paragraph style chains as tri-state deltas. */

import { type BlockStyle, fromStyleName } from '../../common/blockstyle.js';
import { emptyDelta, mergeDelta, type StyleDelta } from '../../common/delta.js';
import type { NumberPattern, NumberText } from '../../common/numbering.js';
import { ConvertError } from '../../error.js';
import type { MarkerKind } from '../../model/index.js';
import { type Element, ns } from '../../package/xml.js';

export const LIST_LEVELS = 10;

export interface ListLevel {
  marker: MarkerKind;
  start: number;
  /** `style:num-prefix` literal text before the number. */
  prefix: string;
  /** `style:num-suffix`; absent means the bare number is displayed. */
  suffix: string | undefined;
  /** `text:display-levels`: how many levels (ending at this one) display. */
  displayLevels: number;
}

export function defaultListLevel(): ListLevel {
  return {
    marker: 'bullet',
    start: 1,
    prefix: '',
    suffix: undefined,
    displayLevels: 1,
  };
}

/** The level's number text as the shared pattern IR. */
export function listLevelPattern(level: ListLevel, depth: number): NumberPattern {
  const text: NumberText[] = [];
  if (level.prefix.length > 0) {
    text.push({ type: 'literal', text: level.prefix });
  }
  const shown = clampInt(level.displayLevels, 1, depth + 1);
  const first = depth + 1 - shown;
  let i = 0;
  for (let lvl = first; lvl <= depth; lvl += 1) {
    if (i > 0) text.push({ type: 'literal', text: '.' });
    text.push({ type: 'level', level: lvl });
    i += 1;
  }
  if (level.suffix !== undefined && level.suffix.length > 0) {
    text.push({ type: 'literal', text: level.suffix });
  }
  return { text, legal: false };
}

export class OdfStyles {
  private readonly raw = new Map<string, { def: Element; parent: string | undefined }>();
  private readonly memo = new Map<string, StyleDelta>();
  private readonly listStyles = new Map<string, ListLevel[]>();
  /** `text:outline-style`: heading numbering per outline level. */
  private outline: ListLevel[] | undefined;
  /** `style:default-style` per family. */
  private readonly defaults = new Map<string, StyleDelta>();

  /**
   * Collect styles from one document tree (`styles.xml` or `content.xml`).
   * Call for styles.xml first so content.xml definitions chain onto it.
   */
  collect(tree: Element): void {
    for (const root of tree.childElems()) {
      for (const section of root.childElems()) {
        if (!(section.is(ns.OFFICE, 'automatic-styles') || section.is(ns.OFFICE, 'styles'))) {
          continue;
        }
        for (const style of section.childElems()) {
          if (style.is(ns.STYLE, 'default-style')) {
            const family = style.attr(ns.STYLE, 'family');
            if (family !== undefined) {
              this.defaults.set(family, textPropertiesDelta(style));
            }
          }
          if (style.is(ns.STYLE, 'style')) {
            const name = style.attr(ns.STYLE, 'name');
            if (name !== undefined) {
              const family = style.attr(ns.STYLE, 'family') ?? '';
              const parentName = style.attr(ns.STYLE, 'parent-style-name');
              const parent = parentName !== undefined ? key(family, parentName) : undefined;
              this.raw.set(key(family, name), { def: style, parent });
            }
          }
          if (style.is(ns.TEXT, 'list-style')) {
            const name = style.attr(ns.STYLE, 'name');
            if (name !== undefined) {
              this.listStyles.set(name, parseListStyle(style));
            }
          }
          if (style.is(ns.TEXT, 'outline-style')) {
            this.outline = parseListStyle(style);
          }
        }
      }
    }
  }

  /**
   * Cumulative delta of a style through its `parent-style-name` chain,
   * over the family's `style:default-style` base.
   */
  delta(family: string, name: string): StyleDelta {
    const id = key(family, name);
    const hit = this.memo.get(id);
    if (hit !== undefined) return { ...hit };
    const chain: string[] = [];
    const visited = new Set<string>();
    let cursor: string | undefined = this.raw.has(id) ? id : undefined;
    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        throw ConvertError.malformed(`style inheritance cycle at ${JSON.stringify(cursor)}`);
      }
      visited.add(cursor);
      chain.push(cursor);
      const parent = this.raw.get(cursor)?.parent;
      cursor = parent !== undefined && this.raw.has(parent) ? parent : undefined;
    }
    let delta = this.defaults.get(family);
    delta = delta !== undefined ? { ...delta } : emptyDelta();
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const current = chain[i]!;
      const def = this.raw.get(current)!.def;
      delta = mergeDelta(delta, textPropertiesDelta(def));
      this.memo.set(current, { ...delta });
    }
    return delta;
  }

  /**
   * The block container a paragraph style names, walking `parent-style-name`.
   */
  blockStyle(name: string): BlockStyle | undefined {
    let id = key('paragraph', name);
    const visited = new Set<string>();
    while (!visited.has(id)) {
      visited.add(id);
      const entry = this.raw.get(id);
      if (entry === undefined) return undefined;
      const styleName = entry.def.attr(ns.STYLE, 'name');
      if (styleName !== undefined) {
        const hit = fromStyleName(styleName);
        if (hit !== undefined) return hit;
      }
      if (entry.parent === undefined) return undefined;
      id = entry.parent;
    }
    return undefined;
  }

  listLevel(styleName: string, depth: number): ListLevel {
    const levels = this.listStyles.get(styleName);
    const slot = levels?.[depth];
    return slot !== undefined ? { ...slot } : defaultListLevel();
  }

  /** The full level array of a list style, for composite-label rendering. */
  listLevels(styleName: string): ListLevel[] | undefined {
    return this.listStyles.get(styleName);
  }

  /** The document's heading numbering (`text:outline-style`) levels. */
  outlineLevels(): ListLevel[] | undefined {
    return this.outline;
  }
}

/** Clamp an untrusted start value so counters can never overflow. */
export function parseStart(v: string): number | undefined {
  const n = parseDecimalU64(v);
  if (n === undefined) return undefined;
  return Math.min(n, 0xffff_ffff);
}

/** Levels of a `text:list-style` or `text:outline-style`. */
function parseListStyle(style: Element): ListLevel[] {
  const levels: ListLevel[] = Array.from({ length: LIST_LEVELS }, () => defaultListLevel());
  for (const lvl of style.childElems()) {
    const raw = lvl.attr(ns.TEXT, 'level');
    if (raw === undefined) continue;
    const n = parseDecimalU64(raw);
    if (n === undefined || n < 1 || n > LIST_LEVELS) continue;
    const slot = levels[n - 1]!;
    if (lvl.is(ns.TEXT, 'list-level-style-number') || lvl.is(ns.TEXT, 'outline-level-style')) {
      const fmt = lvl.attr(ns.STYLE, 'num-format');
      if (fmt === 'a') slot.marker = 'lowerAlpha';
      else if (fmt === 'A') slot.marker = 'upperAlpha';
      else if (fmt === 'i') slot.marker = 'lowerRoman';
      else if (fmt === 'I') slot.marker = 'upperRoman';
      else if (fmt === '') slot.marker = 'bullet';
      else slot.marker = 'decimal';
      const startRaw = lvl.attr(ns.TEXT, 'start-value');
      slot.start = startRaw !== undefined ? (parseStart(startRaw) ?? 1) : 1;
      slot.prefix = lvl.attr(ns.STYLE, 'num-prefix') ?? '';
      const suffix = lvl.attr(ns.STYLE, 'num-suffix');
      slot.suffix = suffix !== undefined ? suffix : undefined;
      const display = lvl.attr(ns.TEXT, 'display-levels');
      const parsedDisplay = display !== undefined ? parseDecimalU64(display) : undefined;
      slot.displayLevels = parsedDisplay ?? 1;
    }
  }
  return levels;
}

/** Delta carried by a style's `style:text-properties`. */
export function textPropertiesDelta(elem: Element): StyleDelta {
  const props = elem.find(ns.STYLE, 'text-properties');
  if (props === undefined) return emptyDelta();
  const weight = props.attr(ns.FO, 'font-weight');
  let bold: boolean | undefined;
  if (weight !== undefined) {
    const n = parseDecimalU32(weight);
    bold = weight === 'bold' || (n !== undefined && n >= 600);
  }
  const fontStyle = props.attr(ns.FO, 'font-style');
  const italic =
    fontStyle !== undefined ? fontStyle === 'italic' || fontStyle === 'oblique' : undefined;
  const lineThrough = props.attr(ns.STYLE, 'text-line-through-style');
  const strike = lineThrough !== undefined ? lineThrough !== 'none' : undefined;
  return { bold, italic, strike, code: undefined };
}

function key(family: string, name: string): string {
  return `${family}\0${name}`;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Rust `str::parse::<u64>()`: the whole string is a decimal integer in 0..=u64::MAX. */
export function parseDecimalU64(v: string): number | undefined {
  if (v.length === 0 || !/^[0-9]+$/.test(v)) return undefined;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    return undefined;
  }
  if (n > 0xffff_ffff_ffff_ffffn) return undefined;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(n);
}

function parseDecimalU32(v: string): number | undefined {
  if (v.length === 0 || !/^[0-9]+$/.test(v)) return undefined;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    return undefined;
  }
  if (n > 0xffff_ffffn) return undefined;
  return Number(n);
}
