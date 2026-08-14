import { type Inline, PLAIN, type Style } from '../model/index.js';

/** Tri-state style delta used during cascade resolution. */
export interface StyleDelta {
  bold: boolean | undefined;
  italic: boolean | undefined;
  strike: boolean | undefined;
  code: boolean | undefined;
}

export function emptyDelta(): StyleDelta {
  return { bold: undefined, italic: undefined, strike: undefined, code: undefined };
}

/** Overlay `child` on `base`: an explicit child value wins; unset inherits. */
export function mergeDelta(base: StyleDelta, child: StyleDelta): StyleDelta {
  return {
    bold: child.bold ?? base.bold,
    italic: child.italic ?? base.italic,
    strike: child.strike ?? base.strike,
    code: child.code ?? base.code,
  };
}

export function applyDelta(delta: StyleDelta, base: Style): Style {
  return {
    bold: delta.bold ?? base.bold,
    italic: delta.italic ?? base.italic,
    strike: delta.strike ?? base.strike,
    code: delta.code ?? base.code,
  };
}

export function resolveDelta(delta: StyleDelta): Style {
  return applyDelta(delta, PLAIN);
}

export function deltasEqual(a: StyleDelta, b: StyleDelta): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code;
}

/**
 * Drop from every run the emphasis `base` already carries. A heading style
 * defines its own typography, so its runs should carry only what they add
 * beyond it.
 */
export function rebaseEmphasis(inlines: Inline[], base: Style): void {
  if (!base.bold && !base.italic && !base.strike && !base.code) return;
  for (const inline of inlines) {
    if (inline.type === 'text') {
      inline.style.bold = inline.style.bold && !base.bold;
      inline.style.italic = inline.style.italic && !base.italic;
      inline.style.strike = inline.style.strike && !base.strike;
    } else if (inline.type === 'link') {
      rebaseEmphasis(inline.content, base);
    }
  }
}
