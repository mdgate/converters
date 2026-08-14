import type { AnchorMap } from './anchors.js';

/** Immutable render context threaded through every render function. */
export interface Ctx {
  nums: Map<string, number>;
  anchors: AnchorMap;
}
