//! WordprocessingML style table.
//!
//! Bold/italic/strike are *toggle properties* (ECMA-376 §17.7.3): within the
//! style hierarchy a `true` specification toggles the inherited value and a
//! `false` specification leaves it unchanged, so the style layers contribute
//! a true-count *parity* XORed over the `docDefaults` base. Direct run
//! formatting is absolute on/off.

import { type Element, ns } from '@mdgate/containers';
import { PLAIN, type Style } from '@mdgate/document';
import {
  type BlockStyle,
  fromStyleName,
  resolveDelta,
  StyleChains,
  type StyleDelta,
} from '@mdgate/office-common';
import { trim } from '@mdgate/utils';
import type { Instance } from './numbering.js';

/** Per-property parity of `true` toggle specifications in a style chain. */
export interface Toggles {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

export function emptyToggles(): Toggles {
  return { bold: false, italic: false, strike: false };
}

export function xorToggles(self: Toggles, other: Toggles): Toggles {
  return {
    bold: self.bold !== other.bold,
    italic: self.italic !== other.italic,
    strike: self.strike !== other.strike,
  };
}

export function applyTogglesOver(self: Toggles, base: Style): Style {
  return {
    bold: base.bold !== self.bold,
    italic: base.italic !== self.italic,
    strike: base.strike !== self.strike,
    code: base.code,
  };
}

export class Styles {
  private readonly chains: StyleChains<Element>;
  /** docDefaults as absolute values (the base the toggles flip over). */
  readonly docDefaults: Style;

  private constructor(chains: StyleChains<Element>, docDefaults: Style) {
    this.chains = chains;
    this.docDefaults = docDefaults;
  }

  static parseOpt(root: Element | undefined): Styles {
    return root !== undefined ? Styles.parse(root) : new Styles(new StyleChains(), PLAIN);
  }

  static parse(root: Element): Styles {
    const chains = new StyleChains<Element>();
    for (const style of root.findAll(ns.W, 'style')) {
      const id = style.attr(ns.W, 'styleId');
      if (id === undefined) continue;
      const parent = style.find(ns.W, 'basedOn')?.attr(ns.W, 'val');
      chains.insert(id, style, parent);
    }
    const rpr = root.find(ns.W, 'docDefaults')?.find(ns.W, 'rPrDefault')?.find(ns.W, 'rPr');
    const docDefaults = rpr !== undefined ? resolveDelta(rprDelta(rpr)) : PLAIN;
    return new Styles(chains, docDefaults);
  }

  /**
   * The parity of `true` toggle specifications along a style's `basedOn`
   * chain. A `false` in a style leaves the inherited value unchanged.
   */
  runToggles(id: string): Toggles {
    let parity = emptyToggles();
    this.chains.walk(id, (style) => {
      const rpr = style.find(ns.W, 'rPr');
      if (rpr !== undefined) {
        parity = xorToggles(parity, {
          bold: onOff(rpr, 'b') === true,
          italic: onOff(rpr, 'i') === true,
          strike: onOff(rpr, 'strike') === true || onOff(rpr, 'dstrike') === true,
        });
      }
      return undefined;
    });
    return parity;
  }

  /**
   * Heading level a paragraph style resolves to, from its name
   * (`heading N`, `Title`) or an `outlineLvl`, inherited through
   * `basedOn`. `undefined` when nothing specifies a heading;
   * `{ level: undefined }` when the nearest specification is the
   * explicit off value (`outlineLvl` 9), which stops inheritance.
   */
  headingLevel(id: string): { level: number | undefined } | undefined {
    return this.chains.walk(id, (style) => {
      const name = toAsciiLowercase(style.find(ns.W, 'name')?.attr(ns.W, 'val') ?? '');
      if (name.startsWith('heading ')) {
        const level = parseU8(trim(name.slice('heading '.length)));
        if (level !== undefined) return { level };
      }
      if (name === 'title') return { level: 1 };
      const raw = style.find(ns.W, 'pPr')?.find(ns.W, 'outlineLvl')?.attr(ns.W, 'val');
      if (raw === undefined) return undefined;
      const level = parseU8(raw);
      if (level === undefined) return undefined;
      return { level: level < 9 ? level + 1 : undefined };
    });
  }

  /**
   * The block container a paragraph style names, inherited through
   * `basedOn` (Word's `Quote`, Pandoc's `Source Code`, ...).
   */
  blockStyle(id: string): BlockStyle | undefined {
    return this.chains.walk(id, (style) => {
      const name = style.find(ns.W, 'name')?.attr(ns.W, 'val');
      if (name === undefined) return undefined;
      return fromStyleName(name);
    });
  }

  /**
   * The `numId` a paragraph style contributes, inherited through
   * `basedOn`. An `ilvl` inside a style's `numPr` is ignored per ECMA-376
   * §17.3.1.19 — the effective level comes from the abstract levels'
   * `w:pStyle` bindings.
   */
  styleNumPr(id: string): number | undefined {
    return this.chains.walk(id, (style) => {
      const raw = style
        .find(ns.W, 'pPr')
        ?.find(ns.W, 'numPr')
        ?.find(ns.W, 'numId')
        ?.attr(ns.W, 'val');
      if (raw === undefined) return undefined;
      return parseUint(raw);
    });
  }

  /**
   * The numbering level a paragraph style binds to: the first style along
   * the `basedOn` chain (child first) that one of the instance's abstract
   * levels references via `w:pStyle`.
   */
  styleNumberingLevel(id: string, instance: Instance): number | undefined {
    return this.chains.walk(id, (style) => {
      const styleId = style.attr(ns.W, 'styleId');
      if (styleId === undefined) return undefined;
      return instance.styleLevel(styleId);
    });
  }

  /**
   * The `numId` referenced by a numbering style's own `numPr`
   * (`numStyleLink` contract), without inheritance.
   */
  directNumId(id: string): number | undefined {
    const style = this.chains.definition(id);
    if (style === undefined) return undefined;
    const raw = style
      .find(ns.W, 'pPr')
      ?.find(ns.W, 'numPr')
      ?.find(ns.W, 'numId')
      ?.attr(ns.W, 'val');
    if (raw === undefined) return undefined;
    return parseUint(raw);
  }
}

/**
 * A `w:rPr` element as a tri-state delta — used only for *direct* run
 * formatting, where specifications are absolute on/off.
 */
export function rprDelta(rpr: Element): StyleDelta {
  const s = onOff(rpr, 'strike');
  const d = onOff(rpr, 'dstrike');
  return {
    bold: onOff(rpr, 'b'),
    italic: onOff(rpr, 'i'),
    strike: s !== undefined || d !== undefined ? (s ?? false) || (d ?? false) : undefined,
    code: undefined,
  };
}

/**
 * ST_OnOff: `1`/`true`/`on` (or no value) are true; `0`/`false`/`off` are
 * false; an absent element is unspecified.
 */
export function onOff(parent: Element, name: string): boolean | undefined {
  const elem = parent.find(ns.W, name);
  if (elem === undefined) return undefined;
  const val = elem.attr(ns.W, 'val');
  return val !== '0' && val !== 'false' && val !== 'off' && val !== 'none';
}

function toAsciiLowercase(s: string): string {
  let out = '';
  for (const c of s) {
    out += c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
  }
  return out;
}

/** `xsd:unsignedByte`: integer 0–255. */
export function parseU8(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n > 255) return undefined;
  return n;
}

/** Non-negative integer that fits in a JS safe integer. */
export function parseUint(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) return undefined;
  return n;
}
