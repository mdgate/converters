import { type ConvertHint, create } from '@mdgate/core';
import { all } from './all.js';

const convert = create(all());

/**
 * Batteries-included local conversion. Works in Node, Edge, and browsers.
 * Pass file bytes; `hint.path` is only a sniff hint (e.g. `.csv`), never read.
 * Prefer `create([...])` to pick families.
 */
export function toMarkdown(bytes: Uint8Array, hint?: ConvertHint): Promise<string> {
  return convert(bytes, hint);
}
