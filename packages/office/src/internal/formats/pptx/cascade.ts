//! PresentationML text-property cascade: run properties resolve through
//! paragraph `pPr` -> shape `lstStyle` -> layout placeholder -> master
//! placeholder / `txStyles` -> presentation `defaultTextStyle`, with
//! explicit-off states honored at every layer.

import { emptyDelta, mergeDelta, type StyleDelta } from '../../common/delta.js';
import { type MarkerKind, markerOrdinal } from '../../model/index.js';
import { type Element, ns } from '../../package/xml.js';

export const LEVELS = 9;

export type Bullet =
  | { kind: 'inherit' }
  | { kind: 'none' }
  | { kind: 'char' }
  | { kind: 'autoNum'; marker: MarkerKind; start: number; wrap: NumWrap };

/** The punctuation an `ST_TextAutoNumberScheme` wraps around the ordinal. */
export type NumWrap = 'period' | 'parenR' | 'parenBoth' | 'plain';

/** The literal marker label for ordinal `n`; `undefined` when the default label (`n.`) is already faithful. */
export function numWrapLabel(wrap: NumWrap, marker: MarkerKind, n: number): string | undefined {
  switch (wrap) {
    case 'period':
      return undefined;
    case 'parenR':
      return `${markerOrdinal(marker, n)})`;
    case 'parenBoth':
      return `(${markerOrdinal(marker, n)})`;
    case 'plain':
      return markerOrdinal(marker, n);
  }
}

export interface TextProps {
  delta: StyleDelta;
  bullet: Bullet;
}

export function emptyTextProps(): TextProps {
  return { delta: emptyDelta(), bullet: { kind: 'inherit' } };
}

/** Overlay `over` on `self`: explicit values win, `inherit` falls through. */
export function mergeTextProps(base: TextProps, over: TextProps): TextProps {
  return {
    delta: mergeDelta(base.delta, over.delta),
    bullet: over.bullet.kind === 'inherit' ? base.bullet : over.bullet,
  };
}

/** Per-level text properties from a `lstStyle`-shaped element (`a:lvl1pPr`..`a:lvl9pPr` children). */
export class LevelStyle {
  readonly levels: TextProps[];

  constructor(levels?: TextProps[]) {
    this.levels = levels ?? Array.from({ length: LEVELS }, () => emptyTextProps());
  }

  level(lvl: number): TextProps {
    return this.levels[Math.min(Math.max(lvl, 0), LEVELS - 1)]!;
  }
}

export function parseLevelStyles(elem: Element | undefined): LevelStyle {
  const out = new LevelStyle();
  if (elem === undefined) return out;
  for (let i = 0; i < out.levels.length; i += 1) {
    const name = `lvl${i + 1}pPr`;
    const ppr = elem.childElems().find((e) => e.is(ns.A, name));
    if (ppr !== undefined) out.levels[i] = paragraphProps(ppr);
  }
  return out;
}

/** Properties carried by one `pPr`-shaped element (direct paragraph properties or one `lvlNpPr` level). */
export function paragraphProps(ppr: Element): TextProps {
  let bullet: Bullet;
  if (ppr.find(ns.A, 'buNone') !== undefined) {
    bullet = { kind: 'none' };
  } else {
    const auto = ppr.find(ns.A, 'buAutoNum');
    if (auto !== undefined) {
      const scheme = auto.attr(ns.A, 'type') ?? '';
      let marker: MarkerKind;
      if (scheme.startsWith('alphaLc')) marker = 'lowerAlpha';
      else if (scheme.startsWith('alphaUc')) marker = 'upperAlpha';
      else if (scheme.startsWith('romanLc')) marker = 'lowerRoman';
      else if (scheme.startsWith('romanUc')) marker = 'upperRoman';
      else marker = 'decimal';
      let wrap: NumWrap;
      if (scheme.endsWith('ParenBoth')) wrap = 'parenBoth';
      else if (scheme.endsWith('ParenR')) wrap = 'parenR';
      else if (scheme.endsWith('Plain')) wrap = 'plain';
      else wrap = 'period';
      // ST_TextBulletStartAtNum: 1..=32767; untrusted values are clamped
      // so counters can never overflow.
      const startAt = auto.attr(ns.A, 'startAt');
      const parsed = startAt !== undefined ? parseI64(startAt) : undefined;
      const start = parsed !== undefined ? clamp(parsed, 1, 32767) : 1;
      bullet = { kind: 'autoNum', marker, start, wrap };
    } else if (ppr.find(ns.A, 'buChar') !== undefined) {
      bullet = { kind: 'char' };
    } else {
      bullet = { kind: 'inherit' };
    }
  }
  const defRPr = ppr.find(ns.A, 'defRPr');
  const delta = defRPr !== undefined ? rprDelta(defRPr) : emptyDelta();
  return { delta, bullet };
}

/** Delta from an `a:rPr`/`a:defRPr` element's attributes. */
export function rprDelta(rpr: Element): StyleDelta {
  const onOff = (name: string): boolean | undefined => {
    const v = rpr.attr(ns.A, name);
    if (v === undefined) return undefined;
    return v === '1' || v === 'true' || v === 'on';
  };
  const strike = rpr.attr(ns.A, 'strike');
  return {
    bold: onOff('b'),
    italic: onOff('i'),
    strike: strike === undefined ? undefined : strike === 'sngStrike' || strike === 'dblStrike',
    code: undefined,
  };
}

/** A placeholder shape's identity and level styles inside a layout/master. */
export interface Placeholder {
  phType: string;
  idx: string | undefined;
  styles: LevelStyle;
}

export function collectPlaceholders(spTree: Element): Placeholder[] {
  const out: Placeholder[] = [];
  for (const sp of spTree.descendants(ns.P, 'sp')) {
    const ph = sp.firstDescendant(ns.P, 'ph');
    if (ph === undefined) continue;
    const tx = sp.find(ns.P, 'txBody');
    const styles = parseLevelStyles(tx !== undefined ? tx.find(ns.A, 'lstStyle') : undefined);
    out.push({
      phType: ph.attr(ns.P, 'type') ?? 'body',
      idx: ph.attr(ns.P, 'idx'),
      styles,
    });
  }
  return out;
}

/** Find the placeholder a shape inherits from: match by `idx` first, then by type (title variants unify). */
export function matchPlaceholder(
  placeholders: readonly Placeholder[],
  phType: string,
  idx: string | undefined,
): Placeholder | undefined {
  if (idx !== undefined) {
    const hit = placeholders.find((p) => p.idx === idx);
    if (hit !== undefined) return hit;
  }
  const klass = titleClass(phType);
  return (
    placeholders.find((p) => {
      return titleClass(p.phType) === klass && (klass === 'title' || p.phType === phType);
    }) ?? placeholders.find((p) => titleClass(p.phType) === klass)
  );
}

export type TitleClass = 'title' | 'body';

export function titleClass(phType: string): TitleClass {
  return phType === 'title' || phType === 'ctrTitle' ? 'title' : 'body';
}

function parseI64(v: string): number | undefined {
  if (!/^[+-]?\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) return undefined;
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
