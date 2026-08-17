import { type ConvertHint, create } from '@mdgate/core';
import { pdf } from './converter.js';

const convert = create([pdf()]);

/**
 * Convert a single PDF file's bytes to Markdown. `hint.path` is only a
 * sniff hint; it is never read from disk.
 */
export function toMarkdown(bytes: Uint8Array, hint?: ConvertHint): Promise<string> {
  return convert(bytes, hint);
}
