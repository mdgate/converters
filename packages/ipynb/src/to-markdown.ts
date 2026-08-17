import { type ConvertHint, create } from '@mdgate/core';
import { ipynb } from './ipynb.js';

const convert = create([ipynb()]);

/**
 * Convert a single file's bytes to Markdown with the ipynb converter.
 * `hint.path` is only a sniff hint; it is never read from disk.
 */
export function toMarkdown(bytes: Uint8Array, hint?: ConvertHint): Promise<string> {
  return convert(bytes, hint);
}
